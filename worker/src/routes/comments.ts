import { Hono } from "hono";
import type { Env } from "../types";

export const commentsRoute = new Hono<{ Bindings: Env }>();

const SELECT = `
  SELECT c.id, c.source_type, c.created_at, c.message, c.rating, c.country, c.store,
         c.legacy_topic, c.post_id,
         a.topic_main, a.topics_sub, a.sentiment, a.urgency, a.summary,
         a.other_suggested, a.confidence, a.provider, a.model
  FROM comments c
  LEFT JOIN analyses a ON a.comment_id = c.id
`;

function mapRow(r: any) {
  return {
    id: r.id,
    source_type: r.source_type,
    created_at: r.created_at,
    message: r.message,
    rating: r.rating,
    country: r.country,
    store: r.store,
    legacy_topic: r.legacy_topic,
    post_id: r.post_id,
    analysis: r.topic_main
      ? {
          topic_main: r.topic_main,
          topics_sub: JSON.parse(r.topics_sub || "[]"),
          sentiment: r.sentiment,
          urgency: r.urgency,
          summary: r.summary,
          other_suggested: r.other_suggested,
          confidence: r.confidence,
          provider: r.provider,
          model: r.model,
        }
      : null,
  };
}

commentsRoute.get("/", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: any[] = [];

  if (q.source) { where.push("c.source_type = ?"); params.push(q.source); }
  if (q.post_id) { where.push("c.post_id = ?"); params.push(Number(q.post_id)); }
  if (q.store) { where.push("c.store = ?"); params.push(q.store); }
  if (q.q) { where.push("c.message LIKE ?"); params.push(`%${q.q}%`); }
  if (q.from) { where.push("c.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("c.created_at <= ?"); params.push(q.to); }
  if (q.topic) { where.push("a.topic_main = ?"); params.push(q.topic); }
  if (q.sentiment) { where.push("a.sentiment = ?"); params.push(q.sentiment); }
  if (q.urgency) { where.push("a.urgency = ?"); params.push(q.urgency); }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.max(1, Number(q.page_size) || 50);

  const countRes = await c.env.DB
    .prepare(`SELECT COUNT(*) as total FROM comments c LEFT JOIN analyses a ON a.comment_id = c.id ${whereSql}`)
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB
    .prepare(`${SELECT} ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, pageSize, (page - 1) * pageSize)
    .all();

  return c.json({
    total: countRes?.total || 0,
    page,
    page_size: pageSize,
    items: rows.results.map(mapRow),
  });
});
