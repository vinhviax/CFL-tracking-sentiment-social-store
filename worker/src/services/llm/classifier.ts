import { PROMPT_VERSION, TOPICS } from "../../taxonomy";
import type { Env } from "../../types";
import { TOPIC_KEYWORD_HINTS } from "../topicKeywords";
import { addUsage, Classification, CommentInput, validateClassification } from "./base";
import { type ChainOutcome, completeJsonWithFallback } from "./chain";
import { classifyFallback } from "./fallback";
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
  /** How many items the LLM classified; the rest came from the keyword fallback. */
  llmClassified: number;
  /** True when at least one item had to fall back. */
  fellBack: boolean;
  /** First LLM error of the batch, for the processing log. */
  error?: string | null;
  /** Provider/model that actually answered, which may be the safety net rather than the first choice. */
  servedBy?: { provider: string; model: string } | null;
  /** True when the first-choice provider errored and another in the chain answered. */
  usedSafetyNet?: boolean;
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
  private chain: LLMProvider[];
  private batchSize: number;

  /**
   * The provider chain is resolved by the caller (resolveLlmProviderChain) and passed
   * in, so the classifier has no second path to provider configuration that could
   * disagree with the slot the user picked. An empty chain means keyword classification.
   */
  constructor(env: Env, chain: LLMProvider[]) {
    this.chain = chain;
    this.providerName = chain[0]?.name ?? "fallback";
    this.model = chain[0]?.model ?? null;
    this.batchSize = Number(env.CLASSIFY_BATCH_SIZE) || 30;
  }

  private async classifyBatchLlm(
    items: CommentInput[],
    humanExamples: HumanCorrectionExample[] = []
  ): Promise<{ classifications: Map<number, Classification>; usage?: LLMUsage; outcome: ChainOutcome }> {
    const out = new Map<number, Classification>();
    const outcome = await completeJsonWithFallback(
      this.chain,
      CLASSIFIER_SYSTEM_PROMPT,
      buildClassifierUserPrompt(items, humanExamples)
    );
    for (const rec of parseResults(outcome.content)) {
      const c = validateClassification(rec);
      if (c) out.set(c.id, c);
    }
    return { classifications: out, usage: outcome.usage, outcome };
  }

  async classify(
    items: CommentInput[],
    humanExamples: HumanCorrectionExample[] = []
  ): Promise<ClassifyResult> {
    const results = new Map<number, Classification>();
    // Summed across inner batches; stays undefined unless at least one call
    // reported usage, so "unknown" never collapses into a misleading zero.
    let usage: LLMUsage | undefined;

    const errors: string[] = [];
    // Who actually answered. May differ from the first choice when the safety net
    // provider took over, and the caller records this rather than the configured one.
    let servedBy: { provider: string; model: string } | null = null;
    let usedSafetyNet = false;

    if (this.chain.length) {
      for (let i = 0; i < items.length; i += this.batchSize) {
        const batch = items.slice(i, i + this.batchSize);
        try {
          const got = await this.classifyBatchLlm(batch, humanExamples);
          got.classifications.forEach((v, k) => results.set(k, v));
          usage = addUsage(usage, got.usage);
          servedBy = { provider: got.outcome.provider.name, model: got.outcome.provider.model };
          if (got.outcome.failures.length) {
            usedSafetyNet = true;
            for (const f of got.outcome.failures) {
              console.warn(`LLM ${f.provider}/${f.model} failed (${f.error}); retried via ${got.outcome.provider.name}`);
              errors.push(`${f.provider}/${f.model}: ${f.error}`);
            }
          }
        } catch (e: any) {
          const message = e?.message || String(e);
          console.warn(`every LLM provider failed (${message}), using keyword fallback for ${batch.length} items`);
          errors.push(message);
        }
      }
    }

    // How many items the LLM actually classified. Reported so the caller can record
    // the truth: a misconfigured model returns 403 on every batch, and recording the
    // configured model regardless is what hid exactly that for 31,322 comments.
    const llmClassified = results.size;

    for (const it of items) {
      if (!results.has(it.id)) results.set(it.id, classifyFallback(it));
    }
    return {
      classifications: items.map((it) => results.get(it.id)!),
      usage,
      llmClassified,
      fellBack: llmClassified < items.length,
      error: errors[0] || null,
      servedBy,
      usedSafetyNet,
    };
  }
}
