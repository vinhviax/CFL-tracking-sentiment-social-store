import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { deleteIngestRun } from "../services/deleteIngestRun";
import { loadQueueActivity, pickStaleRunIds, refreshRunCounts } from "../services/runCounters";
import { loadRunTokenUsage, sumTokenUsage, type TokenUsageGroup } from "../services/tokenUsage";

export const runsRoute = new Hono<{ Bindings: Env }>();

function progressStatus(done: number, total: number): "not_applicable" | "not_started" | "partial" | "done" {
  if (!total) return "not_applicable";
  if (done <= 0) return "not_started";
  if (done >= total) return "done";
  return "partial";
}

/**
 * Split a run's token groups by job type. Returns null for a job type with no
 * logged batches so the UI shows "no data" rather than a zero that looks like
 * a free run — runs processed before token logging existed have none.
 */
function tokensForJobType(groups: TokenUsageGroup[], jobType: string) {
  const matching = groups.filter((g) => g.job_type === jobType);
  if (!matching.length) return null;
  const total = sumTokenUsage(matching);
  return {
    ...total,
    /** More than one entry means the job spanned models, e.g. a mid-run config change. */
    by_model: matching.map((g) => ({
      model: g.model,
      input_tokens: g.input_tokens,
      output_tokens: g.output_tokens,
    })),
  };
}

export function mapRunRow(row: any, tokenGroups: TokenUsageGroup[] = []) {
  const total = Number(row.comment_count || 0);
  const analyzed = Number(row.analyzed_count || 0);
  const translatedZhCn = Number(row.translated_zh_cn_count || 0);
  return {
    ...row,
    comment_count: total,
    analyzed_count: analyzed,
    translated_zh_cn_count: translatedZhCn,
    analysis_status: progressStatus(analyzed, total),
    translation_status: progressStatus(translatedZhCn, total),
    analysis_progress: { done: analyzed, total },
    translation_progress: { done: translatedZhCn, total, locale: "zh-CN" },
    analysis_tokens: tokensForJobType(tokenGroups, "analysis"),
    translation_tokens: tokensForJobType(tokenGroups, "translation"),
  };
}

/**
 * Counts come from the cached columns on ingest_runs, not from subqueries over the raw
 * tables. Runs whose work can still move are recounted on the way past — see
 * services/runCounters.ts for the rule and migration 0018 for why this exists.
 */
async function withFreshCounts(c: Context<{ Bindings: Env }>, rows: any[]) {
  if (!rows.length) return rows;
  const activity = await loadQueueActivity(c.env);
  const fresh = await refreshRunCounts(c.env, pickStaleRunIds(rows, activity));
  return rows.map((row) => {
    const snapshot = fresh.get(Number(row.id));
    return snapshot ? { ...row, ...snapshot } : row;
  });
}

runsRoute.get("/", async (c) => {
  const limit = Math.max(1, Number(c.req.query("limit")) || 50);
  const rows = await c.env.DB
    .prepare(`SELECT * FROM ingest_runs ORDER BY id DESC LIMIT ?`)
    .bind(limit)
    .all();
  const results = await withFreshCounts(c, rows.results as any[]);
  const tokensByRun = await loadRunTokenUsage(c.env, results.map((row) => Number(row.id)));
  return c.json(results.map((row) => mapRunRow(row, tokensByRun.get(Number(row.id)) || [])));
});

runsRoute.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(`SELECT * FROM ingest_runs WHERE id = ?`).bind(id).first();
  if (!row) return c.json({ detail: "Run not found" }, 404);
  const [fresh] = await withFreshCounts(c, [row as any]);
  const tokensByRun = await loadRunTokenUsage(c.env, [id]);
  return c.json(mapRunRow(fresh, tokensByRun.get(id) || []));
});

runsRoute.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ detail: "Invalid run id" }, 400);
  const result = await deleteIngestRun(c.env.DB, id);
  if (!result) return c.json({ detail: "Run not found" }, 404);
  return c.json(result);
});
