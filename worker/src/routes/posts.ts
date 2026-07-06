import { Hono } from "hono";
import type { Env } from "../types";

export const postsRoute = new Hono<{ Bindings: Env }>();

function dateKey(value?: string | null) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function addDateFilter(where: string[], params: any[], column: string, operator: ">=" | "<=", value?: string) {
  const key = dateKey(value);
  if (!key) return;
  where.push(`substr(${column}, 1, 10) ${operator} ?`);
  params.push(key);
}

postsRoute.get("/", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: any[] = [];
  if (q.source) { where.push("p.source_type = ?"); params.push(q.source); }
  addDateFilter(where, params, "p.published_at", ">=", q.from);
  addDateFilter(where, params, "p.published_at", "<=", q.to);
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
