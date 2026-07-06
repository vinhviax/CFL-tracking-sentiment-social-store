// Ported from backend/app/services/analysis.py. Progress is persisted to D1
// (analyze_jobs table) rather than an in-memory dict, since Workers module-level
// state is not reliably shared across requests/isolates. Resumable by design:
// re-running only picks up comments still missing a PROMPT_VERSION-matching analysis.
import { PROMPT_VERSION } from "../taxonomy";
import type { Env } from "../types";
import { mapWithConcurrency, parseBoundedInt } from "./concurrency";
import { CommentInput } from "./llm/base";
import { ClassifierService } from "./llm/classifier";
import { resolveLlmProvider } from "./llmAgentConfig";
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

async function pendingComments(
  env: Env, opts: { commentIds?: number[]; runId?: number }
): Promise<PendingComment[]> {
  const baseSql = `
    SELECT c.id, c.message, c.rating, c.post_id
    FROM comments c
    LEFT JOIN analyses a ON a.comment_id = c.id
    WHERE c.skipped_analysis = 0
      AND (a.comment_id IS NULL OR a.prompt_version != ?)
  `;

  // Filter by ingest_run_id directly rather than passing thousands of ids —
  // D1/SQLite caps bound parameters per statement well below dataset size.
  if (opts.runId != null) {
    const res = await env.DB.prepare(`${baseSql} AND c.ingest_run_id = ?`)
      .bind(PROMPT_VERSION, opts.runId).all<PendingComment>();
    return res.results;
  }

  if (opts.commentIds?.length) {
    const out: PendingComment[] = [];
    for (const idsChunk of chunk(opts.commentIds, 90)) {
      const placeholders = idsChunk.map(() => "?").join(",");
      const res = await env.DB.prepare(`${baseSql} AND c.id IN (${placeholders})`)
        .bind(PROMPT_VERSION, ...idsChunk).all<PendingComment>();
      out.push(...res.results);
    }
    return out;
  }

  const res = await env.DB.prepare(baseSql).bind(PROMPT_VERSION).all<PendingComment>();
  return res.results;
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
  }
) {
  const provider = await resolveLlmProvider(env, "reasoning");
  const svc = new ClassifierService(env, provider);
  await opts.shouldContinue?.();
  const comments = await pendingComments(env, { commentIds: opts.commentIds, runId: opts.runId });
  const previousProgress = await getProgressJob(env, opts.progressKey);
  const alreadyDone = Math.max(0, Number(previousProgress?.done || 0));
  const total = Math.max(Number(previousProgress?.total || 0), alreadyDone + comments.length);

  await setProgress(env, opts.progressKey, { status: "running", done: alreadyDone, total, provider: svc.providerName });

  if (comments.length === 0) {
    await setProgress(env, opts.progressKey, { status: "done" });
    return { analyzed: 0, provider: svc.providerName, total: 0 };
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

  const batchSize = getAnalysisBatchSize(env);
  const concurrency = getLlmBatchConcurrency(env);
  let analyzed = 0;
  const analyzedAt = new Date().toISOString();
  const groups = chunk(comments, batchSize);
  const groupsToProcess = opts.maxBatches == null ? groups : groups.slice(0, Math.max(1, opts.maxBatches));

  await mapWithConcurrency(groupsToProcess, concurrency, async (group, index) => {
    await opts.shouldContinue?.();
    const batchIndex = index + 1;
    const started = Date.now();
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

    let results: Awaited<ReturnType<ClassifierService["classify"]>>;
    try {
      results = await svc.classify(inputs);
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
      throw e;
    }

    const stmts = results.map((r) =>
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
        r.other_suggested, r.confidence, svc.providerName, svc.model, PROMPT_VERSION, "ok", analyzedAt
      )
    );
    await env.DB.batch(stmts);

    analyzed += group.length;
    await setProgress(env, opts.progressKey, { done: alreadyDone + analyzed });
    if (opts.jobId != null) {
      await safeAddProcessingLog(env, {
        processing_job_id: opts.jobId,
        progress_key: opts.progressKey,
        job_type: "analysis",
        level: "success",
        phase: "llm_batch",
        message: `Analysis batch ${batchIndex}/${groups.length} completed`,
        batch_index: batchIndex,
        batch_total: groups.length,
        item_count: group.length,
        provider: svc.providerName,
        model: svc.model,
        duration_ms: Date.now() - started,
      });
    }
    await opts.shouldContinue?.();
  });

  if (analyzed < comments.length) {
    await setProgress(env, opts.progressKey, { status: "queued" });
    return { analyzed, provider: svc.providerName, total, complete: false };
  }

  await setProgress(env, opts.progressKey, { status: "done" });
  return { analyzed, provider: svc.providerName, total, complete: true };
}
