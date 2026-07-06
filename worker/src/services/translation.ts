import type { Env } from "../types";
import { buildProvider } from "./llm/providers";

export const DEFAULT_TRANSLATION_LOCALE = "zh-CN";

interface PendingTranslation {
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

export async function getTranslationProgress(env: Env, key: string) {
  const row = await env.DB.prepare(`SELECT status, done, total, provider, error FROM analyze_jobs WHERE progress_key=?`)
    .bind(key).first();
  return row || { status: "unknown", done: 0, total: 0 };
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

  const limit = Math.max(1, Math.min(Number(opts.limit) || 200, 1000));
  const rows = await env.DB.prepare(
    `SELECT c.id, c.message, a.summary
     FROM comments c
     LEFT JOIN analyses a ON a.comment_id = c.id
     LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
     WHERE ${where.join(" AND ")}
     ORDER BY c.id
     LIMIT ?`
  ).bind(...params, limit).all<PendingTranslation>();
  return rows.results;
}

function parseJsonLike(text: string): any {
  return JSON.parse(text);
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
      const data = parseJsonLike(payload);
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
  try {
    data = JSON.parse(text);
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    data = JSON.parse(text.slice(start, end + 1));
  }
  if (!Array.isArray(data)) data = data.results || data.data || data.items || [];
  if (!Array.isArray(data)) return [];
  return data.map(normalizeTranslation).filter((r): r is TranslationResult => r !== null);
}

function buildUser(items: PendingTranslation[]): string {
  const lines = ["Translate these CFL player feedback records into Simplified Chinese (zh-CN)."];
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
    progressKey: string;
    locale?: string;
    commentIds?: number[];
    runId?: number;
    force?: boolean;
    limit?: number;
  }
) {
  const locale = opts.locale || DEFAULT_TRANSLATION_LOCALE;
  const provider = buildProvider(env.LLM_PROVIDER, env.LLM_INSIGHT_MODEL, {
    anthropicKey: env.ANTHROPIC_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    llmViaxKey: env.LLM_VIAX_API_KEY,
    llmViaxBaseUrl: env.LLM_VIAX_BASE_URL,
  });
  const providerName = provider?.name ?? "unavailable";
  const model = provider?.model ?? null;

  const comments = await pendingTranslations(env, { ...opts, locale });
  await setProgress(env, opts.progressKey, { status: "running", done: 0, total: comments.length, provider: providerName });

  if (!comments.length) {
    await setProgress(env, opts.progressKey, { status: "done" });
    return { translated: 0, total: 0, provider: providerName };
  }

  if (!provider) {
    const error = "LLM provider chưa sẵn sàng để dịch zh-CN";
    await setProgress(env, opts.progressKey, { status: "failed", error });
    throw new Error(error);
  }

  const system = "You are a professional game operations translator. Translate Vietnamese player feedback for Crossfire Legends into concise Simplified Chinese. Preserve game terms such as hack/cheat, lag, ping, top-up, account, event, bug.";
  const translatedAt = new Date().toISOString();
  let done = 0;

  try {
    for (const group of chunk(comments, 20)) {
      const raw = await provider.completeJson(system, buildUser(group));
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
      await setProgress(env, opts.progressKey, { done });
    }
  } catch (e: any) {
    const error = e?.message || String(e);
    await setProgress(env, opts.progressKey, { status: "failed", error });
    throw e;
  }

  await setProgress(env, opts.progressKey, { status: "done" });
  return { translated: done, total: comments.length, provider: providerName };
}
