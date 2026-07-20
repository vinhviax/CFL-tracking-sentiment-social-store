import { Hono } from "hono";
import * as XLSX from "xlsx";
import type { Env } from "../types";
import { LEGACY_TOPIC_LABELS_VI, SENTIMENT_LABELS_VI, TOPIC_LABELS_VI } from "../taxonomy";
import { buildCommentFilters } from "../services/commentFilters";

export const exportRoute = new Hono<{ Bindings: Env }>();

// Worker builds the whole .xlsx in memory; cap rows to avoid OOM on huge ranges.
const MAX_EXPORT_ROWS = 50000;

const STORE_LABELS_VI: Record<string, string> = { gp: "Google Play", ios: "App Store" };
const SOURCE_LABELS_VI: Record<string, string> = {
  store: "Store",
  fb_page: "Facebook Page",
  fb_group_csv: "Facebook Group",
};

function safeSlug(value: string) {
  return value.replace(/[^0-9A-Za-z]/g, "");
}

exportRoute.get("/", async (c) => {
  const q = c.req.query();
  const lang = q.lang === "zh-CN" ? "zh-CN" : "vi";

  const { where, params: filterParams, error } = buildCommentFilters(q);
  if (error) return c.json({ detail: error }, 400);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRow = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS total
       FROM comments c
       LEFT JOIN analyses a ON a.comment_id = c.id
       LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
       ${whereSql}`
    )
    .bind(lang, ...filterParams)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  if (total > MAX_EXPORT_ROWS) {
    return c.json(
      {
        detail: `Số dòng (${total}) vượt giới hạn xuất ${MAX_EXPORT_ROWS}. Vui lòng thu hẹp khoảng thời gian hoặc thêm bộ lọc.`,
      },
      413
    );
  }

  const rows = await c.env.DB
    .prepare(
      `SELECT c.id, c.source_type, c.created_at, c.message, c.rating, c.country, c.store,
              p.permalink AS post_permalink,
              a.topic_main, a.topics_sub, a.sentiment, a.urgency, a.summary, a.confidence
       FROM comments c
       LEFT JOIN posts p ON p.id = c.post_id
       LEFT JOIN analyses a ON a.comment_id = c.id
       LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
       ${whereSql}
       ORDER BY c.created_at DESC`
    )
    .bind(lang, ...filterParams)
    .all<any>();

  const headers = ["ID", "Nguồn", "Thời gian", "Quốc gia", "Chợ ứng dụng", "Nội dung",
    "Rating", "Chủ đề chính", "Chủ đề phụ", "Sentiment", "Mức độ khẩn cấp",
    "Tóm tắt", "Độ tin cậy", "Link post Facebook"];
  const data = rows.results.map((r) => [
    r.id,
    SOURCE_LABELS_VI[r.source_type] || r.source_type,
    r.created_at || "",
    r.country || "",
    r.store ? (STORE_LABELS_VI[r.store] || r.store) : "",
    r.message,
    r.rating ?? "",
    r.topic_main ? (TOPIC_LABELS_VI[r.topic_main] || LEGACY_TOPIC_LABELS_VI[r.topic_main] || r.topic_main) : "",
    r.topics_sub ? JSON.parse(r.topics_sub).map((t: string) => TOPIC_LABELS_VI[t] || LEGACY_TOPIC_LABELS_VI[t] || t).join(", ") : "",
    r.sentiment ? (SENTIMENT_LABELS_VI[r.sentiment] || r.sentiment) : "",
    r.urgency || "",
    r.summary || "",
    r.confidence != null ? Math.round(r.confidence * 100) / 100 : "",
    r.post_permalink || "",
  ]);

  const wideCols = new Set(["Nội dung", "Tóm tắt", "Link post Facebook"]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws["!cols"] = headers.map((h) => ({ wch: wideCols.has(h) ? 60 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Feedback");
  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const scope = q.group === "facebook" ? "Facebook" : q.group === "store" ? "Store" : "All";
  const range = [q.from, q.to].filter(Boolean).map(safeSlug).join("-");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `CFL_Comments_${scope}_${range || stamp}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
