import type { Env } from "../types";

export async function setProgress(env: Env, key: string, patch: Record<string, any>) {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(`SELECT id FROM analyze_jobs WHERE progress_key=?`).bind(key).first();
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO analyze_jobs (progress_key, status, done, total, provider, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      key,
      patch.status ?? "queued",
      patch.done ?? 0,
      patch.total ?? 0,
      patch.provider ?? null,
      patch.error ?? null,
      now,
      now
    ).run();
    return;
  }
  const fields = Object.keys(patch);
  if (!fields.length) return;
  const sets = fields.map((f) => `${f} = ?`).join(", ");
  await env.DB.prepare(`UPDATE analyze_jobs SET ${sets}, updated_at = ? WHERE progress_key = ?`)
    .bind(...fields.map((f) => patch[f]), now, key).run();
}

export async function getProgressJob(env: Env, key: string) {
  // The queue columns come along so the UI can tell "queued, never claimed" apart from
  // "claimed and working" and from "claimed but stalled" — all three used to render as
  // an identical "waiting · 0/0 comment" line, which read as broken.
  const row = await env.DB.prepare(
    `SELECT p.status, p.done, p.total, p.provider, p.error,
            q.status AS queue_status,
            q.started_at AS queue_started_at,
            CASE WHEN q.status = 'queued' THEN (
              SELECT COUNT(*) FROM processing_queue ahead
              WHERE ahead.status IN ('queued', 'running') AND ahead.id < q.id
            ) END AS queue_ahead
     FROM analyze_jobs p
     LEFT JOIN processing_queue q ON q.progress_key = p.progress_key
     WHERE p.progress_key = ?`
  ).bind(key).first<any>();
  if (!row) return { status: "unknown", done: 0, total: 0 };
  return {
    status: row.status,
    done: Number(row.done || 0),
    total: Number(row.total || 0),
    provider: row.provider ?? null,
    error: row.error ?? null,
    queue_status: row.queue_status ?? null,
    queue_started_at: row.queue_started_at ?? null,
    queue_ahead: row.queue_ahead == null ? null : Number(row.queue_ahead),
  };
}
