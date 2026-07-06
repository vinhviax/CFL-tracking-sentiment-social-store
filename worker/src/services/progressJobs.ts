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
  const row = await env.DB.prepare(`SELECT status, done, total, provider, error FROM analyze_jobs WHERE progress_key=?`)
    .bind(key).first();
  return row || { status: "unknown", done: 0, total: 0 };
}
