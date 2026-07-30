// Ported from backend/app/services/insights.py.
import type { Env } from "../types";
import type { LLMUsage } from "./llm/base";
import { type ByoOverride, resolveLlmProviderChain } from "./llmAgentConfig";
import { completeTextForSlot } from "./llmSlotState";
import { addTopicFilter } from "./topicScope";

export const INSIGHT_PROMPT_KEY = "insight_summary_prompt";

const INSIGHT_WEB_FORMAT_MARKER = "[CFL_INSIGHT_WEB_MARKDOWN_V1]";

export const INSIGHT_WEB_FORMAT_PROMPT =
  `${INSIGHT_WEB_FORMAT_MARKER}\n` +
  "không được chỉ viết chung chung. Phải gọi tên vấn đề cụ thể trong từng chủ đề, kèm số comment/tín hiệu tiêu cực/khẩn cấp khi dữ liệu có cung cấp. " +
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

function fallbackSummary(overview: any, locale: "vi" | "zh-CN" = "vi"): string {
  if (locale === "zh-CN") {
    const negPct = overview.negative_pct || 0;
    const top = (overview.top_topics || []).slice(0, 3);
    const hot = (overview.hot_issues || []).slice(0, 3);
    const lines = [
      "## 🔥 Executive insight",
      `**共 ${overview.total_comments || 0} 条反馈**，其中 **${negPct}%** 为负面情绪。`,
    ];
    if (top.length) {
      lines.push("", "## 📌 玩家关注点", ...top.map((t: any) => `- **${t.label}** 是当前阶段被频繁提到的主题。`));
    }
    if (hot.length) {
      lines.push("", "## ⚠️ 优先问题", ...hot.map((h: any) => `- **${h.label}** 有较强负面/紧急信号，应优先检查。`));
    }
    lines.push(
      "",
      "## 💡 建议行动",
      "- 检查 LLM provider/API key 配置，以便获得更深入的 AI insight。",
      "- 结合下方评论证据阅读，再决定运营或产品动作。"
    );
    return lines.join("\n");
  }
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

export type InsightLanguage = "vi" | "zh-CN";

export function normalizeInsightFilters(raw: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (value == null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

function parseSubtopicKeys(value?: string) {
  return String(value || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function languageInstruction(locale: InsightLanguage) {
  if (locale === "zh-CN") {
    return "Output language: write the complete Insight and Summarize in Simplified Chinese. Keep game names, product names, and topic labels readable.";
  }
  return "Output language: write the complete Insight and Summarize in Vietnamese with full diacritics.";
}

function issueParentLabel(row: any) {
  return row.parent_label || row.parent_topic || row.topic_label || row.topic || "Chủ đề";
}

function actionableIssueDetails(overview: any) {
  return (overview.top_subtopics || [])
    .filter((row: any) => row && row.parent_topic !== "other" && row.label)
    .sort((a: any, b: any) =>
      Number(b.urgent_count || 0) - Number(a.urgent_count || 0)
      || Number(b.negative_count || 0) - Number(a.negative_count || 0)
      || Number(b.count || 0) - Number(a.count || 0)
    );
}

export async function sampleBySentiment(env: Env, q: Record<string, string>): Promise<SentimentSamples> {
  const baseWhere: string[] = [];
  const baseParams: any[] = [];
  if (q.group === "store") baseWhere.push("c.source_type = 'store'");
  if (q.group === "facebook") baseWhere.push("c.source_type IN ('fb_page','fb_group_csv')");
  if (q.source) { baseWhere.push("c.source_type = ?"); baseParams.push(q.source); }
  if (q.store) { baseWhere.push("c.store = ?"); baseParams.push(q.store); }
  if (q.from) { baseWhere.push("substr(c.created_at, 1, 10) >= ?"); baseParams.push(q.from.slice(0, 10)); }
  if (q.to) { baseWhere.push("substr(c.created_at, 1, 10) <= ?"); baseParams.push(q.to.slice(0, 10)); }
  addTopicFilter(baseWhere, baseParams, q.topic);
  if (q.subtopic) {
    const subtopicKeys = parseSubtopicKeys(q.subtopic);
    if (!subtopicKeys.length) return { negative: [], neutral: [], positive: [] };
    const placeholders = subtopicKeys.map(() => "?").join(",");
    baseWhere.push(`EXISTS (
      SELECT 1 FROM comment_subtopics cs
      JOIN taxonomy_subtopics st ON st.id = cs.subtopic_id
      WHERE cs.comment_id = c.id AND st.key IN (${placeholders})
    )`);
    baseParams.push(...subtopicKeys);
  }

  const samples: SentimentSamples = { negative: [], neutral: [], positive: [] };
  for (const sentiment of Object.keys(samples) as (keyof SentimentSamples)[]) {
    const where = [...baseWhere, "a.sentiment = ?"];
    const rows = await env.DB.prepare(
      `SELECT c.message
       FROM comments c JOIN analyses a ON a.comment_id = c.id
       WHERE ${where.join(" AND ")}
       ORDER BY c.created_at DESC
       LIMIT 8`
    ).bind(...baseParams, sentiment).all<{ message: string }>();
    samples[sentiment] = rows.results.map((r) => r.message);
  }
  return samples;
}

export function buildInsightMessages(systemPrompt: string, overview: any, samples: SentimentSamples, locale: InsightLanguage = "vi"): [string, string] {
  const issueDetails = actionableIssueDetails(overview).slice(0, 12);
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

  if (issueDetails.length) {
    lines.push("Chi tiết vấn đề trong từng chủ đề (bắt buộc dùng để viết cụ thể, không gom chung theo chủ đề cha):");
    lines.push(...issueDetails.map((row: any) =>
      `- ${issueParentLabel(row)} > ${row.label}: ${Number(row.count || 0)} tổng, ${Number(row.negative_count || 0)} tiêu cực, ${Number(row.urgent_count || 0)} khẩn cấp`
    ));
  }

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
  lines.push(languageInstruction(locale));
  return [`${withInsightWebFormat(systemPrompt)}\n\n${languageInstruction(locale)}`, lines.join("\n")];
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

export async function generateSummary(env: Env, overview: any, samples: SentimentSamples, systemPrompt?: string, locale: InsightLanguage = "vi", byo?: ByoOverride | null): Promise<{ summary: string; provider: string; model: string | null; usage?: LLMUsage }> {
  // Insight used to bypass slot configuration entirely and read LLM_INSIGHT_MODEL
  // directly, so changing the model in the UI had no effect here. It now uses the
  // reasoning slot like the rest of the analytical work.
  const chain = await resolveLlmProviderChain(env, "reasoning", byo);
  if (!chain.length) return { summary: fallbackSummary(overview, locale), provider: "fallback", model: null };
  try {
    const [system, user] = buildInsightMessages(systemPrompt || await getInsightPrompt(env), overview, samples, locale);
    const outcome = await completeTextForSlot(env, "reasoning", chain, system, user, { recordable: byo == null });
    return { summary: outcome.content.trim(), provider: outcome.provider.name, model: outcome.provider.model, usage: outcome.usage };
  } catch (e: any) {
    // Falling back silently made an LLM outage indistinguishable from a working
    // template summary; log the reason so `wrangler tail` can show it.
    console.warn("insight generation fell back to template:", e?.message || e);
    return { summary: fallbackSummary(overview, locale), provider: "fallback", model: null };
  }
}
