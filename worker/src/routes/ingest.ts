import { Hono } from "hono";
import type { Env } from "../types";
import { ingestCsv, parseRows } from "../services/csvIngest";
import { ingestFacebook } from "../services/facebook";
import { ingestSensorTower } from "../services/sensortower";
import { SENSOR_TOWER_CURSOR_KEY } from "../services/sensortowerCursor";

export const ingestRoute = new Hono<{ Bindings: Env }>();

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
    return c.json(run);
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
    return c.json({
      total_rows: rows.length,
      sample: rows.slice(0, 10).map((r) => ({
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
  return c.json(run);
});

ingestRoute.post("/facebook", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const run = await ingestFacebook(c.env, body.since, body.until, body.post_limit || 10);
  if (run.status === "failed") return c.json({ detail: run.error }, 502);
  return c.json(run);
});
