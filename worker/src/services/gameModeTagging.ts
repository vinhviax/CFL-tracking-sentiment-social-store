import type { Env } from "../types";
import {
  GAME_MODE_BY_KEY,
  GAME_MODES,
  matchGameModes,
} from "./gameModes";
import { type ByoOverride, resolveLlmProviderChain } from "./llmAgentConfig";
import { completeJsonForSlot } from "./llmSlotState";

export interface TagGameModesOptions {
  from?: string;
  to?: string;
  verify?: boolean;
  verifyBatchSize?: number;
  maxLlmBatches?: number;
  debug?: boolean;
  /** Caller-supplied provider, used in memory only and never persisted. */
  byo?: ByoOverride | null;
}

export interface TagGameModesResult {
  range: { from: string | null; to: string | null };
  comments_scanned: number;
  confident_tags: number;
  ambiguous_candidates: number;
  llm_confirmed: number;
  llm_batches: number;
  llm_provider: string;
  tags_written: number;
  per_mode: Record<string, number>;
  debug_samples?: Array<{ raw: string; parsed_ids: number[] }>;
}

interface CommentRow {
  id: number;
  message: string;
}

interface CandidateTag {
  comment_id: number;
  mode_key: string;
  source: "keyword" | "keyword_llm";
  confidence: number;
}

function dateKey(value?: string | null): string | null {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

// Insert/refresh the 9 curated mode subtopics as active taxonomy_subtopics.
export async function seedGameModeSubtopics(env: Env, observedAt: string): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const mode of GAME_MODES) {
    await env.DB.prepare(
      `INSERT INTO taxonomy_subtopics
         (key, parent_topic, label_vi, label_zh_cn, description, aliases_json, status, evidence_count, first_seen_at, last_seen_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', 'active', 0, ?, ?, 'curated_game_mode', ?)
       ON CONFLICT(key) DO UPDATE SET
         label_vi = excluded.label_vi,
         label_zh_cn = excluded.label_zh_cn,
         description = COALESCE(taxonomy_subtopics.description, excluded.description),
         status = 'active',
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`
    )
      .bind(
        mode.key,
        mode.key.split(":")[0],
        mode.label_vi,
        mode.label_zh_cn,
        mode.description,
        observedAt,
        observedAt,
        observedAt
      )
      .run();

    const row = await env.DB.prepare(`SELECT id FROM taxonomy_subtopics WHERE key = ?`)
      .bind(mode.key)
      .first<{ id: number }>();
    if (row?.id) ids.set(mode.key, row.id);
  }
  return ids;
}

async function loadCommentsInRange(env: Env, from: string | null, to: string | null): Promise<CommentRow[]> {
  const where: string[] = ["c.message IS NOT NULL", "trim(c.message) != ''"];
  const params: any[] = [];
  if (from) { where.push("substr(c.created_at, 1, 10) >= ?"); params.push(from); }
  if (to) { where.push("substr(c.created_at, 1, 10) <= ?"); params.push(to); }
  const rows = await env.DB.prepare(
    `SELECT c.id, c.message FROM comments c WHERE ${where.join(" AND ")} ORDER BY c.id`
  ).bind(...params).all<CommentRow>();
  return rows.results;
}

function buildVerifySystem(): string {
  const modeList = GAME_MODES.map((mode) => `- ${mode.key}: ${mode.label_vi} (${mode.description})`).join("\n");
  return [
    "Bạn là bộ phân loại chế độ chơi (game mode) của game bắn súng Crossfire Legends.",
    "Với mỗi comment kèm danh sách chế độ ứng viên, hãy xác định comment có THỰC SỰ nói về chế độ chơi đó không.",
    "Chỉ xác nhận khi comment nói về CHẾ ĐỘ CHƠI, không phải vật phẩm/vũ khí trùng tên (ví dụ 'dao' là vũ khí, không phải chế độ Đấu Dao).",
    "Danh sách chế độ:",
    modeList,
    'Trả về DUY NHẤT JSON dạng: {"results":[{"id":123,"modes":["gameplay_mode_map:dau_dao"]}]}',
    "Nếu comment không thuộc chế độ ứng viên nào, trả modes rỗng.",
  ].join("\n");
}

function buildVerifyUser(items: Array<{ id: number; message: string; candidates: string[] }>): string {
  const lines: string[] = [];
  for (const item of items) {
    const candidateLabels = item.candidates
      .map((key) => `${key} = ${GAME_MODE_BY_KEY.get(key)?.label_vi || key}`)
      .join("; ");
    lines.push("---");
    lines.push(`id=${item.id}`);
    lines.push(`chế độ ứng viên: ${candidateLabels}`);
    lines.push(`comment: ${item.message.slice(0, 500)}`);
  }
  return lines.join("\n");
}

function parseVerifyResults(raw: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  let text = String(raw || "").trim();
  if (text.startsWith("```")) {
    const parts = text.split("```");
    text = (parts[1] || "").replace(/^json/i, "").trim();
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return out;
    try {
      data = JSON.parse(text.slice(start, end + 1));
    } catch {
      return out;
    }
  }
  const items = Array.isArray(data) ? data : data.results || data.items || [];
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    const id = Number(item?.id);
    if (!Number.isInteger(id)) continue;
    const modes: string[] = (item.modes || item.mode_keys || [])
      .map((m: any) => String(m).trim())
      .filter((m: string) => GAME_MODE_BY_KEY.has(m));
    out.set(id, Array.from(new Set(modes)));
  }
  return out;
}

export async function tagGameModes(env: Env, options: TagGameModesOptions = {}): Promise<TagGameModesResult> {
  const from = dateKey(options.from);
  const to = dateKey(options.to);
  const verify = options.verify !== false;
  const verifyBatchSize = Math.max(1, Math.min(options.verifyBatchSize || 20, 40));
  const maxLlmBatches = Math.max(0, options.maxLlmBatches ?? 40);
  const observedAt = new Date().toISOString();

  const ids = await seedGameModeSubtopics(env, observedAt);
  const comments = await loadCommentsInRange(env, from, to);

  const tags: CandidateTag[] = [];
  const ambiguousItems: Array<{ id: number; message: string; candidates: string[] }> = [];
  let ambiguousCandidates = 0;

  for (const comment of comments) {
    const match = matchGameModes(comment.message);
    for (const modeKey of match.confident) {
      tags.push({ comment_id: comment.id, mode_key: modeKey, source: "keyword", confidence: 0.9 });
    }
    if (match.ambiguous.length) {
      ambiguousCandidates += match.ambiguous.length;
      ambiguousItems.push({ id: comment.id, message: comment.message, candidates: match.ambiguous });
    }
  }

  // Verification is a classification judgement, so it uses the reasoning slot
  // rather than reading LLM_CLASSIFY_MODEL past the slot configuration.
  const chain = verify ? await resolveLlmProviderChain(env, "reasoning", options.byo) : [];

  let llmConfirmed = 0;
  let llmBatches = 0;
  const debugSamples: Array<{ raw: string; parsed_ids: number[] }> = [];
  if (chain.length && ambiguousItems.length) {
    for (let start = 0; start < ambiguousItems.length; start += verifyBatchSize) {
      if (llmBatches >= maxLlmBatches) break;
      const batch = ambiguousItems.slice(start, start + verifyBatchSize);
      llmBatches += 1;
      try {
        const { content: raw } = await completeJsonForSlot(
          env, "reasoning", chain, buildVerifySystem(), buildVerifyUser(batch),
          { recordable: options.byo == null }
        );
        const results = parseVerifyResults(raw);
        if (options.debug && debugSamples.length < 2) {
          debugSamples.push({ raw: String(raw).slice(0, 1500), parsed_ids: [...results.keys()] });
        }
        for (const item of batch) {
          const confirmed = (results.get(item.id) || []).filter((key) => item.candidates.includes(key));
          for (const modeKey of confirmed) {
            tags.push({ comment_id: item.id, mode_key: modeKey, source: "keyword_llm", confidence: 0.8 });
            llmConfirmed += 1;
          }
        }
      } catch (e) {
        if (options.debug && debugSamples.length < 2) {
          debugSamples.push({ raw: `ERROR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 1500), parsed_ids: [] });
        }
        console.warn(`game-mode LLM verify batch failed (${e})`);
      }
    }
  }

  // De-duplicate (comment_id, mode_key), keeping the highest confidence.
  const dedup = new Map<string, CandidateTag>();
  for (const tag of tags) {
    if (!ids.has(tag.mode_key)) continue;
    const key = `${tag.comment_id}:${tag.mode_key}`;
    const existing = dedup.get(key);
    if (!existing || tag.confidence > existing.confidence) dedup.set(key, tag);
  }
  const finalTags = [...dedup.values()];

  const perMode: Record<string, number> = {};
  for (const mode of GAME_MODES) perMode[mode.key] = 0;

  const CHUNK = 40;
  for (let start = 0; start < finalTags.length; start += CHUNK) {
    const chunk = finalTags.slice(start, start + CHUNK);
    const statements = chunk.map((tag) => {
      perMode[tag.mode_key] += 1;
      return env.DB.prepare(
        `INSERT INTO comment_subtopics (comment_id, subtopic_id, confidence, source, observed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(comment_id, subtopic_id) DO UPDATE SET
           confidence = MAX(confidence, excluded.confidence),
           source = excluded.source,
           observed_at = excluded.observed_at`
      ).bind(tag.comment_id, ids.get(tag.mode_key)!, tag.confidence, tag.source, observedAt);
    });
    if (statements.length) await env.DB.batch(statements);
  }

  // Refresh evidence_count from the ground truth so re-runs stay idempotent.
  for (const [modeKey, subtopicId] of ids) {
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM comment_subtopics WHERE subtopic_id = ?`
    ).bind(subtopicId).first<{ n: number }>();
    await env.DB.prepare(
      `UPDATE taxonomy_subtopics SET evidence_count = ?, status = 'active', updated_at = ? WHERE id = ?`
    ).bind(Number(countRow?.n || 0), observedAt, subtopicId).run();
  }

  return {
    range: { from, to },
    comments_scanned: comments.length,
    confident_tags: tags.filter((tag) => tag.source === "keyword").length,
    ambiguous_candidates: ambiguousCandidates,
    llm_confirmed: llmConfirmed,
    llm_batches: llmBatches,
    llm_provider: chain[0]?.name || "none",
    tags_written: finalTags.length,
    per_mode: perMode,
    ...(options.debug ? { debug_samples: debugSamples } : {}),
  };
}
