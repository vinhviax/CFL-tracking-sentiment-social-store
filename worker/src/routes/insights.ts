import { Hono } from "hono";
import type { Env } from "../types";
import { DEFAULT_INSIGHT_SYSTEM_PROMPT, generateSummary, getInsightPrompt, normalizeInsightFilters, sampleBySentiment, saveInsightPrompt } from "../services/insights";
import { BYO_HEADER, parseByoHeader } from "../services/llmCatalog";
import { computeOverview } from "./stats";

export const insightsRoute = new Hono<{ Bindings: Env }>();

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
  const q = normalizeInsightFilters(body.filters || body);
  const overview = await computeOverview(c.env.DB, q);
  const samples = await sampleBySentiment(c.env, q);
  const locale = body.lang === "zh-CN" || q.lang === "zh-CN" ? "zh-CN" : "vi";
  const result = await generateSummary(c.env, overview, samples, body.prompt, locale, parseByoHeader(c.req.header(BYO_HEADER)));
  return c.json({ ...result, based_on: overview, filters: q });
});

insightsRoute.post("/save", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const summary = String(body.summary || "").trim();
  if (!summary) return c.json({ detail: "Chưa có Insight and Summarize để lưu." }, 400);
  const filters = normalizeInsightFilters(body.filters || {});
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

insightsRoute.delete("/saved/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ detail: "Invalid saved insight id" }, 400);
  const row = await c.env.DB.prepare(`SELECT id FROM saved_insights WHERE id = ?`).bind(id).first<{ id: number }>();
  if (!row) return c.json({ detail: "Saved insight not found" }, 404);
  await c.env.DB.prepare(`DELETE FROM saved_insights WHERE id = ?`).bind(id).run();
  return c.json({ id, deleted: true });
});
