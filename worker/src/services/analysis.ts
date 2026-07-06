// Ported from backend/app/services/analysis.py. Progress is persisted to D1
// (analyze_jobs table) rather than an in-memory dict, since Workers module-level
// state is not reliably shared across requests/isolates. Resumable by design:
// re-running only picks up comments still missing a PROMPT_VERSION-matching analysis.
import { PROMPT_VERSION } from "../taxonomy";
import type { Env } from "../types";
import { CommentInput } from "./llm/base";
import { ClassifierService } from "./llm/classifier";

interface PendingComment {
  id: number;
  message: string;
  rating: number | null;
  post_id: number | null;
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

async function setProgress(env: Env, key: string, patch: Record<string, any>) {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(`SELECT id FROM analyze_jobs WHERE progress_key=?`).bind(key).first();
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO analyze_jobs (progress_key, status, done, total, provider, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(key, patch.status ?? "queued", patch.done ?? 0, patch.total ?? 0, patch.provider ?? null, patch.error ?? null, now, now).run();
    return;
  }
  const fields = Object.keys(patch);
  const sets = fields.map((f) => `${f} = ?`).join(", ");
  await env.DB.prepare(`UPDATE analyze_jobs SET ${sets}, updated_at = ? WHERE progress_key = ?`)
    .bind(...fields.map((f) => patch[f]), now, key).run();
}

export async function getProgress(env: Env, key: string) {
  const row = await env.DB.prepare(`SELECT status, done, total, provider, error FROM analyze_jobs WHERE progress_key=?`)
    .bind(key).first();
  return row || { status: "unknown", done: 0, total: 0 };
}

export async function runAnalysis(
  env: Env, opts: { commentIds?: number[]; runId?: number; progressKey: string }
) {
  const svc = new ClassifierService(env);
  const comments = await pendingComments(env, { commentIds: opts.commentIds, runId: opts.runId });
  const total = comments.length;

  await setProgress(env, opts.progressKey, { status: "running", done: 0, total, provider: svc.providerName });

  if (total === 0) {
    await setProgress(env, opts.progressKey, { status: "done" });
    return { analyzed: 0, provider: svc.providerName, total: 0 };
  }

  // Resolve post messages once for context (batch, avoid N+1 queries).
  const postIds = [...new Set(comments.map((c) => c.post_id).filter((x): x is number => x != null))];
  const postMessages = new Map<number, string>();
  if (postIds.length) {
    for (const idsChunk of chunk(postIds, 90)) {
      const res = await env.DB.prepare(
        `SELECT id, message FROM posts WHERE id IN (${idsChunk.map(() => "?").join(",")})`
      ).bind(...idsChunk).all<{ id: number; message: string }>();
      for (const r of res.results) postMessages.set(r.id, r.message);
    }
  }

  const batchSize = 60;
  let analyzed = 0;
  const analyzedAt = new Date().toISOString();

  for (const group of chunk(comments, batchSize)) {
    const inputs: CommentInput[] = group.map((c) => ({
      id: c.id,
      message: c.message,
      context: c.post_id != null ? postMessages.get(c.post_id) ?? null : null,
      rating: c.rating,
    }));

    const results = await svc.classify(inputs);

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
    await setProgress(env, opts.progressKey, { done: analyzed });
  }

  await setProgress(env, opts.progressKey, { status: "done" });
  return { analyzed, provider: svc.providerName, total };
}
