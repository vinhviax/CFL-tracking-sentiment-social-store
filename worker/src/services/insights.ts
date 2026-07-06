// Ported from backend/app/services/insights.py.
import type { Env } from "../types";
import { buildProvider } from "./llm/providers";

export const INSIGHT_PROMPT_KEY = "insight_summary_prompt";

const INSIGHT_WEB_FORMAT_MARKER = "[CFL_INSIGHT_WEB_MARKDOWN_V1]";

export const INSIGHT_WEB_FORMAT_PROMPT =
  `${INSIGHT_WEB_FORMAT_MARKER}\n` +
  "Yêu cầu định dạng bắt buộc cho Web UI: trả lời bằng Markdown, không trả HTML. " +
  "Viết có cấu trúc, nhiều đoạn ngắn, dễ scan trong dashboard. " +
  "Dùng heading cấp 2 bắt đầu bằng ##, bullet list bằng -, in đậm bằng **...**, in nghiêng bằng *...*. " +
  "Dùng icon phù hợp ở đầu heading hoặc bullet để tăng khả năng đọc, ví dụ: 🔥, ⚠️, ✅, 💡, 📌, 🎯. " +
  "Bắt buộc có các phần: ## 🔥 Executive insight, ## ⚠️ Vấn đề cần ưu tiên, ## ✅ Điểm tích cực, ## 💡 Hành động đề xuất. " +
  "Nếu có vấn đề nghiêm trọng, mở đầu bằng một câu **kết luận chính** thật ngắn. " +
  "Không viết một đoạn văn dài quá 3 dòng; không lặp số liệu máy móc; không dùng bảng Markdown.";

export const DEFAULT_INSIGHT_SYSTEM_PROMPT =
  "Bạn là chuyên gia phân tích insight sản phẩm game Crossfire Legends (CFL) cho đội vận hành VNG. " +
  "Dựa trên số liệu và comment mẫu trong giai đoạn được chọn, hãy viết phần 'Insight and Summarize' bằng tiếng Việt. " +
  "Nội dung cần gồm: 1) tóm tắt tình hình chung, 2) insight người chơi đang quan tâm điều gì, " +
  "3) vấn đề cần ưu tiên xử lý, 4) đề xuất hành động cụ thể cho vận hành/sản phẩm. " +
  "Không lặp số liệu máy móc, không viết chung chung, ưu tiên ngắn gọn nhưng có chiều sâu. " +
  INSIGHT_WEB_FORMAT_PROMPT;

function withInsightWebFormat(systemPrompt: string): string {
  if (systemPrompt.includes(INSIGHT_WEB_FORMAT_MARKER)) return systemPrompt;
  return `${systemPrompt.trim()}\n\n${INSIGHT_WEB_FORMAT_PROMPT}`;
}

function fallbackSummary(overview: any): string {
  const negPct = overview.negative_pct || 0;
  const top = (overview.top_topics || []).slice(0, 3);
  const hot = (overview.hot_issues || []).slice(0, 3);
  const lines = [
    "## 🔥 Executive insight",
    `**Tổng ${overview.total_comments || 0} phản hồi**, trong đó **${negPct}%** mang sắc thái tiêu cực.`,
  ];
  if (top.length) {
    lines.push("", "## 📌 Người chơi đang quan tâm", ...top.map((t: any) => `- **${t.label}** đang được nhắc nhiều trong giai đoạn này.`));
  }
  if (hot.length) {
    lines.push("", "## ⚠️ Vấn đề cần ưu tiên", ...hot.map((h: any) => `- **${h.label}** có tín hiệu tiêu cực/khẩn cấp cao, nên kiểm tra trước.`));
  }
  lines.push(
    "",
    "## 💡 Hành động đề xuất",
    "- Kiểm tra lại cấu hình LLM provider/API key để có insight sâu hơn từ AI.",
    "- Dùng bảng comment bên dưới để đọc mẫu phản hồi trước khi chốt action vận hành."
  );
  return lines.join("\n");
}

export interface SentimentSamples {
  negative: string[];
  neutral: string[];
  positive: string[];
}

export function buildInsightMessages(systemPrompt: string, overview: any, samples: SentimentSamples): [string, string] {
  const lines = [
    `Tổng phản hồi: ${overview.total_comments || 0}, đã phân tích: ${overview.analyzed || 0}.`,
    `Tỉ lệ tiêu cực: ${overview.negative_pct || 0}%.`,
    "Top chủ đề: " + (overview.top_topics || []).slice(0, 6).map((t: any) => `${t.label} (${t.count})`).join(", "),
    "Top chủ đề con: " + (overview.top_subtopics || []).slice(0, 10).map((t: any) =>
      `${t.parent_label || t.parent_topic} > ${t.label} (${t.count})`
    ).join(", "),
    "Vấn đề nổi cộm (tiêu cực + khẩn cấp): " +
      (overview.hot_issues || []).slice(0, 5).map((h: any) => `${h.label} (${h.negative} tiêu cực, ${h.urgent} khẩn cấp)`).join(", "),
  ];

  const sections: [keyof SentimentSamples, string][] = [
    ["negative", "Bình luận tiêu cực tiêu biểu"],
    ["neutral", "Bình luận trung lập tiêu biểu"],
    ["positive", "Bình luận tích cực tiêu biểu"],
  ];
  for (const [key, label] of sections) {
    if (!samples[key].length) continue;
    lines.push(label + ":");
    lines.push(...samples[key].slice(0, 8).map((s) => `- ${s.slice(0, 240)}`));
  }
  lines.push("\nHãy viết Insight and Summarize cho giai đoạn này.");
  return [withInsightWebFormat(systemPrompt), lines.join("\n")];
}

export async function getInsightPrompt(env: Env): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .bind(INSIGHT_PROMPT_KEY)
    .first<{ value: string }>();
  return row?.value || DEFAULT_INSIGHT_SYSTEM_PROMPT;
}

export async function saveInsightPrompt(env: Env, prompt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(INSIGHT_PROMPT_KEY, prompt, new Date().toISOString()).run();
}

export async function generateSummary(env: Env, overview: any, samples: SentimentSamples, systemPrompt?: string): Promise<{ summary: string; provider: string; model: string | null }> {
  const provider = buildProvider(env.LLM_PROVIDER, env.LLM_INSIGHT_MODEL, {
    anthropicKey: env.ANTHROPIC_API_KEY, openaiKey: env.OPENAI_API_KEY, baseUrl: env.LLM_BASE_URL,
    llmViaxKey: env.LLM_VIAX_API_KEY, llmViaxBaseUrl: env.LLM_VIAX_BASE_URL,
  });
  if (!provider) return { summary: fallbackSummary(overview), provider: "fallback", model: null };
  try {
    const [system, user] = buildInsightMessages(systemPrompt || await getInsightPrompt(env), overview, samples);
    return { summary: (await provider.completeText(system, user)).trim(), provider: provider.name, model: provider.model };
  } catch {
    return { summary: fallbackSummary(overview), provider: "fallback", model: null };
  }
}
