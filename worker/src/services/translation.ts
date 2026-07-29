import type { Env } from "../types";
import type { LLMUsage } from "./llm/base";
import { mapWithConcurrency, parseBoundedInt } from "./concurrency";
import { type ByoOverride, resolveLlmProviderChain } from "./llmAgentConfig";
import { completeJsonWithFallback } from "./llm/chain";
import { safeAddProcessingLog } from "./processingLogs";
import { getProgressJob, setProgress } from "./progressJobs";

export const DEFAULT_TRANSLATION_LOCALE = "zh-CN";
const DEFAULT_TRANSLATION_BATCH_SIZE = 20;
const DEFAULT_LLM_BATCH_CONCURRENCY = 2;

export interface PendingTranslation {
  id: number;
  message: string;
  summary: string | null;
}

interface TranslationResult {
  id: number;
  message_zh: string;
  summary_zh: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function getTranslationProgress(env: Env, key: string) {
  return getProgressJob(env, key);
}

async function pendingTranslations(
  env: Env,
  opts: { commentIds?: number[]; runId?: number; locale: string; force?: boolean; limit?: number }
): Promise<PendingTranslation[]> {
  const params: any[] = [opts.locale];
  const where = ["c.skipped_analysis = 0"];
  if (!opts.force) where.push("t.comment_id IS NULL");
  if (opts.runId != null) { where.push("c.ingest_run_id = ?"); params.push(opts.runId); }
  if (opts.commentIds?.length) {
    const out: PendingTranslation[] = [];
    for (const idsChunk of chunk(opts.commentIds, 90)) {
      const placeholders = idsChunk.map(() => "?").join(",");
      const rows = await env.DB.prepare(
        `SELECT c.id, c.message, a.summary
         FROM comments c
         LEFT JOIN analyses a ON a.comment_id = c.id
         LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
         WHERE ${where.join(" AND ")} AND c.id IN (${placeholders})
         ORDER BY c.id`
      ).bind(...params, ...idsChunk).all<PendingTranslation>();
      out.push(...rows.results);
    }
    return out;
  }

  const limit = buildTranslationLimit(opts);
  const limitSql = limit == null ? "" : " LIMIT ?";
  const bindParams = limit == null ? params : [...params, limit];
  const rows = await env.DB.prepare(
    `SELECT c.id, c.message, a.summary
     FROM comments c
     LEFT JOIN analyses a ON a.comment_id = c.id
     LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
     WHERE ${where.join(" AND ")}
     ORDER BY c.id${limitSql}`
  ).bind(...bindParams).all<PendingTranslation>();
  return rows.results;
}

export function buildTranslationLimit(opts: { runId?: number; limit?: number }) {
  if (opts.limit != null) return parseBoundedInt(opts.limit, 1, 5000, 1000);
  return opts.runId == null ? 1000 : null;
}

export function getTranslationBatchSize(env: Env) {
  return parseBoundedInt(env.TRANSLATION_BATCH_SIZE, 1, 100, DEFAULT_TRANSLATION_BATCH_SIZE);
}

function getLlmBatchConcurrency(env: Env) {
  return parseBoundedInt(env.LLM_BATCH_CONCURRENCY, 1, 5, DEFAULT_LLM_BATCH_CONCURRENCY);
}

function tryParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function salvageTranslationResults(text: string): TranslationResult[] {
  const out = new Map<number, TranslationResult>();
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    const end = findMatchingBrace(text, i);
    if (end === -1) continue;
    const parsed = tryParseJson(text.slice(i, end + 1));
    const normalized = normalizeTranslation(parsed);
    if (normalized) out.set(normalized.id, normalized);
  }
  return [...out.values()];
}

export function parseTranslationResults(raw: string): TranslationResult[] {
  let text = raw.trim();
  if (text.startsWith("data:")) {
    const out: TranslationResult[] = [];
    const contentChunks: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const data = tryParseJson(payload);
      if (!data) continue;
      const content = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        contentChunks.push(content);
        continue;
      }
      const normalized = normalizeTranslation(data);
      if (normalized) out.push(normalized);
      const nested = data.results || data.data || data.items;
      if (Array.isArray(nested)) {
        for (const rec of nested) {
          const t = normalizeTranslation(rec);
          if (t) out.push(t);
        }
      }
    }
    if (out.length) return out;
    text = contentChunks.join("").trim();
  }

  if (text.startsWith("```")) {
    const parts = text.split("```");
    text = (parts[1] || "").replace(/^json/i, "").trim();
  }
  let data: any;
  data = tryParseJson(text);
  if (!data) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      data = tryParseJson(text.slice(start, end + 1));
    }
  }
  if (!data) {
    return salvageTranslationResults(text);
  }
  if (!Array.isArray(data)) data = data.results || data.data || data.items || [];
  if (!Array.isArray(data)) return [];
  return data.map(normalizeTranslation).filter((r): r is TranslationResult => r !== null);
}

export const TRANSLATION_SYSTEM_PROMPT = [
  "You are a liveops game-operations translator for Crossfire Legends (CFL). Translate Vietnamese player feedback into concise Simplified Chinese for Chinese product, liveops, and QA operators.",
  "Preserve technical meaning, player intent, severity, and game-operation context rather than translating word-for-word.",
  "Keep product/version terms readable and consistent: CFL, CFM, CrossFire Mobile, China/Chinese version, SEA, Vietnam/VN/Vietnamese version, global/international version.",
  "Normalize Vietnamese slang, teencode, abbreviations, and typos into clear Simplified Chinese. Keep common game terms such as hack/cheat, lag, ping, FPS, top-up, account, event, bug, skin, weapon, rank, matchmaking, and giftcode understandable.",
  "Translate profanity or insults as tone/severity without adding extra vulgarity. Do not invent fixes, causes, compensation, dates, or details not present in the source.",
  "If the Vietnamese source is empty, return an empty Chinese string for that field. If a term is already Chinese or an official product name, preserve it.",
].join("\n");

export function buildTranslationUserPrompt(items: PendingTranslation[]): string {
  const lines = ["Translate these CFL player feedback records into Simplified Chinese (zh-CN) for liveops triage."];
  lines.push("Return only JSON: {\"results\":[{\"id\":number,\"message_zh\":string,\"summary_zh\":string}]}.");
  for (const item of items) {
    lines.push("---");
    lines.push(`[id=${item.id}]`);
    lines.push(`message_vi: ${item.message.slice(0, 1500)}`);
    lines.push(`summary_vi: ${(item.summary || "").slice(0, 500)}`);
  }
  return lines.join("\n");
}

function normalizeTranslation(raw: any): TranslationResult | null {
  const id = Number(raw?.id);
  if (!Number.isFinite(id)) return null;
  const message = String(raw.message_zh || raw.message_translated || "").trim();
  if (!message) return null;
  return {
    id,
    message_zh: message,
    summary_zh: String(raw.summary_zh || raw.summary_translated || "").trim(),
  };
}

export async function runTranslation(
  env: Env,
  opts: {
    jobId?: number;
    progressKey: string;
    locale?: string;
    commentIds?: number[];
    runId?: number;
    force?: boolean;
    limit?: number;
    maxBatches?: number;
    shouldContinue?: () => Promise<void> | void;
    /** Caller's own provider, used in memory only and never persisted. */
    byo?: ByoOverride | null;
  }
) {
  const locale = opts.locale || DEFAULT_TRANSLATION_LOCALE;
  const chain = await resolveLlmProviderChain(env, "simple", opts.byo);
  const providerName = chain[0]?.name ?? "unavailable";
  const model = chain[0]?.model ?? null;

  await opts.shouldContinue?.();
  const comments = await pendingTranslations(env, { ...opts, locale });
  const previousProgress = await getProgressJob(env, opts.progressKey);
  const alreadyDone = Math.max(0, Number(previousProgress?.done || 0));
  const total = Math.max(Number(previousProgress?.total || 0), alreadyDone + comments.length);
  await setProgress(env, opts.progressKey, { status: "running", done: alreadyDone, total, provider: providerName });

  if (!comments.length) {
    await setProgress(env, opts.progressKey, { status: "done" });
    return { translated: 0, total: 0, provider: providerName };
  }

  if (!chain.length) {
    const error = "LLM provider chưa sẵn sàng để dịch zh-CN";
    await setProgress(env, opts.progressKey, { status: "failed", error });
    throw new Error(error);
  }

  const translatedAt = new Date().toISOString();
  let done = 0;
  // Batches whose LLM call failed; left unprocessed so the job requeues for them.
  let failedBatches = 0;
  const batchSize = getTranslationBatchSize(env);
  const concurrency = getLlmBatchConcurrency(env);
  const groups = chunk(comments, batchSize);
  const groupsToProcess = opts.maxBatches == null ? groups : groups.slice(0, Math.max(1, opts.maxBatches));

  try {
    await mapWithConcurrency(groupsToProcess, concurrency, async (group, index) => {
      await opts.shouldContinue?.();
      const batchIndex = index + 1;
      const started = Date.now();
      if (opts.jobId != null) {
        await safeAddProcessingLog(env, {
          processing_job_id: opts.jobId,
          progress_key: opts.progressKey,
          job_type: "translation",
          level: "info",
          phase: "llm_batch",
          message: `Translation batch ${batchIndex}/${groups.length} started`,
          batch_index: batchIndex,
          batch_total: groups.length,
          item_count: group.length,
          provider: providerName,
          model,
        });
      }
      let raw: string;
      let batchUsage: LLMUsage | undefined;
      try {
        // Retries through Gemini by Viax before giving up on the LLM entirely.
        const completion = await completeJsonWithFallback(chain, TRANSLATION_SYSTEM_PROMPT, buildTranslationUserPrompt(group));
        raw = completion.content;
        batchUsage = completion.usage;
        for (const f of completion.failures) {
          console.warn(`translation ${f.provider}/${f.model} failed (${f.error}); retried via ${completion.provider.name}`);
        }
      } catch (e: any) {
        if (opts.jobId != null) {
          await safeAddProcessingLog(env, {
            processing_job_id: opts.jobId,
            progress_key: opts.progressKey,
            job_type: "translation",
            level: "error",
            phase: "llm_batch",
            message: `Translation batch ${batchIndex}/${groups.length} failed`,
            batch_index: batchIndex,
            batch_total: groups.length,
            item_count: group.length,
            provider: providerName,
            model,
            duration_ms: Date.now() - started,
            error: e?.message || String(e),
          });
        }
        // Not rethrown: rejecting aborts the sibling batches under mapWithConcurrency
        // and discards their finished work. The job requeues and re-selects only the
        // comments still missing a translation.
        if (e?.name === "ProcessingJobCancelledError") throw e;
        failedBatches += 1;
        return;
      }
      const byId = new Map<number, TranslationResult>();
      for (const t of parseTranslationResults(raw)) byId.set(t.id, t);

      const stmts = group.map((comment) => {
        const translated = byId.get(comment.id);
        return env.DB.prepare(
          `INSERT INTO comment_translations
             (comment_id, locale, message_translated, summary_translated, provider, model, translated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(comment_id, locale) DO UPDATE SET
             message_translated = excluded.message_translated,
             summary_translated = excluded.summary_translated,
             provider = excluded.provider,
             model = excluded.model,
             translated_at = excluded.translated_at`
        ).bind(
          comment.id,
          locale,
          translated?.message_zh || comment.message,
          translated?.summary_zh || comment.summary || "",
          providerName,
          model,
          translatedAt
        );
      });
      await env.DB.batch(stmts);
      done += group.length;
      await setProgress(env, opts.progressKey, { done: alreadyDone + done });
      if (opts.jobId != null) {
        await safeAddProcessingLog(env, {
          processing_job_id: opts.jobId,
          progress_key: opts.progressKey,
          job_type: "translation",
          level: "success",
          phase: "llm_batch",
          message: `Translation batch ${batchIndex}/${groups.length} completed`,
          batch_index: batchIndex,
          batch_total: groups.length,
          item_count: group.length,
          provider: providerName,
          model,
          duration_ms: Date.now() - started,
          input_tokens: batchUsage?.input_tokens ?? null,
          output_tokens: batchUsage?.output_tokens ?? null,
        });
      }
      await opts.shouldContinue?.();
    });
  } catch (e: any) {
    const error = e?.message || String(e);
    await setProgress(env, opts.progressKey, { status: "failed", error });
    throw e;
  }

  if (done < comments.length || failedBatches > 0) {
    await setProgress(env, opts.progressKey, { status: "queued" });
    return { translated: done, total, provider: providerName, complete: false, failedBatches };
  }

  await setProgress(env, opts.progressKey, { status: "done" });
  return { translated: done, total, provider: providerName, complete: true };
}
