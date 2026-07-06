// Ported from backend/app/services/insights.py.
import type { Env } from "../types";
import { buildProvider } from "./llm/providers";

function fallbackSummary(overview: any): string {
  const negPct = overview.negative_pct || 0;
  const top = (overview.top_topics || []).slice(0, 3);
  const hot = (overview.hot_issues || []).slice(0, 3);
  const lines = [`Tổng ${overview.total_comments || 0} phản hồi, ${negPct}% mang sắc thái tiêu cực.`];
  if (top.length) lines.push(`Chủ đề được nhắc nhiều nhất: ${top.map((t: any) => t.label).join(", ")}.`);
  if (hot.length) lines.push(`Vấn đề cần chú ý (nhiều phản hồi tiêu cực/khẩn cấp): ${hot.map((h: any) => h.label).join(", ")}.`);
  lines.push("(Tóm tắt mẫu — cấu hình LLM_PROVIDER + API key để có phân tích sâu hơn từ AI.)");
  return lines.join(" ");
}

function buildPrompt(overview: any, sampleNegatives: string[]): [string, string] {
  const system =
    "Bạn là chuyên gia phân tích sản phẩm game, viết báo cáo insight ngắn gọn cho đội vận hành game " +
    "Crossfire Legends (CFL) dựa trên số liệu phản hồi người chơi. Viết bằng tiếng Việt, súc tích, 3-5 câu, " +
    "tập trung vào vấn đề nổi cộm và đề xuất hành động. Không lặp lại số liệu thô một cách máy móc — hãy diễn giải ý nghĩa.";
  const lines = [
    `Tổng phản hồi: ${overview.total_comments || 0}, đã phân tích: ${overview.analyzed || 0}.`,
    `Tỉ lệ tiêu cực: ${overview.negative_pct || 0}%.`,
    "Top chủ đề: " + (overview.top_topics || []).slice(0, 6).map((t: any) => `${t.label} (${t.count})`).join(", "),
    "Vấn đề nổi cộm (tiêu cực + khẩn cấp): " +
      (overview.hot_issues || []).slice(0, 5).map((h: any) => `${h.label} (${h.negative} tiêu cực, ${h.urgent} khẩn cấp)`).join(", "),
  ];
  if (sampleNegatives.length) {
    lines.push("Một số bình luận tiêu cực tiêu biểu:");
    lines.push(...sampleNegatives.slice(0, 8).map((s) => `- ${s.slice(0, 200)}`));
  }
  lines.push("\nHãy viết insight tổng hợp cho team vận hành.");
  return [system, lines.join("\n")];
}

export async function generateSummary(env: Env, overview: any, sampleNegatives: string[]): Promise<string> {
  const provider = buildProvider(env.LLM_PROVIDER, env.LLM_INSIGHT_MODEL, {
    anthropicKey: env.ANTHROPIC_API_KEY, openaiKey: env.OPENAI_API_KEY, baseUrl: env.LLM_BASE_URL,
    llmViaxKey: env.LLM_VIAX_API_KEY, llmViaxBaseUrl: env.LLM_VIAX_BASE_URL,
  });
  if (!provider) return fallbackSummary(overview);
  try {
    const [system, user] = buildPrompt(overview, sampleNegatives);
    return (await provider.completeText(system, user)).trim();
  } catch {
    return fallbackSummary(overview);
  }
}
