import { Hono } from "hono";
import * as XLSX from "xlsx";
import type { Env } from "../types";
import { SENTIMENT_LABELS_VI, TOPIC_LABELS_VI } from "../taxonomy";

export const exportRoute = new Hono<{ Bindings: Env }>();

exportRoute.get("/", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: any[] = [];
  if (q.source) { where.push("c.source_type = ?"); params.push(q.source); }
  if (q.topic) { where.push("a.topic_main = ?"); params.push(q.topic); }
  if (q.sentiment) { where.push("a.sentiment = ?"); params.push(q.sentiment); }
  if (q.urgency) { where.push("a.urgency = ?"); params.push(q.urgency); }
  if (q.from) { where.push("c.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("c.created_at <= ?"); params.push(q.to); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await c.env.DB
    .prepare(
      `SELECT c.id, c.source_type, c.created_at, c.message, c.rating,
              a.topic_main, a.topics_sub, a.sentiment, a.urgency, a.summary, a.confidence
       FROM comments c LEFT JOIN analyses a ON a.comment_id = c.id
       ${whereSql}
       ORDER BY c.created_at DESC`
    ).bind(...params).all<any>();

  const headers = ["ID", "Nguồn", "Thời gian", "Nội dung", "Rating", "Chủ đề chính",
    "Chủ đề phụ", "Sentiment", "Mức độ khẩn cấp", "Tóm tắt", "Độ tin cậy"];
  const data = rows.results.map((r) => [
    r.id, r.source_type, r.created_at || "", r.message, r.rating ?? "",
    r.topic_main ? (TOPIC_LABELS_VI[r.topic_main] || r.topic_main) : "",
    r.topics_sub ? JSON.parse(r.topics_sub).map((t: string) => TOPIC_LABELS_VI[t] || t).join(", ") : "",
    r.sentiment ? (SENTIMENT_LABELS_VI[r.sentiment] || r.sentiment) : "",
    r.urgency || "", r.summary || "", r.confidence != null ? Math.round(r.confidence * 100) / 100 : "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws["!cols"] = headers.map((h) => ({ wch: h === "Nội dung" || h === "Tóm tắt" ? 60 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Feedback");
  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const filename = `CFL_Feedback_Export_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
