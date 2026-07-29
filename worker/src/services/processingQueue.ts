import type { Env } from "../types";
import { runAnalysis } from "./analysis";
import { discoverAndStoreRunMemory } from "./taxonomyMemory";
import { DEFAULT_TRANSLATION_LOCALE, runTranslation } from "./translation";
import { setProgress } from "./progressJobs";
import { parseBoundedInt } from "./concurrency";
import type { ByoOverride } from "./llmAgentConfig";

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
  /** First-claim time, used as the cutoff for a forced re-run so retries converge. */
  started_at?: string;
  run_id?: number;
  comment_ids?: number[];
  locale?: string;
  force?: boolean;
  limit?: number;
}

type QueueStore = {
  enqueueJobs(env: Env, jobs: ProcessingJobSpec[]): Promise<void>;
  claimNext(env: Env, opts?: { maxRunning?: number }): Promise<ProcessingQueueJob | null>;
  markDone(env: Env, id: number): Promise<void>;
  requeue(env: Env, id: number): Promise<void>;
  failAttempt(env: Env, id: number, error: string, maxAttempts: number): Promise<{ willRetry: boolean; attempts: number }>;
  markFailed(env: Env, id: number, error: string): Promise<void>;
  markCancelled(env: Env, id: number, error: string): Promise<void>;
  isCancelled(env: Env, id: number): Promise<boolean>;
  cancelJob(env: Env, id: number, error: string): Promise<{ id: number; progress_key: string } | null>;
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

/**
 * How long a 'running' job may go without logging a batch before it is considered
 * abandoned and returned to the queue.
 *
 * Short, because the common failure is a drain whose Worker invocation ends mid-flight
 * (waitUntil cut off, or a limit hit): the row stays 'running' with nothing to finish
 * it, and until it is reclaimed the run simply stops. Safe to keep short because
 * liveness is measured from the job's newest batch log, not from when it started — a
 * job that is still working keeps logging.
 */
const STALE_RUNNING_MS = 3 * 60 * 1000;
/**
 * Retries per job before giving up. High on purpose: every attempt processes up to
 * PROCESSING_JOB_MAX_BATCHES batches and only re-selects what is still unprocessed, so
 * attempts are progress, not repetition. This is a runaway guard, not a budget.
 */
const MAX_JOB_ATTEMPTS = 200;
const DEFAULT_QUEUE_CONCURRENCY = 2;
const MAX_QUEUE_CONCURRENCY = 5;
const DEFAULT_JOB_MAX_BATCHES = 3;
const MAX_JOB_MAX_BATCHES = 10;
const CANCELLED_ERROR = "Processing job cancelled";
const USER_CANCELLED_ERROR = "Processing job cancelled by user";

export class ProcessingJobCancelledError extends Error {
  constructor(message = CANCELLED_ERROR) {
    super(message);
    this.name = "ProcessingJobCancelledError";
  }
}

export function getProcessingQueueConcurrency(env: Env) {
  return parseBoundedInt(env.PROCESSING_QUEUE_CONCURRENCY, 1, MAX_QUEUE_CONCURRENCY, DEFAULT_QUEUE_CONCURRENCY);
}

export function getProcessingJobMaxBatches(env: Env) {
  return parseBoundedInt(env.PROCESSING_JOB_MAX_BATCHES, 1, MAX_JOB_MAX_BATCHES, DEFAULT_JOB_MAX_BATCHES);
}

export async function recoverStaleProcessingJobs(env: Env, staleMs = STALE_RUNNING_MS) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE processing_queue
     SET status = 'done', finished_at = COALESCE(finished_at, ?), updated_at = ?
     WHERE status = 'running'
       AND EXISTS (
         SELECT 1
         FROM analyze_jobs p
         WHERE p.progress_key = processing_queue.progress_key
           AND p.status = 'done'
       )`
  ).bind(now, now).run();

  // Liveness is the newest batch log for the job, falling back to updated_at for a job
  // that died before logging anything. Using started_at/updated_at alone would either
  // reclaim a job that is still working or wait far too long to notice a dead one.
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  await env.DB.prepare(
    `UPDATE processing_queue
     SET status = 'queued', updated_at = ?, error = NULL
     WHERE status = 'running'
       AND COALESCE(
             (SELECT MAX(l.created_at) FROM processing_logs l WHERE l.processing_job_id = processing_queue.id),
             processing_queue.updated_at
           ) < ?`
  ).bind(new Date().toISOString(), cutoff).run();
}

/**
 * Re-queue jobs that failed but still have attempts left, so a transient upstream error
 * (502 from the LLM proxy, a dropped connection) does not end a run permanently.
 */
export async function retryFailedProcessingJobs(env: Env, maxAttempts = MAX_JOB_ATTEMPTS) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE processing_queue
     SET status = 'queued', updated_at = ?, finished_at = NULL
     WHERE status = 'failed' AND attempts < ?`
  ).bind(now, maxAttempts).run();
  return Number(result.meta?.changes || 0);
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

  async claimNext(env, opts = {}) {
    await recoverStaleProcessingJobs(env);
    const now = new Date().toISOString();
    const maxRunning = parseBoundedInt(opts.maxRunning, 1, MAX_QUEUE_CONCURRENCY, DEFAULT_QUEUE_CONCURRENCY);
    const row = await env.DB.prepare(
      `UPDATE processing_queue
       SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?, error = NULL
       WHERE id = (
         SELECT q.id
         FROM processing_queue q
         WHERE q.status = 'queued'
           AND (SELECT COUNT(*) FROM processing_queue WHERE status = 'running') < ?
           AND NOT (
             q.job_type = 'translation'
             AND EXISTS (
               SELECT 1
               FROM processing_queue blocker
               WHERE blocker.job_type = 'analysis'
                 AND blocker.status IN ('queued', 'running')
                 AND blocker.id < q.id
                 AND (
                   (q.run_id IS NOT NULL AND blocker.run_id = q.run_id)
                   OR (q.run_id IS NULL AND blocker.run_id IS NULL)
                 )
             )
           )
         ORDER BY q.id
         LIMIT 1
       )
       RETURNING id, job_type, run_id, comment_ids_json, locale, progress_key, force, limit_count, started_at`
    ).bind(now, now, maxRunning).first<any>();
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
      started_at: row.started_at || undefined,
    };
  },

  async markDone(env, id) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE processing_queue SET status = 'done', finished_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, id).run();
  },

  async requeue(env, id) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE processing_queue SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'running'`
    ).bind(now, id).run();
  },

  /**
   * Count the attempt and put the job back in the queue unless it has used them all.
   * Returns true when the job will be retried, so the caller can report "will retry"
   * rather than "failed".
   */
  async failAttempt(env, id, error, maxAttempts) {
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `UPDATE processing_queue
       SET attempts = attempts + 1,
           error = ?,
           updated_at = ?,
           status = CASE WHEN attempts + 1 < ? THEN 'queued' ELSE 'failed' END,
           finished_at = CASE WHEN attempts + 1 < ? THEN NULL ELSE ? END
       WHERE id = ?
       RETURNING status, attempts`
    ).bind(error, now, maxAttempts, maxAttempts, now, id).first<{ status: string; attempts: number }>();
    return { willRetry: row?.status === "queued", attempts: Number(row?.attempts || 0) };
  },

  async markFailed(env, id, error) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE processing_queue SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`
    ).bind(error, now, now, id).run();
  },

  async markCancelled(env, id, error) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE processing_queue SET status = 'cancelled', error = ?, finished_at = COALESCE(finished_at, ?), updated_at = ? WHERE id = ?`
    ).bind(error, now, now, id).run();
  },

  async isCancelled(env, id) {
    const row = await env.DB.prepare(`SELECT status FROM processing_queue WHERE id = ?`).bind(id).first<any>();
    return row?.status === "cancelled";
  },

  async cancelJob(env, id, error) {
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `UPDATE processing_queue
       SET status = 'cancelled', error = ?, finished_at = COALESCE(finished_at, ?), updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running', 'failed')
       RETURNING id, progress_key`
    ).bind(error, now, now, id).first<any>();
    if (!row) return null;
    return { id: Number(row.id), progress_key: row.progress_key };
  },
};

export async function listProcessingJobs(env: Env, opts: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(Number(opts.limit) || 20, 100));
  const rows = await env.DB.prepare(
    `SELECT q.id, q.job_type, q.run_id, q.locale, q.progress_key, q.force, q.limit_count,
            q.status, q.error, q.created_at, q.updated_at, q.started_at, q.finished_at,
            p.status AS progress_status, p.done, p.total, p.provider, p.error AS progress_error,
            r.source_type, r.status AS run_status, r.rows_new, r.rows_fetched, r.started_at AS run_started_at,
            r.note AS run_note,
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
      note: row.run_note || null,
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

export async function cancelProcessingJob(env: Env, id: number, store: QueueStore = d1QueueStore) {
  const cancelled = await store.cancelJob(env, id, USER_CANCELLED_ERROR);
  if (!cancelled) return null;
  await setProgress(env, cancelled.progress_key, { status: "cancelled", error: USER_CANCELLED_ERROR });
  return { id: cancelled.id, status: "cancelled" };
}

export async function drainProcessingQueue(
  env: Env,
  deps: QueueDeps = defaultDeps,
  store: QueueStore = d1QueueStore,
  opts: { maxConcurrentJobs?: number; byo?: ByoOverride | null } = {}
) {
  const maxRunning = parseBoundedInt(
    opts.maxConcurrentJobs ?? env.PROCESSING_QUEUE_CONCURRENCY,
    1,
    MAX_QUEUE_CONCURRENCY,
    DEFAULT_QUEUE_CONCURRENCY
  );

  async function runJob(job: ProcessingQueueJob) {
    const ensureNotCancelled = async () => {
      if (await store.isCancelled(env, job.id)) throw new ProcessingJobCancelledError();
    };

    try {
      await ensureNotCancelled();
      if (job.job_type === "analysis") {
        const result = await deps.runAnalysis(env, {
          jobId: job.id,
          runId: job.run_id,
          commentIds: job.comment_ids,
          progressKey: job.progress_key,
          maxBatches: getProcessingJobMaxBatches(env),
          force: job.force,
          forceSince: job.started_at,
          shouldContinue: ensureNotCancelled,
          // In-memory only: a BYO provider belongs to the request that carried it,
          // so a later drain (cron, or after the tab closed) uses the slot default.
          byo: opts.byo,
        });
        if ((result as any)?.complete === false) {
          await store.requeue(env, job.id);
          return false;
        }
        await ensureNotCancelled();
        if (job.run_id != null) await deps.discoverAndStoreRunMemory(env, { runId: job.run_id });
      } else {
        const result = await deps.runTranslation(env, {
          jobId: job.id,
          runId: job.run_id,
          commentIds: job.comment_ids,
          progressKey: job.progress_key,
          locale: job.locale || DEFAULT_TRANSLATION_LOCALE,
          force: job.force,
          limit: job.limit,
          maxBatches: job.force ? undefined : getProcessingJobMaxBatches(env),
          shouldContinue: ensureNotCancelled,
          byo: opts.byo,
        });
        if ((result as any)?.complete === false) {
          await store.requeue(env, job.id);
          return false;
        }
      }
      await ensureNotCancelled();
      await store.markDone(env, job.id);
      return true;
    } catch (e: any) {
      if (e instanceof ProcessingJobCancelledError) {
        await setProgress(env, job.progress_key, { status: "cancelled", error: CANCELLED_ERROR });
        await store.markCancelled(env, job.id, CANCELLED_ERROR);
        return true;
      }
      const error = e?.message || String(e);
      // A transient upstream error used to end the run here. Count the attempt and put
      // the job back instead: the next attempt re-selects only comments that are still
      // unprocessed, so a retry resumes rather than repeats.
      const { willRetry, attempts } = await store.failAttempt(env, job.id, error, MAX_JOB_ATTEMPTS);
      await setProgress(env, job.progress_key, {
        status: willRetry ? "queued" : "failed",
        error: willRetry ? `${error} (sẽ thử lại, lần ${attempts})` : error,
      });
      return !willRetry;
    }
  }

  while (true) {
    const jobs: ProcessingQueueJob[] = [];
    for (let i = 0; i < maxRunning; i += 1) {
      const job = await store.claimNext(env, { maxRunning });
      if (!job) break;
      jobs.push(job);
    }
    if (!jobs.length) return;
    const results = await Promise.all(jobs.map(runJob));
    if (results.some((completed) => completed === false)) return;
  }
}
