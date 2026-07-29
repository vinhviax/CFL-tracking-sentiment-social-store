import type { Env } from "../types";

/** Bangkok is the reporting timezone; token spend is bucketed by local day, not UTC day. */
const REPORTING_UTC_OFFSET = "+07:00";
const TOKEN_LOOKUP_CHUNK = 90;

/**
 * Only completed LLM batches carry usage. The 'info' rows written when a batch
 * starts and the 'error' rows written when it fails have none, and counting them
 * would make `batches` disagree with what was actually billed.
 */
const BILLED_BATCH_FILTER = `level = 'success' AND phase = 'llm_batch'`;
const BILLED_BATCH_FILTER_PL = `pl.level = 'success' AND pl.phase = 'llm_batch'`;

export interface TokenUsageGroup {
  job_type: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  /** Batches that completed, whether or not the provider reported usage. */
  batches: number;
  /**
   * Batches whose usage the provider actually reported. Lower than `batches`
   * means the totals understate real spend — the UI must say so rather than
   * present a partial sum as complete.
   */
  batches_with_usage: number;
}

export interface TokenUsageTotals {
  input_tokens: number;
  output_tokens: number;
  batches: number;
  batches_with_usage: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mapGroupRow(row: any): TokenUsageGroup {
  return {
    job_type: String(row.job_type),
    model: row.model || null,
    input_tokens: Number(row.input_tokens || 0),
    output_tokens: Number(row.output_tokens || 0),
    batches: Number(row.batches || 0),
    batches_with_usage: Number(row.batches_with_usage || 0),
  };
}

export function sumTokenUsage(groups: TokenUsageGroup[]): TokenUsageTotals {
  return groups.reduce<TokenUsageTotals>(
    (acc, g) => ({
      input_tokens: acc.input_tokens + g.input_tokens,
      output_tokens: acc.output_tokens + g.output_tokens,
      batches: acc.batches + g.batches,
      batches_with_usage: acc.batches_with_usage + g.batches_with_usage,
    }),
    { input_tokens: 0, output_tokens: 0, batches: 0, batches_with_usage: 0 }
  );
}

/**
 * Convert an inclusive local day range into the half-open UTC bounds stored in
 * created_at. Doing the shift here rather than wrapping created_at in a datetime()
 * call keeps the range indexable.
 */
export function resolveUtcDayRange(from?: string | null, to?: string | null): { start: string | null; end: string | null } {
  const start = from ? new Date(`${from}T00:00:00${REPORTING_UTC_OFFSET}`) : null;
  const end = to ? new Date(`${to}T00:00:00${REPORTING_UTC_OFFSET}`) : null;
  if (end) end.setUTCDate(end.getUTCDate() + 1); // `to` is inclusive
  return {
    start: start && !isNaN(start.getTime()) ? start.toISOString() : null,
    end: end && !isNaN(end.getTime()) ? end.toISOString() : null,
  };
}

/**
 * Token spend per ingest run, split by job type and model.
 *
 * Joins through processing_queue.run_id rather than pattern-matching progress_key,
 * which is both exact and lets one query cover every run in the page. Jobs with a
 * NULL run_id (the scheduled catch-up pass over pending comments) belong to no run
 * and are correctly absent here — they still count in loadTokenUsageByRange.
 */
export async function loadRunTokenUsage(env: Env, runIds: number[]): Promise<Map<number, TokenUsageGroup[]>> {
  const byRun = new Map<number, TokenUsageGroup[]>();
  const ids = [...new Set(runIds.filter((id) => Number.isFinite(id)))];
  if (!ids.length) return byRun;

  for (const idsChunk of chunk(ids, TOKEN_LOOKUP_CHUNK)) {
    const res = await env.DB.prepare(
      `SELECT pq.run_id AS run_id,
              pl.job_type AS job_type,
              pl.model AS model,
              SUM(COALESCE(pl.input_tokens, 0)) AS input_tokens,
              SUM(COALESCE(pl.output_tokens, 0)) AS output_tokens,
              COUNT(*) AS batches,
              SUM(CASE WHEN pl.input_tokens IS NULL AND pl.output_tokens IS NULL THEN 0 ELSE 1 END) AS batches_with_usage
       FROM processing_logs pl
       JOIN processing_queue pq ON pq.id = pl.processing_job_id
       WHERE pq.run_id IN (${idsChunk.map(() => "?").join(",")})
         AND ${BILLED_BATCH_FILTER_PL}
       GROUP BY pq.run_id, pl.job_type, pl.model
       ORDER BY pq.run_id DESC, pl.job_type`
    )
      .bind(...idsChunk)
      .all<any>();

    for (const row of res.results || []) {
      const runId = Number(row.run_id);
      const list = byRun.get(runId) || [];
      list.push(mapGroupRow(row));
      byRun.set(runId, list);
    }
  }
  return byRun;
}

/**
 * Token spend over a local day range, grouped by model. Reads processing_logs
 * directly so jobs not tied to an ingest run are included — they cost tokens too.
 */
export async function loadTokenUsageByRange(
  env: Env,
  opts: { from?: string | null; to?: string | null }
): Promise<{ by_model: TokenUsageGroup[]; total: TokenUsageTotals; range: { from: string | null; to: string | null } }> {
  const { start, end } = resolveUtcDayRange(opts.from, opts.to);
  const where = [BILLED_BATCH_FILTER];
  const params: unknown[] = [];
  if (start) {
    where.push("created_at >= ?");
    params.push(start);
  }
  if (end) {
    where.push("created_at < ?");
    params.push(end);
  }

  const res = await env.DB.prepare(
    `SELECT job_type,
            model,
            SUM(COALESCE(input_tokens, 0)) AS input_tokens,
            SUM(COALESCE(output_tokens, 0)) AS output_tokens,
            COUNT(*) AS batches,
            SUM(CASE WHEN input_tokens IS NULL AND output_tokens IS NULL THEN 0 ELSE 1 END) AS batches_with_usage
     FROM processing_logs
     WHERE ${where.join(" AND ")}
     GROUP BY job_type, model
     ORDER BY input_tokens + output_tokens DESC`
  )
    .bind(...params)
    .all<any>();

  const by_model = (res.results || []).map(mapGroupRow);
  return {
    by_model,
    total: sumTokenUsage(by_model),
    range: { from: opts.from || null, to: opts.to || null },
  };
}
