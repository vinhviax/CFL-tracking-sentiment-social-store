import { Hono } from "hono";
import type { Env } from "../types";

export const postsRoute = new Hono<{ Bindings: Env }>();

postsRoute.get("/", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: any[] = [];
  if (q.source) { where.push("p.source_type = ?"); params.push(q.source); }
  if (q.from) { where.push("p.published_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("p.published_at <= ?"); params.push(q.to); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.max(1, Number(q.limit) || 100);

  const rows = await c.env.DB
    .prepare(
      `SELECT p.id, p.source_type, p.external_id, p.published_at, p.message, p.permalink,
              COUNT(cm.id) as comment_count,
              SUM(CASE WHEN a.sentiment = 'negative' THEN 1 ELSE 0 END) as negative_count
       FROM posts p
       LEFT JOIN comments cm ON cm.post_id = p.id
       LEFT JOIN analyses a ON a.comment_id = cm.id
       ${whereSql}
       GROUP BY p.id
       ORDER BY p.published_at DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return c.json(
    rows.results.map((r: any) => ({
      id: r.id,
      source_type: r.source_type,
      external_id: r.external_id,
      published_at: r.published_at,
      message: r.message,
      permalink: r.permalink,
      comment_count: r.comment_count || 0,
      negative_count: Number(r.negative_count || 0),
    }))
  );
});
