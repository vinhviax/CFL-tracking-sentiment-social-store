import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { filterGroupCsvRows, getCsvDateRange, ingestCsv, parseRows } from "../services/csvIngest";
import { ingestFacebook } from "../services/facebook";
import { ingestSensorTower } from "../services/sensortower";
import { SENSOR_TOWER_CURSOR_KEY } from "../services/sensortowerCursor";
import { buildRunProcessingJobs, drainProcessingQueue, enqueueProcessingJobs } from "../services/processingQueue";

export const ingestRoute = new Hono<{ Bindings: Env }>();

type IngestRunLike = { id: number; status?: string };
const FACEBOOK_DEFAULT_POST_LIMIT = 50;

function normalizeFacebookUntil(until: unknown): string | undefined {
  if (typeof until !== "string" || !until.trim()) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return until;
  const date = new Date(`${until}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return until;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function enqueueAutomatedProcessing(c: Context<{ Bindings: Env }>, run: IngestRunLike, progressPrefix: string) {
  if (run.status === "failed") return null;
  const jobs = buildRunProcessingJobs(run.id, progressPrefix);
  await enqueueProcessingJobs(c.env, jobs);
  const autoProcessing = {
    queued: true,
    analysis_progress_key: jobs[0].progress_key,
    translation_progress_key: jobs[1].progress_key,
    locale: "zh-CN",
  };
  c.executionCtx.waitUntil(
    drainProcessingQueue(c.env)
      .catch((e) => console.error(`post-ingest processing queue failed for run ${run.id}`, e))
  );
  return autoProcessing;
}

ingestRoute.get("/status", async (c) => {
  const cursor = await c.env.DB.prepare(`SELECT * FROM ingest_cursors WHERE key = ?`)
    .bind(SENSOR_TOWER_CURSOR_KEY)
    .first();
  const latestStoreRun = await c.env.DB.prepare(
    `SELECT * FROM ingest_runs WHERE source_type = 'store' ORDER BY id DESC LIMIT 1`
  ).first();
  return c.json({
    cron: {
      utc: "45 6 * * *",
      bangkok_time: "13:45",
      timezone: "Asia/Bangkok",
      cutoff: "yesterday",
    },
    sensortower_cursor: cursor,
    latest_store_run: latestStoreRun,
  });
});

ingestRoute.post("/upload-csv", async (c) => {
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File)) return c.json({ detail: "Empty file" }, 400);
  const buf = await file.arrayBuffer();
  if (buf.byteLength === 0) return c.json({ detail: "Empty file" }, 400);
  try {
    const run = await ingestCsv(c.env, buf, file.name);
    const auto_processing = await enqueueAutomatedProcessing(c, run, "ingest-fb-group");
    return c.json({ ...run, auto_processing });
  } catch (e: any) {
    return c.json({ detail: `Lỗi khi nạp file CSV: ${e.message || e}` }, 422);
  }
});

ingestRoute.post("/preview-csv", async (c) => {
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File)) return c.json({ detail: "Empty file" }, 400);
  const buf = await file.arrayBuffer();
  if (buf.byteLength === 0) return c.json({ detail: "Empty file" }, 400);
  try {
    const rows = parseRows(buf);
    const groupRows = filterGroupCsvRows(rows);
    const dataRange = getCsvDateRange(groupRows);
    return c.json({
      total_rows: rows.length,
      group_rows: groupRows.length,
      skipped_non_group_rows: rows.length - groupRows.length,
      ...dataRange,
      sample: groupRows.slice(0, 10).map((r) => ({
        source: r.source,
        created_date: r.createdDate,
        comment_message: (r.commentMessage || "").slice(0, 200),
        legacy_topic: r.legacyTopic,
      })),
    });
  } catch (e: any) {
    return c.json({ detail: `Không parse được file CSV: ${e.message || e}` }, 422);
  }
});

ingestRoute.post("/sensortower", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const end = body.end_date || new Date().toISOString().slice(0, 10);
  const start = body.start_date || new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const run = await ingestSensorTower(c.env, start, end, body.countries);
  if (run.status === "failed") return c.json({ detail: run.error }, 502);
  const auto_processing = await enqueueAutomatedProcessing(c, run, "ingest-store");
  return c.json({ ...run, auto_processing });
});

ingestRoute.post("/facebook", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const since = typeof body.since === "string" && body.since.trim() ? body.since : undefined;
  const requestedUntil = typeof body.until === "string" && body.until.trim() ? body.until : undefined;
  const postLimit = Math.max(1, Number(body.post_limit) || FACEBOOK_DEFAULT_POST_LIMIT);
  const run = await ingestFacebook(c.env, since, normalizeFacebookUntil(requestedUntil), postLimit, {
    start_date: since || null,
    end_date: requestedUntil || null,
    post_limit: postLimit,
  });
  if (run.status === "failed") return c.json({ detail: run.error }, 502);
  const auto_processing = await enqueueAutomatedProcessing(c, run, "ingest-facebook");
  return c.json({ ...run, auto_processing });
});
