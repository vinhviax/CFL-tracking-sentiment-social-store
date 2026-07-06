import type { Env } from "../types";

export type ProcessingLogLevel = "info" | "success" | "error";
export type ProcessingLogJobType = "analysis" | "translation";

export interface ProcessingLogEntry {
  processing_job_id: number;
  progress_key: string;
  job_type: ProcessingLogJobType;
  level: ProcessingLogLevel;
  phase: string;
  message: string;
  batch_index?: number | null;
  batch_total?: number | null;
  item_count?: number | null;
  provider?: string | null;
  model?: string | null;
  duration_ms?: number | null;
  error?: string | null;
}

function truncate(value: string | null | undefined, max = 1000) {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

export async function addProcessingLog(env: Env, entry: ProcessingLogEntry) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO processing_logs
       (processing_job_id, progress_key, job_type, level, phase, message,
        batch_index, batch_total, item_count, provider, model, duration_ms, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    entry.processing_job_id,
    entry.progress_key,
    entry.job_type,
    entry.level,
    entry.phase,
    truncate(entry.message, 500) || "",
    entry.batch_index ?? null,
    entry.batch_total ?? null,
    entry.item_count ?? null,
    entry.provider ?? null,
    entry.model ?? null,
    entry.duration_ms ?? null,
    truncate(entry.error),
    now
  ).run();
}

export async function safeAddProcessingLog(env: Env, entry: ProcessingLogEntry) {
  try {
    await addProcessingLog(env, entry);
  } catch (e) {
    console.warn("processing log write failed", e);
  }
}

export async function listProcessingJobLogs(env: Env, jobId: number, opts: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(Number(opts.limit) || 20, 100));
  const rows = await env.DB.prepare(
    `SELECT id, processing_job_id, progress_key, job_type, level, phase, message,
            batch_index, batch_total, item_count, provider, model, duration_ms, error, created_at
     FROM processing_logs
     WHERE processing_job_id = ?
     ORDER BY id DESC
     LIMIT ?`
  ).bind(jobId, limit).all<any>();
  return rows.results.map((row) => ({
    id: Number(row.id),
    processing_job_id: Number(row.processing_job_id),
    progress_key: row.progress_key,
    job_type: row.job_type,
    level: row.level,
    phase: row.phase,
    message: row.message,
    batch_index: row.batch_index == null ? null : Number(row.batch_index),
    batch_total: row.batch_total == null ? null : Number(row.batch_total),
    item_count: row.item_count == null ? null : Number(row.item_count),
    provider: row.provider || null,
    model: row.model || null,
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    error: row.error || null,
    created_at: row.created_at,
  }));
}
