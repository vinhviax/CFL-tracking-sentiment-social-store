import { PROMPT_VERSION, TOPICS } from "../../taxonomy";
import type { Env } from "../../types";
import { TOPIC_KEYWORD_HINTS } from "../topicKeywords";
import { addUsage, Classification, CommentInput, validateClassification } from "./base";
import { classifyFallback } from "./fallback";
import { buildProvider } from "./providers";
import type { LLMProvider, LLMUsage } from "./base";

export interface HumanCorrectionExample {
  comment: string;
  topic_main: string;
  note: string;
}

export interface ClassifyResult {
  classifications: Classification[];
  /** Undefined when the provider reported no usage (or the fallback classifier ran). */
  usage?: LLMUsage;
}

export const CLASSIFIER_SYSTEM_PROMPT = `Bạn là senior liveops analyst cho game FPS mobile "Crossfire Legends" (CFL) của VNG tại Việt Nam. Mục tiêu là đọc hiểu phản hồi người chơi để team vận hành/game ops biết vấn đề cần xử lý, không chỉ gắn nhãn theo từ khóa.

Người chơi bình luận bằng tiếng Việt, nhiều teencode/viết tắt. Một số quy ước: "văng"/"vang" = crash, "hút máu"/"p2w" = pay-to-win, "dis" = mất kết nối, "nạp" = nạp tiền, "gà"/"noob" = chơi kém, "acc"/"nick" = tài khoản.

Nguyên tắc đọc hiểu liveops:
- Đọc toàn bộ bình luận, bối cảnh bài viết/post và rating trước khi quyết định. Bình luận ngắn như "vẫn lỗi", "chưa được", "xong rồi lag" phải dựa vào context nếu có.
- Không phân loại chỉ vì thấy keyword. Keyword chỉ là tín hiệu; quyết định cuối cùng phải dựa trên ý định, nguyên nhân vận hành chính và tác động tới người chơi.
- Chọn topic_main là vấn đề chính cần triage. Nếu comment có cả triệu chứng và nguyên nhân, ưu tiên nguyên nhân/driver rõ nhất; đưa vấn đề phụ quan trọng vào topics_sub.
- Không tạo nhóm mới bằng cách chép lại text thô. Nếu cần other_suggested, đặt tên nhóm ngắn, canonical, theo ý nghĩa vận hành.
- Với update_download, các cách nói như "nhật xong", "cập nhật xong", "phiên bản mới", "cập nhật mới", "nhật phiên bản mới" đều hiểu là cùng ý "Cập nhật/phiên bản mới" trong summary/other_suggested khi cần.
- Chủ đề So Sánh Game: mọi comment nhắc CFM/China/SEA, CFM China, CFM SEA, bản Trung, bản SEA, bản Việt/VN, global/quốc tế, CrossFire Mobile hoặc game/bản game khác trong ngữ cảnh CFL đều tính vào topic_main game_comparison, kể cả không so sánh trực tiếp. Nếu người chơi vừa nhắc bản game khác vừa phàn nàn lag/hack/nạp/event, đặt game_comparison làm topic_main và đưa vấn đề cụ thể vào topics_sub nếu đủ rõ.

Với MỖI bình luận, hãy phân loại:
- topic_main: MỘT chủ đề chính, chọn từ danh sách: ${TOPICS.join(", ")}
- topics_sub: tối đa 2 chủ đề phụ khác (cùng danh sách trên), [] nếu không có
- sentiment: "negative" | "neutral" | "positive"
- urgency: "none" | "low" | "medium" | "high" (high = mất tiền, mất account, không vào được game, hack tràn lan)
- summary: 1 câu tiếng Việt ngắn tóm tắt ý chính
- other_suggested: nếu KHÔNG chủ đề nào khớp, đề xuất tên nhóm mới (tiếng Việt ngắn), ngược lại null
- confidence: số thực 0..1

Gợi ý keyword cho Chủ Đề Lớn, dùng để hiểu teencode/ngữ cảnh nhưng vẫn đọc toàn câu trước khi quyết định:
${TOPIC_KEYWORD_HINTS}

TRẢ VỀ DUY NHẤT một JSON object có key "results" là mảng, mỗi phần tử gồm đúng các field:
id, topic_main, topics_sub, sentiment, urgency, summary, other_suggested, confidence.
Giữ nguyên id đã cho. Không thêm giải thích ngoài JSON.`;

export function buildClassifierUserPrompt(items: CommentInput[], humanExamples: HumanCorrectionExample[] = []): string {
  const lines: string[] = [];
  if (humanExamples.length) {
    lines.push("Ví dụ human đã sửa để LLM học theo:");
    for (const example of humanExamples.slice(0, 12)) {
      lines.push(`- comment="${example.comment.slice(0, 260)}" => topic_main=${example.topic_main}; lý do="${example.note.slice(0, 260)}"`);
    }
    lines.push("");
  }

  lines.push("Phân loại các bình luận sau:\n");
  lines.push(
    "Nếu có bối cảnh bài viết/post, hãy đọc bối cảnh trước rồi mới phân loại các bình luận ngắn hoặc mơ hồ."
  );
  for (const it of items) {
    const block = [`[id=${it.id}]`];
    if (it.rating != null) block.push(`(rating store: ${it.rating}/5 sao)`);
    if (it.context) {
      block.push(`Bối cảnh bài viết/post chứa bình luận:\n${it.context.slice(0, 600)}`);
    }
    block.push(`Bình luận: ${it.message.slice(0, 1500)}`);
    lines.push(block.join("\n"));
    lines.push("---");
  }
  return lines.join("\n");
}

function parseResults(raw: string): any[] {
  let text = raw.trim();
  if (text.startsWith("```")) {
    const parts = text.split("```");
    text = (parts[1] || "").replace(/^json/i, "").trim();
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1) {
      data = JSON.parse(text.slice(start, end + 1));
    } else {
      const s2 = text.indexOf("{");
      const e2 = text.lastIndexOf("}");
      data = JSON.parse(text.slice(s2, e2 + 1));
    }
  }
  if (data && !Array.isArray(data)) {
    data = data.results || data.data || data.items || [data];
  }
  return Array.isArray(data) ? data : [];
}

export class ClassifierService {
  providerName: string;
  model: string | null;
  promptVersion = PROMPT_VERSION;
  private provider;
  private batchSize: number;

  constructor(env: Env, providerOverride?: LLMProvider | null) {
    this.provider = providerOverride === undefined
      ? buildProvider(env.LLM_PROVIDER, env.LLM_CLASSIFY_MODEL, {
        anthropicKey: env.ANTHROPIC_API_KEY,
        openaiKey: env.OPENAI_API_KEY,
        baseUrl: env.LLM_BASE_URL,
        llmViaxKey: env.LLM_VIAX_API_KEY,
        llmViaxBaseUrl: env.LLM_VIAX_BASE_URL,
      })
      : providerOverride;
    this.providerName = this.provider?.name ?? "fallback";
    this.model = this.provider?.model ?? null;
    this.batchSize = Number(env.CLASSIFY_BATCH_SIZE) || 30;
  }

  private async classifyBatchLlm(
    items: CommentInput[],
    humanExamples: HumanCorrectionExample[] = []
  ): Promise<{ classifications: Map<number, Classification>; usage?: LLMUsage }> {
    const out = new Map<number, Classification>();
    if (!this.provider) return { classifications: out };
    const { content, usage } = await this.provider.completeJson(
      CLASSIFIER_SYSTEM_PROMPT,
      buildClassifierUserPrompt(items, humanExamples)
    );
    for (const rec of parseResults(content)) {
      const c = validateClassification(rec);
      if (c) out.set(c.id, c);
    }
    return { classifications: out, usage };
  }

  async classify(
    items: CommentInput[],
    humanExamples: HumanCorrectionExample[] = []
  ): Promise<ClassifyResult> {
    const results = new Map<number, Classification>();
    // Summed across inner batches; stays undefined unless at least one call
    // reported usage, so "unknown" never collapses into a misleading zero.
    let usage: LLMUsage | undefined;

    if (this.provider) {
      for (let i = 0; i < items.length; i += this.batchSize) {
        const batch = items.slice(i, i + this.batchSize);
        try {
          const got = await this.classifyBatchLlm(batch, humanExamples);
          got.classifications.forEach((v, k) => results.set(k, v));
          usage = addUsage(usage, got.usage);
        } catch (e) {
          console.warn(`LLM batch failed (${e}), using fallback for ${batch.length} items`);
        }
      }
    }

    for (const it of items) {
      if (!results.has(it.id)) results.set(it.id, classifyFallback(it));
    }
    return { classifications: items.map((it) => results.get(it.id)!), usage };
  }
}
