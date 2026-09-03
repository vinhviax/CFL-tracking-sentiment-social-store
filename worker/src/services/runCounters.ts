// Cached per-run counts for the Ingest page.
//
// These numbers (how many comments a run brought in, how many are analysed, how many
// are translated, and the date range of the data) used to be recomputed from the raw
// tables on every request, five correlated subqueries per run, for up to 500 runs at a
// time. That made opening one page cost roughly 600,000 D1 row reads and grow with
// every comment ever ingested — see migration 0018 for the incident it caused.
//
// The fix is a cache with an invalidation rule that cannot silently drift: a run is
// recounted while its work can still move, and left alone once it cannot. Nothing in
// the ingest/analysis/translation write paths has to maintain a counter, which is what
// keeps this safe — the only way to get a wrong number is a stale snapshot, and the
// rule below is what makes that impossible for any run whose jobs are still live.
import type { Env } from "../types";

export interface CachedRunCounts {
  comment_count: number;
  analyzed_count: number;
  translated_zh_cn_count: number;
  data_start_date: string | null;
  data_end_date: string | null;
  counts_updated_at: string;
}

/** What the processing queue says about a run right now. */
export interface QueueActivity {
  /** A job for this run is queued, running or failed, so its numbers can still change. */
  active: boolean;
  /** Newest processing_queue.updated_at for this run; null when it has no jobs. */
  last_touched_at: string | null;
}

export interface CountedRunRow {
  id: number;
  counts_updated_at?: string | null;
}

/**
 * Whether a run's cached snapshot is still trustworthy.
 *
 * Analyses and translations are only ever written by processing-queue jobs, and every
 * queue transition (claim, requeue, fail, done) bumps `updated_at`. So a snapshot taken
 * at or after the run's newest queue timestamp, with nothing still active, cannot be
 * out of date. A run with no jobs at all — a Store pull that brought in zero new rows —
 * is equally settled once counted.
 */
export function needsRecount(row: CountedRunRow, activity: QueueActivity | null | undefined): boolean {
  if (!row.counts_updated_at) return true;
  if (!activity) return false;
  if (activity.active) return true;
  if (!activity.last_touched_at) return false;
  return activity.last_touched_at > row.counts_updated_at;
}

export function pickStaleRunIds(
  rows: CountedRunRow[],
  activityByRun: Map<number, QueueActivity>
): number[] {
  return rows
    .filter((row) => needsRecount(row, activityByRun.get(Number(row.id))))
    .map((row) => Number(row.id));
}

/**
 * One grouped read over processing_queue — a few hundred rows — instead of a per-run
 * query. Cheap enough to run on every request, which is what lets the expensive
 * recount be skipped safely.
 */
export async function loadQueueActivity(env: Env): Promise<Map<number, QueueActivity>> {
  const res = await env.DB.prepare(
    `SELECT run_id,
            MAX(updated_at) AS last_touched_at,
            MAX(CASE WHEN status IN ('queued', 'running', 'failed') THEN 1 ELSE 0 END) AS active
     FROM processing_queue
     WHERE run_id IS NOT NULL
     GROUP BY run_id`
  ).bind().all<{ run_id: number; last_touched_at: string | null; active: number }>();

  const out = new Map<number, QueueActivity>();
  for (const row of res.results || []) {
    out.set(Number(row.run_id), {
      active: Number(row.active) === 1,
      last_touched_at: row.last_touched_at || null,
    });
  }
  return out;
}

/**
 * Recount the given runs and persist the snapshots. Returns what was computed so the
 * caller can serve fresh numbers in the same response that refreshed them.
 *
 * Two statements per run on purpose: the counts exclude comments flagged
 * `skipped_analysis`, but the displayed date range never did, and quietly changing
 * which comments define a run's date range would move dates the team reads every day.
 */
export async function refreshRunCounts(env: Env, runIds: number[]): Promise<Map<number, CachedRunCounts>> {
  const out = new Map<number, CachedRunCounts>();
  const ids = [...new Set(runIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
  if (!ids.length) return out;

  for (const runId of ids) {
    const counts = await env.DB.prepare(
      `SELECT COUNT(*) AS comment_count,
              SUM(CASE WHEN a.comment_id IS NOT NULL THEN 1 ELSE 0 END) AS analyzed_count,
              SUM(CASE WHEN t.comment_id IS NOT NULL THEN 1 ELSE 0 END) AS translated_zh_cn_count
       FROM comments c
       LEFT JOIN analyses a ON a.comment_id = c.id
       LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = 'zh-CN'
       WHERE c.ingest_run_id = ? AND c.skipped_analysis = 0`
    ).bind(runId).first<{ comment_count: number; analyzed_count: number; translated_zh_cn_count: number }>();

    const dates = await env.DB.prepare(
      `SELECT MIN(SUBSTR(created_at, 1, 10)) AS data_start_date,
              MAX(SUBSTR(created_at, 1, 10)) AS data_end_date
       FROM comments
       WHERE ingest_run_id = ? AND created_at IS NOT NULL`
    ).bind(runId).first<{ data_start_date: string | null; data_end_date: string | null }>();

    const snapshot: CachedRunCounts = {
      comment_count: Number(counts?.comment_count || 0),
      analyzed_count: Number(counts?.analyzed_count || 0),
      translated_zh_cn_count: Number(counts?.translated_zh_cn_count || 0),
      data_start_date: dates?.data_start_date || null,
      data_end_date: dates?.data_end_date || null,
      counts_updated_at: new Date().toISOString(),
    };

    await env.DB.prepare(
      `UPDATE ingest_runs
       SET comment_count = ?, analyzed_count = ?, translated_zh_cn_count = ?,
           data_start_date = ?, data_end_date = ?, counts_updated_at = ?
       WHERE id = ?`
    ).bind(
      snapshot.comment_count,
      snapshot.analyzed_count,
      snapshot.translated_zh_cn_count,
      snapshot.data_start_date,
      snapshot.data_end_date,
      snapshot.counts_updated_at,
      runId
    ).run();

    out.set(runId, snapshot);
  }

  return out;
}
