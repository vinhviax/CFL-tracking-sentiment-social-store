import { Hono } from "hono";
import type { Env } from "../types";
import { deleteIngestRun } from "../services/deleteIngestRun";

export const runsRoute = new Hono<{ Bindings: Env }>();

function progressStatus(done: number, total: number): "not_applicable" | "not_started" | "partial" | "done" {
  if (!total) return "not_applicable";
  if (done <= 0) return "not_started";
  if (done >= total) return "done";
  return "partial";
}

export function mapRunRow(row: any) {
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
  };
}

const RUN_SELECT = `
  SELECT r.*,
         (
           SELECT COUNT(*)
           FROM comments c
           WHERE c.ingest_run_id = r.id
             AND c.skipped_analysis = 0
         ) AS comment_count,
         (
           SELECT COUNT(*)
           FROM comments c
           JOIN analyses a ON a.comment_id = c.id
           WHERE c.ingest_run_id = r.id
             AND c.skipped_analysis = 0
         ) AS analyzed_count,
         (
           SELECT COUNT(*)
           FROM comments c
           JOIN comment_translations t ON t.comment_id = c.id AND t.locale = 'zh-CN'
           WHERE c.ingest_run_id = r.id
             AND c.skipped_analysis = 0
         ) AS translated_zh_cn_count,
         (
           SELECT MIN(SUBSTR(c.created_at, 1, 10))
           FROM comments c
           WHERE c.ingest_run_id = r.id
             AND c.created_at IS NOT NULL
         ) AS data_start_date,
         (
           SELECT MAX(SUBSTR(c.created_at, 1, 10))
           FROM comments c
           WHERE c.ingest_run_id = r.id
             AND c.created_at IS NOT NULL
         ) AS data_end_date
  FROM ingest_runs r
`;

runsRoute.get("/", async (c) => {
  const limit = Math.max(1, Number(c.req.query("limit")) || 50);
  const rows = await c.env.DB
    .prepare(`${RUN_SELECT} ORDER BY r.id DESC LIMIT ?`)
    .bind(limit)
    .all();
  return c.json(rows.results.map(mapRunRow));
});

runsRoute.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(`${RUN_SELECT} WHERE r.id = ?`).bind(id).first();
  if (!row) return c.json({ detail: "Run not found" }, 404);
  return c.json(mapRunRow(row));
});

runsRoute.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ detail: "Invalid run id" }, 400);
  const result = await deleteIngestRun(c.env.DB, id);
  if (!result) return c.json({ detail: "Run not found" }, 404);
  return c.json(result);
});
