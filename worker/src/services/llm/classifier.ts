import { PROMPT_VERSION, TOPICS } from "../../taxonomy";
import type { Env } from "../../types";
import { TOPIC_KEYWORD_HINTS } from "../topicKeywords";
import { Classification, CommentInput, validateClassification } from "./base";
import { classifyFallback } from "./fallback";
import { buildProvider } from "./providers";
import type { LLMProvider } from "./base";

const SYSTEM = `Bạn là chuyên gia phân tích phản hồi người chơi cho game FPS mobile "Crossfire Legends" (CFL) của VNG tại Việt Nam. Người chơi bình luận bằng tiếng Việt, nhiều teencode/viết tắt. Một số quy ước: "văng"/"vang" = crash, "hút máu"/"p2w" = pay-to-win, "dis" = mất kết nối, "nạp" = nạp tiền, "gà"/"noob" = chơi kém, "acc"/"nick" = tài khoản.

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

export function buildClassifierUserPrompt(items: CommentInput[]): string {
  const lines = ["Phân loại các bình luận sau:\n"];
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

  private async classifyBatchLlm(items: CommentInput[]): Promise<Map<number, Classification>> {
    const out = new Map<number, Classification>();
    if (!this.provider) return out;
    const raw = await this.provider.completeJson(SYSTEM, buildClassifierUserPrompt(items));
    for (const rec of parseResults(raw)) {
      const c = validateClassification(rec);
      if (c) out.set(c.id, c);
    }
    return out;
  }

  async classify(items: CommentInput[]): Promise<Classification[]> {
    const results = new Map<number, Classification>();

    if (this.provider) {
      for (let i = 0; i < items.length; i += this.batchSize) {
        const batch = items.slice(i, i + this.batchSize);
        try {
          const got = await this.classifyBatchLlm(batch);
          got.forEach((v, k) => results.set(k, v));
        } catch (e) {
          console.warn(`LLM batch failed (${e}), using fallback for ${batch.length} items`);
        }
      }
    }

    for (const it of items) {
      if (!results.has(it.id)) results.set(it.id, classifyFallback(it));
    }
    return items.map((it) => results.get(it.id)!);
  }
}
