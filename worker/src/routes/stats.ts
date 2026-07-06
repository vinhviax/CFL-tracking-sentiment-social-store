import { Hono } from "hono";
import type { Env } from "../types";
import { TOPIC_LABELS_VI } from "../taxonomy";

export const statsRoute = new Hono<{ Bindings: Env }>();

function baseFilters(q: Record<string, string>) {
  const where: string[] = [];
  const params: any[] = [];
  if (q.source) { where.push("c.source_type = ?"); params.push(q.source); }
  if (q.from) { where.push("c.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("c.created_at <= ?"); params.push(q.to); }
  return { where, params };
}

export async function computeOverview(db: D1Database, q: Record<string, string>) {
  const { where, params } = baseFilters(q);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = await db.prepare(`SELECT COUNT(*) as n FROM comments c ${whereSql}`).bind(...params).first<{ n: number }>();
  const analyzedRow = await db
    .prepare(`SELECT COUNT(*) as n FROM comments c JOIN analyses a ON a.comment_id = c.id ${whereSql}`)
    .bind(...params).first<{ n: number }>();

  const sentimentRows = await db
    .prepare(`SELECT a.sentiment, COUNT(*) as n FROM comments c JOIN analyses a ON a.comment_id=c.id ${whereSql} GROUP BY a.sentiment`)
    .bind(...params).all<{ sentiment: string; n: number }>();
  const sentiment: Record<string, number> = { negative: 0, neutral: 0, positive: 0 };
  for (const r of sentimentRows.results) sentiment[r.sentiment] = r.n;

  const topicRows = await db
    .prepare(`SELECT a.topic_main, COUNT(*) as n FROM comments c JOIN analyses a ON a.comment_id=c.id ${whereSql} GROUP BY a.topic_main ORDER BY n DESC`)
    .bind(...params).all<{ topic_main: string; n: number }>();
  const topTopics = topicRows.results.map((r) => ({ topic: r.topic_main, label: TOPIC_LABELS_VI[r.topic_main] || r.topic_main, count: r.n }));

  const hotWhere = [...where, "a.sentiment = 'negative'"];
  const hotRows = await db
    .prepare(
      `SELECT a.topic_main, COUNT(*) as negative, SUM(CASE WHEN a.urgency IN ('medium','high') THEN 1 ELSE 0 END) as urgent
       FROM comments c JOIN analyses a ON a.comment_id=c.id
       WHERE ${hotWhere.join(" AND ")}
       GROUP BY a.topic_main
       ORDER BY urgent DESC, negative DESC
       LIMIT 8`
    ).bind(...params).all<{ topic_main: string; negative: number; urgent: number }>();
  const hotIssues = hotRows.results.map((r) => ({
    topic: r.topic_main, label: TOPIC_LABELS_VI[r.topic_main] || r.topic_main,
    negative: r.negative, urgent: Number(r.urgent || 0),
  }));

  const analyzed = analyzedRow?.n || 0;
  const neg = sentiment.negative || 0;
  return {
    total_comments: totalRow?.n || 0,
    analyzed,
    sentiment,
    negative_pct: analyzed ? Math.round((neg / analyzed) * 1000) / 10 : 0,
    top_topics: topTopics,
    hot_issues: hotIssues,
  };
}

statsRoute.get("/overview", async (c) => {
  const overview = await computeOverview(c.env.DB, c.req.query());
  return c.json(overview);
});

statsRoute.get("/trend", async (c) => {
  const q = c.req.query();
  const { where, params } = baseFilters(q);
  const w = [...where];
  if (q.topic) w.push("a.topic_main = ?");
  const p = [...params];
  if (q.topic) p.push(q.topic);
  const whereSql = w.length ? `WHERE ${w.join(" AND ")}` : "";

  const rows = await c.env.DB
    .prepare(
      `SELECT date(c.created_at) as d, a.sentiment, COUNT(*) as n
       FROM comments c JOIN analyses a ON a.comment_id = c.id
       ${whereSql}
       GROUP BY d, a.sentiment ORDER BY d`
    ).bind(...p).all<{ d: string; sentiment: string; n: number }>();

  const series = new Map<string, any>();
  for (const r of rows.results) {
    if (!r.d) continue;
    if (!series.has(r.d)) series.set(r.d, { date: r.d, negative: 0, neutral: 0, positive: 0 });
    series.get(r.d)[r.sentiment] = r.n;
  }
  return c.json([...series.values()]);
});

statsRoute.get("/store", async (c) => {
  const q = c.req.query();
  const where = ["c.source_type = 'store'"];
  const params: any[] = [];
  if (q.from) { where.push("c.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("c.created_at <= ?"); params.push(q.to); }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const db = c.env.DB;

  const ratingRows = await db
    .prepare(`SELECT c.rating, COUNT(*) as n FROM comments c ${whereSql} GROUP BY c.rating`)
    .bind(...params).all<{ rating: number; n: number }>();
  const ratingDist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const r of ratingRows.results) if (r.rating) ratingDist[String(r.rating)] = r.n;

  const platformRows = await db
    .prepare(`SELECT c.store, COUNT(*) as n, AVG(c.rating) as avg_rating FROM comments c ${whereSql} GROUP BY c.store`)
    .bind(...params).all<{ store: string; n: number; avg_rating: number }>();
  const platforms = platformRows.results.map((r) => ({
    store: r.store || "unknown", count: r.n, avg_rating: Math.round((r.avg_rating || 0) * 100) / 100,
  }));

  return c.json({ rating_distribution: ratingDist, platforms });
});
