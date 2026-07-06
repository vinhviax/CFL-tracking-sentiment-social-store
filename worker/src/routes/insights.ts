import { Hono } from "hono";
import type { Env } from "../types";
import { generateSummary } from "../services/insights";
import { computeOverview } from "./stats";

export const insightsRoute = new Hono<{ Bindings: Env }>();

insightsRoute.get("/summary", async (c) => {
  const q = c.req.query();
  const overview = await computeOverview(c.env.DB, q);

  const where: string[] = ["a.sentiment = 'negative'"];
  const params: any[] = [];
  if (q.source) { where.push("c.source_type = ?"); params.push(q.source); }
  if (q.from) { where.push("c.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("c.created_at <= ?"); params.push(q.to); }

  const rows = await c.env.DB
    .prepare(
      `SELECT c.message FROM comments c JOIN analyses a ON a.comment_id=c.id
       WHERE ${where.join(" AND ")} ORDER BY c.id DESC LIMIT 8`
    ).bind(...params).all<{ message: string }>();

  const summary = await generateSummary(c.env, overview, rows.results.map((r) => r.message));
  return c.json({ summary, based_on: overview });
});
