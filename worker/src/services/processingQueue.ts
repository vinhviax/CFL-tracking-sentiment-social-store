import type { Env } from "../types";
import { runAnalysis } from "./analysis";
import { discoverAndStoreRunMemory } from "./taxonomyMemory";
import { DEFAULT_TRANSLATION_LOCALE, runTranslation } from "./translation";
import { setProgress } from "./progressJobs";

export type ProcessingJobType = "analysis" | "translation";

export interface ProcessingJobSpec {
  job_type: ProcessingJobType;
  progress_key: string;
  run_id?: number;
  comment_ids?: number[];
  locale?: string;
  force?: boolean;
  limit?: number;
}

export interface ProcessingQueueJob extends ProcessingJobSpec {
  id: number;
  run_id?: number;
  comment_ids?: number[];
  locale?: string;
  force?: boolean;
  limit?: number;
}

type QueueStore = {
  enqueueJobs(env: Env, jobs: ProcessingJobSpec[]): Promise<void>;
  claimNext(env: Env): Promise<ProcessingQueueJob | null>;
  markDone(env: Env, id: number): Promise<void>;
  markFailed(env: Env, id: number, error: string): Promise<void>;
};

type QueueDeps = {
  runAnalysis: typeof runAnalysis;
  discoverAndStoreRunMemory: typeof discoverAndStoreRunMemory;
  runTranslation: typeof runTranslation;
};

const defaultDeps: QueueDeps = {
  runAnalysis,
  discoverAndStoreRunMemory,
  runTranslation,
};

const STALE_RUNNING_MS = 10 * 60 * 1000;

export async function recoverStaleProcessingJobs(env: Env, staleMs = STALE_RUNNING_MS) {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  await env.DB.prepare(
    `UPDATE processing_queue
     SET status = 'queued', updated_at = ?, error = NULL
     WHERE status = 'running'
       AND updated_at < ?`
  ).bind(new Date().toISOString(), cutoff).run();
}

const d1QueueStore: QueueStore = {
  async enqueueJobs(env, jobs) {
    const now = new Date().toISOString();
    const statements = jobs.map((job) =>
      env.DB.prepare(
        `INSERT INTO processing_queue
           (job_type, run_id, comment_ids_json, locale, progress_key, force, limit_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
         ON CONFLICT(progress_key) DO UPDATE SET
           status = CASE
             WHEN processing_queue.status IN ('queued', 'running') THEN processing_queue.status
             ELSE 'queued'
           END,
           error = NULL,
           updated_at = excluded.updated_at`
      ).bind(
        job.job_type,
        job.run_id ?? null,
        job.comment_ids?.length ? JSON.stringify(job.comment_ids) : null,
        job.locale ?? null,
        job.progress_key,
        job.force ? 1 : 0,
        job.limit ?? null,
        now,
        now
      )
    );
    if (statements.length) await env.DB.batch(statements);
  },

  async claimNext(env) {
    await recoverStaleProcessingJobs(env);
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `UPDATE processing_queue
       SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?, error = NULL
       WHERE id = (
         SELECT id
         FROM processing_queue
         WHERE status = 'queued'
           AND NOT EXISTS (SELECT 1 FROM processing_queue WHERE status = 'running')
         ORDER BY id
         LIMIT 1
       )
       RETURNING id, job_type, run_id, comment_ids_json, locale, progress_key, force, limit_count`
    ).bind(now, now).first<any>();
    if (!row) return null;
    return {
      id: Number(row.id),
      job_type: row.job_type,
      run_id: row.run_id == null ? undefined : Number(row.run_id),
      comment_ids: row.comment_ids_json ? JSON.parse(row.comment_ids_json) : undefined,
      locale: row.locale || undefined,
      progress_key: row.progress_key,
      force: Boolean(row.force),
      limit: row.limit_count == null ? undefined : Number(row.limit_count),
    };
  },

  async markDone(env, id) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE processing_queue SET status = 'done', finished_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, id).run();
  },

  async markFailed(env, id, error) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE processing_queue SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`
    ).bind(error, now, now, id).run();
  },
};

export async function listProcessingJobs(env: Env, opts: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(Number(opts.limit) || 20, 100));
  const rows = await env.DB.prepare(
    `SELECT q.id, q.job_type, q.run_id, q.locale, q.progress_key, q.force, q.limit_count,
            q.status, q.error, q.created_at, q.updated_at, q.started_at, q.finished_at,
            p.status AS progress_status, p.done, p.total, p.provider, p.error AS progress_error,
            r.source_type, r.status AS run_status, r.rows_new, r.rows_fetched, r.started_at AS run_started_at,
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
     FROM processing_queue q
     LEFT JOIN analyze_jobs p ON p.progress_key = q.progress_key
     LEFT JOIN ingest_runs r ON r.id = q.run_id
     WHERE q.status IN ('queued', 'running', 'failed')
     ORDER BY q.id
     LIMIT ?`
  ).bind(limit).all<any>();
  return rows.results.map((row) => ({
    id: Number(row.id),
    job_type: row.job_type,
    run_id: row.run_id == null ? null : Number(row.run_id),
    locale: row.locale || null,
    progress_key: row.progress_key,
    status: row.status,
    error: row.error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at || null,
    finished_at: row.finished_at || null,
    progress: {
      status: row.progress_status || row.status,
      done: Number(row.done || 0),
      total: Number(row.total || 0),
      provider: row.provider || null,
      error: row.progress_error || null,
    },
    run: row.run_id == null ? null : {
      id: Number(row.run_id),
      source_type: row.source_type || null,
      status: row.run_status || null,
      rows_new: Number(row.rows_new || 0),
      rows_fetched: Number(row.rows_fetched || 0),
      started_at: row.run_started_at || null,
      data_start_date: row.data_start_date || null,
      data_end_date: row.data_end_date || null,
    },
  }));
}

export function buildRunProcessingJobs(runId: number, progressPrefix: string, locale = DEFAULT_TRANSLATION_LOCALE) {
  return [
    { job_type: "analysis" as const, run_id: runId, progress_key: `${progressPrefix}-analyze-${runId}` },
    { job_type: "translation" as const, run_id: runId, progress_key: `${progressPrefix}-translate-${runId}`, locale },
  ];
}

export async function enqueueProcessingJobs(
  env: Env,
  jobs: ProcessingJobSpec[],
  store: QueueStore = d1QueueStore
) {
  for (const job of jobs) {
    await setProgress(env, job.progress_key, { status: "queued", done: 0, total: 0, provider: null, error: null });
  }
  await store.enqueueJobs(env, jobs);
}

export async function drainProcessingQueue(
  env: Env,
  deps: QueueDeps = defaultDeps,
  store: QueueStore = d1QueueStore
) {
  while (true) {
    const job = await store.claimNext(env);
    if (!job) return;
    try {
      if (job.job_type === "analysis") {
        await deps.runAnalysis(env, { runId: job.run_id, commentIds: job.comment_ids, progressKey: job.progress_key });
        if (job.run_id != null) await deps.discoverAndStoreRunMemory(env, { runId: job.run_id });
      } else {
        await deps.runTranslation(env, {
          runId: job.run_id,
          commentIds: job.comment_ids,
          progressKey: job.progress_key,
          locale: job.locale || DEFAULT_TRANSLATION_LOCALE,
          force: job.force,
          limit: job.limit,
        });
      }
      await store.markDone(env, job.id);
    } catch (e: any) {
      const error = e?.message || String(e);
      await setProgress(env, job.progress_key, { status: "failed", error });
      await store.markFailed(env, job.id, error);
    }
  }
}
