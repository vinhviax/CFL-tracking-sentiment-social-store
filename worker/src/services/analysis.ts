// Ported from backend/app/services/analysis.py. Progress is persisted to D1
// (analyze_jobs table) rather than an in-memory dict, since Workers module-level
// state is not reliably shared across requests/isolates. Resumable by design:
// re-running only picks up comments still missing a PROMPT_VERSION-matching analysis.
import { PROMPT_VERSION } from "../taxonomy";
import type { Env } from "../types";
import { mapWithConcurrency, parseBoundedInt } from "./concurrency";
import { CommentInput } from "./llm/base";
import { ClassifierService, type HumanCorrectionExample } from "./llm/classifier";
import { type ByoOverride, resolveLlmProviderChain } from "./llmAgentConfig";
import { safeAddProcessingLog } from "./processingLogs";
import { getProgressJob, setProgress } from "./progressJobs";

interface PendingComment {
  id: number;
  message: string;
  rating: number | null;
  post_id: number | null;
}

interface PostContextRow {
  source_type: string | null;
  published_at: string | null;
  permalink: string | null;
  message: string | null;
}

const DEFAULT_ANALYSIS_BATCH_SIZE = 50;
const DEFAULT_LLM_BATCH_CONCURRENCY = 2;

export function getAnalysisBatchSize(env: Env) {
  return parseBoundedInt(env.ANALYSIS_BATCH_SIZE ?? env.CLASSIFY_BATCH_SIZE, 1, 100, DEFAULT_ANALYSIS_BATCH_SIZE);
}

export function getLlmBatchConcurrency(env: Env) {
  return parseBoundedInt(env.LLM_BATCH_CONCURRENCY, 1, 5, DEFAULT_LLM_BATCH_CONCURRENCY);
}

export function buildPostContext(post: PostContextRow) {
  const lines: string[] = [];
  if (post.source_type) lines.push(`Nguồn post: ${post.source_type}`);
  if (post.published_at) lines.push(`Ngày đăng post: ${post.published_at}`);
  if (post.permalink) lines.push(`Link post: ${post.permalink}`);
  if (post.message) lines.push(`Nội dung post: ${post.message}`);
  return lines.join("\n");
}

export async function loadHumanCorrectionExamples(env: Env, limit = 12): Promise<HumanCorrectionExample[]> {
  const rows = await env.DB.prepare(
    `SELECT c.message AS comment, ac.new_topic_main AS topic_main, ac.note
     FROM analysis_corrections ac
     JOIN comments c ON c.id = ac.comment_id
     WHERE ac.note IS NOT NULL AND TRIM(ac.note) != ''
     ORDER BY ac.corrected_at DESC
     LIMIT ?`
  ).bind(Math.max(1, Math.min(limit, 30))).all<HumanCorrectionExample>();

  return rows.results.map((row) => ({
    comment: String(row.comment || ""),
    topic_main: String(row.topic_main || ""),
    note: String(row.note || ""),
  }));
}

async function pendingComments(
  env: Env,
  opts: { commentIds?: number[]; runId?: number; force?: boolean; forceSince?: string | null; limit?: number }
): Promise<PendingComment[]> {
  // Without force, only comments that have no analysis at the current prompt version.
  // With force, every comment in scope — which is what "Phân tích lại" means. The old
  // behaviour made that button a no-op: a comment classified by the keyword fallback is
  // still recorded at the current prompt version, so it looked already analysed and the
  // button returned 0/0 without doing anything.
  //
  // A forced run needs `forceSince` (the job's first-claim time) to converge: without it
  // every retry would re-select the whole run, reprocess the same first batches and never
  // finish. Comparing against analyzed_at means a comment drops out of the pending set as
  // soon as this run has redone it, so retries resume where they left off.
  const versionFilter = opts.force
    ? (opts.forceSince ? "AND (a.comment_id IS NULL OR a.analyzed_at IS NULL OR a.analyzed_at < ?)" : "")
    : "AND (a.comment_id IS NULL OR a.prompt_version != ?)";
  const baseSql = `
    SELECT c.id, c.message, c.rating, c.post_id
    FROM comments c
    LEFT JOIN analyses a ON a.comment_id = c.id
    WHERE c.skipped_analysis = 0
      ${versionFilter}
  `;
  const versionParams = opts.force ? (opts.forceSince ? [opts.forceSince] : []) : [PROMPT_VERSION];

  // Never select more than the caller can process this attempt. Without this the cost
  // of finishing a run was quadratic: an attempt handles maxBatches*batchSize comments
  // but used to read every pending row in the run first and discard the rest, so a
  // 16,429-comment run cost ~2.7M row reads to get through — which is what exhausted
  // D1's daily read limit on 2026-09-04. A forced sweep passes no limit on purpose.
  const limitSql = opts.limit == null ? "" : " LIMIT ?";
  const limitParams = opts.limit == null ? [] : [opts.limit];

  // Filter by ingest_run_id directly rather than passing thousands of ids —
  // D1/SQLite caps bound parameters per statement well below dataset size.
  if (opts.runId != null) {
    const res = await env.DB.prepare(`${baseSql} AND c.ingest_run_id = ?${limitSql}`)
      .bind(...versionParams, opts.runId, ...limitParams).all<PendingComment>();
    return res.results;
  }

  if (opts.commentIds?.length) {
    const out: PendingComment[] = [];
    for (const idsChunk of chunk(opts.commentIds, 90)) {
      const placeholders = idsChunk.map(() => "?").join(",");
      const res = await env.DB.prepare(`${baseSql} AND c.id IN (${placeholders})`)
        .bind(...versionParams, ...idsChunk).all<PendingComment>();
      out.push(...res.results);
    }
    return out;
  }

  const res = await env.DB.prepare(`${baseSql}${limitSql}`)
    .bind(...versionParams, ...limitParams).all<PendingComment>();
  return res.results;
}

/**
 * How many comments are still pending, for the progress bar's denominator.
 *
 * Only called when the capped SELECT came back full, meaning there is more work than
 * this attempt can see. Costs one scan per job rather than one per attempt, because
 * the answer is then reused from the stored progress row on later attempts.
 */
async function countPendingComments(
  env: Env, opts: { runId?: number; force?: boolean; forceSince?: string | null }
): Promise<number | null> {
  if (opts.runId == null) return null;
  const versionFilter = opts.force
    ? (opts.forceSince ? "AND (a.comment_id IS NULL OR a.analyzed_at IS NULL OR a.analyzed_at < ?)" : "")
    : "AND (a.comment_id IS NULL OR a.prompt_version != ?)";
  const versionParams = opts.force ? (opts.forceSince ? [opts.forceSince] : []) : [PROMPT_VERSION];
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS pending
     FROM comments c
     LEFT JOIN analyses a ON a.comment_id = c.id
     WHERE c.skipped_analysis = 0
       ${versionFilter}
       AND c.ingest_run_id = ?`
  ).bind(...versionParams, opts.runId).first<{ pending: number }>();
  return row ? Number(row.pending || 0) : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function getProgress(env: Env, key: string) {
  return getProgressJob(env, key);
}

export async function runAnalysis(
  env: Env,
  opts: {
    jobId?: number;
    commentIds?: number[];
    runId?: number;
    progressKey: string;
    maxBatches?: number;
    shouldContinue?: () => Promise<void> | void;
    /** Re-analyse comments that already have an analysis — what "Phân tích lại" means. */
    force?: boolean;
    /** When forcing, only redo analyses older than this — keeps retries converging. */
    forceSince?: string | null;
    /** Caller's own provider, used in memory only and never persisted. */
    byo?: ByoOverride | null;
  }
) {
  // Resolved per batch inside the loop, so a mid-run escalation or give-up takes
  // effect on the next batch. This first resolve is only for the progress display.
  const displayProvider = (await resolveLlmProviderChain(env, "reasoning", opts.byo))[0]?.name ?? "reasoning";
  await opts.shouldContinue?.();
  const batchSize = getAnalysisBatchSize(env);
  const fetchLimit = opts.maxBatches == null ? undefined : Math.max(1, opts.maxBatches) * batchSize;
  const comments = await pendingComments(env, {
    commentIds: opts.commentIds,
    runId: opts.runId,
    force: opts.force,
    forceSince: opts.forceSince,
    limit: fetchLimit,
  });
  const humanExamples = await loadHumanCorrectionExamples(env);
  const previousProgress = await getProgressJob(env, opts.progressKey);
  const alreadyDone = Math.max(0, Number(previousProgress?.done || 0));
  // The capped SELECT can no longer stand in for "everything still pending", so the
  // denominator comes from a COUNT — but only when the cap was actually reached and no
  // earlier attempt has already recorded one.
  const knownTotal = Number(previousProgress?.total || 0);
  const pendingTotal = fetchLimit != null && comments.length === fetchLimit && !knownTotal
    ? (await countPendingComments(env, { runId: opts.runId, force: opts.force, forceSince: opts.forceSince })) ?? comments.length
    : comments.length;
  const total = Math.max(knownTotal, alreadyDone + pendingTotal);

  await setProgress(env, opts.progressKey, { status: "running", done: alreadyDone, total, provider: displayProvider });

  if (comments.length === 0) {
    await setProgress(env, opts.progressKey, { status: "done" });
    return { analyzed: 0, provider: displayProvider, total: 0 };
  }

  // Resolve parent post context once for better classification of short or ambiguous comments.
  const postIds = [...new Set(comments.map((c) => c.post_id).filter((x): x is number => x != null))];
  const postContexts = new Map<number, string>();
  if (postIds.length) {
    for (const idsChunk of chunk(postIds, 90)) {
      const res = await env.DB.prepare(
        `SELECT id, source_type, published_at, permalink, message FROM posts WHERE id IN (${idsChunk.map(() => "?").join(",")})`
      ).bind(...idsChunk).all<{ id: number } & PostContextRow>();
      for (const r of res.results) postContexts.set(r.id, buildPostContext(r));
    }
  }

  const concurrency = getLlmBatchConcurrency(env);
  let analyzed = 0;
  // Batches whose LLM call failed. They stay unprocessed so the job requeues and picks
  // them up next attempt, rather than the whole run ending on one bad batch.
  let failedBatches = 0;
  const analyzedAt = new Date().toISOString();
  const groups = chunk(comments, batchSize);
  const groupsToProcess = opts.maxBatches == null ? groups : groups.slice(0, Math.max(1, opts.maxBatches));

  await mapWithConcurrency(groupsToProcess, concurrency, async (group, index) => {
    await opts.shouldContinue?.();
    const batchIndex = index + 1;
    const started = Date.now();

    // The slot may have escalated or given up since the last batch. An empty chain
    // means "do not call the LLM right now" — leave these comments pending and let
    // the job requeue, which costs no queue attempt (drainProcessingQueue requeues
    // rather than failing when complete === false).
    const chain = await resolveLlmProviderChain(env, "reasoning", opts.byo);
    if (!chain.length) {
      if (opts.jobId != null) {
        await safeAddProcessingLog(env, {
          processing_job_id: opts.jobId,
          progress_key: opts.progressKey,
          job_type: "analysis",
          level: "info",
          phase: "llm_batch",
          message: `Analysis batch ${batchIndex}/${groups.length} chưa chạy: slot suy luận đang không có provider khả dụng`,
          batch_index: batchIndex,
          batch_total: groups.length,
          item_count: group.length,
        });
      }
      failedBatches += 1;
      return;
    }
    const svc = new ClassifierService(env, chain, { recordable: opts.byo == null });

    if (opts.jobId != null) {
      await safeAddProcessingLog(env, {
        processing_job_id: opts.jobId,
        progress_key: opts.progressKey,
        job_type: "analysis",
        level: "info",
        phase: "llm_batch",
        message: `Analysis batch ${batchIndex}/${groups.length} started`,
        batch_index: batchIndex,
        batch_total: groups.length,
        item_count: group.length,
        provider: svc.providerName,
        model: svc.model,
      });
    }
    const inputs: CommentInput[] = group.map((c) => ({
      id: c.id,
      message: c.message,
      context: c.post_id != null ? postContexts.get(c.post_id) ?? null : null,
      rating: c.rating,
    }));

    let batch: Awaited<ReturnType<ClassifierService["classify"]>>;
    try {
      batch = await svc.classify(inputs, humanExamples);
    } catch (e: any) {
      if (opts.jobId != null) {
        await safeAddProcessingLog(env, {
          processing_job_id: opts.jobId,
          progress_key: opts.progressKey,
          job_type: "analysis",
          level: "error",
          phase: "llm_batch",
          message: `Analysis batch ${batchIndex}/${groups.length} failed`,
          batch_index: batchIndex,
          batch_total: groups.length,
          item_count: group.length,
          provider: svc.providerName,
          model: svc.model,
          duration_ms: Date.now() - started,
          error: e?.message || String(e),
        });
      }
      // Do not rethrow. Rejecting here aborts the sibling batches running under
      // mapWithConcurrency, throwing away work that had already succeeded. Record the
      // failure, leave this group unprocessed, and let the job requeue: the next
      // attempt re-selects exactly the comments still missing an analysis.
      // Cancellation must still propagate so the job stops instead of retrying.
      if (e?.name === "ProcessingJobCancelledError") throw e;
      failedBatches += 1;
      return;
    }

    const stmts = batch.classifications.map((r) =>
      env.DB.prepare(
        `INSERT INTO analyses (comment_id, topic_main, topics_sub, sentiment, urgency, summary, other_suggested, confidence, provider, model, prompt_version, status, analyzed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(comment_id) DO UPDATE SET
           topic_main=excluded.topic_main, topics_sub=excluded.topics_sub, sentiment=excluded.sentiment,
           urgency=excluded.urgency, summary=excluded.summary, other_suggested=excluded.other_suggested,
           confidence=excluded.confidence, provider=excluded.provider, model=excluded.model,
           prompt_version=excluded.prompt_version, status=excluded.status, analyzed_at=excluded.analyzed_at`
      ).bind(
        r.id, r.topic_main, JSON.stringify(r.topics_sub), r.sentiment, r.urgency, r.summary,
        r.other_suggested, r.confidence,
        // Record what produced this row, not what was configured. Writing the
        // configured model even when every LLM call 403'd is what made a 12-day
        // outage invisible in the analyses table. Every row here came from the LLM —
        // unclassified comments get no row at all now, rather than a keyword guess.
        batch.servedBy?.provider || svc.providerName,
        batch.servedBy?.model || svc.model,
        PROMPT_VERSION, "ok", analyzedAt
      )
    );
    if (stmts.length) await env.DB.batch(stmts);

    analyzed += batch.classifications.length;
    // Comments the LLM skipped stay pending, so the job must not report itself done.
    if (batch.unclassifiedCount > 0) failedBatches += 1;
    await setProgress(env, opts.progressKey, { done: alreadyDone + analyzed });
    if (opts.jobId != null) {
      await safeAddProcessingLog(env, {
        processing_job_id: opts.jobId,
        progress_key: opts.progressKey,
        job_type: "analysis",
        // Partially classified counts as an error so the queue view shows the problem
        // instead of a green "completed" that hides it.
        level: batch.unclassifiedCount > 0 ? "error" : "success",
        phase: "llm_batch",
        error: batch.unclassifiedCount > 0
          ? batch.error || `${batch.unclassifiedCount} comment chưa phân tích được, sẽ thử lại`
          : null,
        message: batch.unclassifiedCount > 0
          ? `Analysis batch ${batchIndex}/${groups.length}: ${batch.llmClassified}/${group.length} qua LLM, ${batch.unclassifiedCount} còn chờ`
          : `Analysis batch ${batchIndex}/${groups.length} completed`,
        batch_index: batchIndex,
        batch_total: groups.length,
        item_count: group.length,
        provider: svc.providerName,
        model: svc.model,
        duration_ms: Date.now() - started,
        input_tokens: batch.usage?.input_tokens ?? null,
        output_tokens: batch.usage?.output_tokens ?? null,
      });
    }
    await opts.shouldContinue?.();
  });

  if (analyzed < comments.length || failedBatches > 0) {
    await setProgress(env, opts.progressKey, { status: "queued" });
    return { analyzed, provider: displayProvider, total, complete: false, failedBatches };
  }

  await setProgress(env, opts.progressKey, { status: "done" });
  return { analyzed, provider: displayProvider, total, complete: true };
}
