import { Hono } from "hono";
import type { Env } from "../types";
import { DEFAULT_INSIGHT_SYSTEM_PROMPT, generateSummary, getInsightPrompt, saveInsightPrompt, type SentimentSamples } from "../services/insights";
import { computeOverview } from "./stats";

export const insightsRoute = new Hono<{ Bindings: Env }>();

function normalizeFilters(raw: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (value == null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

async function sampleBySentiment(env: Env, q: Record<string, string>): Promise<SentimentSamples> {
  const baseWhere: string[] = [];
  const baseParams: any[] = [];
  if (q.group === "store") baseWhere.push("c.source_type = 'store'");
  if (q.group === "facebook") baseWhere.push("c.source_type IN ('fb_page','fb_group_csv')");
  if (q.source) { baseWhere.push("c.source_type = ?"); baseParams.push(q.source); }
  if (q.store) { baseWhere.push("c.store = ?"); baseParams.push(q.store); }
  if (q.from) { baseWhere.push("c.created_at >= ?"); baseParams.push(q.from); }
  if (q.to) { baseWhere.push("c.created_at <= ?"); baseParams.push(q.to); }
  if (q.topic) { baseWhere.push("a.topic_main = ?"); baseParams.push(q.topic); }
  if (q.subtopic) {
    baseWhere.push(`EXISTS (
      SELECT 1 FROM comment_subtopics cs
      JOIN taxonomy_subtopics st ON st.id = cs.subtopic_id
      WHERE cs.comment_id = c.id AND st.key = ?
    )`);
    baseParams.push(q.subtopic);
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

insightsRoute.get("/prompt", async (c) => {
  const prompt = await getInsightPrompt(c.env);
  return c.json({ prompt, default_prompt: DEFAULT_INSIGHT_SYSTEM_PROMPT });
});

insightsRoute.put("/prompt", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt || "").trim();
  if (prompt.length < 20) return c.json({ detail: "Prompt quá ngắn." }, 400);
  await saveInsightPrompt(c.env, prompt);
  return c.json({ prompt });
});

insightsRoute.post("/generate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const q = normalizeFilters(body.filters || body);
  const overview = await computeOverview(c.env.DB, q);
  const samples = await sampleBySentiment(c.env, q);
  const result = await generateSummary(c.env, overview, samples, body.prompt);
  return c.json({ ...result, based_on: overview, filters: q });
});

insightsRoute.post("/save", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const summary = String(body.summary || "").trim();
  if (!summary) return c.json({ detail: "Chưa có Insight and Summarize để lưu." }, 400);
  const filters = normalizeFilters(body.filters || {});
  const title = String(body.title || `Insight ${new Date().toLocaleDateString("vi-VN")}`).slice(0, 160);
  const createdAt = new Date().toISOString();
  const res = await c.env.DB.prepare(
    `INSERT INTO saved_insights (title, summary, filters, lang, source_group, provider, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    title,
    summary,
    JSON.stringify(filters),
    body.lang || "vi",
    filters.group || null,
    body.provider || null,
    body.model || null,
    createdAt
  ).run();
  return c.json({ id: res.meta.last_row_id, title, summary, filters, created_at: createdAt });
});

insightsRoute.get("/saved", async (c) => {
  const limit = Math.max(1, Math.min(Number(c.req.query("limit")) || 50, 100));
  const rows = await c.env.DB.prepare(
    `SELECT id, title, summary, filters, lang, source_group, provider, model, created_at
     FROM saved_insights
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(limit).all<any>();
  return c.json(rows.results.map((r) => ({
    ...r,
    filters: JSON.parse(r.filters || "{}"),
  })));
});
