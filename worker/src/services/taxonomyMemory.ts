import { isTopic, TOPIC_LABELS_VI, type Topic } from "../taxonomy";
import type { Env } from "../types";
import { resolveLlmProvider } from "./llmAgentConfig";
import { getSemanticSubtopic } from "./subtopicSemantics";
import { isGenericMajorTopicKeyword, normalizeTopicText } from "./topicKeywords";

export const MEMORY_ACTIVE_EVIDENCE_THRESHOLD = 3;

export interface SubtopicCandidate {
  parent_topic: Topic;
  label_vi: string;
  label_zh_cn?: string | null;
  description?: string | null;
  comment_ids: number[];
  confidence?: number;
  novelty?: "new" | "known" | "emerging";
}

export interface RunCommentForMemory {
  id: number;
  message: string;
  created_at: string | null;
  source_type: string;
  topic_main: string;
  sentiment: string;
  urgency: string;
  summary: string | null;
  other_suggested: string | null;
}

export function normalizeSubtopicKey(parentTopic: string, label: string): string {
  const semantic = getSemanticSubtopic(parentTopic, label);
  if (semantic) return semantic.key;
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${parentTopic}:${normalized || "unknown"}`;
}

export function nextSubtopicStatus(existingEvidence: number, newEvidence: number): "pending" | "active" {
  return existingEvidence + newEvidence >= MEMORY_ACTIVE_EVIDENCE_THRESHOLD ? "active" : "pending";
}

export function parseSubtopicDiscoveryResults(raw: string): SubtopicCandidate[] {
  let text = raw.trim();
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
    if (start !== -1 && end !== -1) {
      data = JSON.parse(text.slice(start, end + 1));
    } else {
      const arrStart = text.indexOf("[");
      const arrEnd = text.lastIndexOf("]");
      data = JSON.parse(text.slice(arrStart, arrEnd + 1));
    }
  }

  const items = Array.isArray(data) ? data : data.subtopics || data.items || data.results || [];
  if (!Array.isArray(items)) return [];

  const out: SubtopicCandidate[] = [];
  for (const item of items) {
    const parent = String(item?.parent_topic || item?.topic_main || "").trim();
    const label = String(item?.label_vi || item?.label || item?.name || "").trim();
    if (!isTopic(parent) || !label) continue;

    const rawIds: number[] = (item.comment_ids || item.evidence_comment_ids || [])
      .map((id: any) => Number(id))
      .filter((id: number) => Number.isInteger(id) && id > 0);
    const ids = Array.from(new Set<number>(rawIds));
    if (!ids.length) continue;

    const confidence = Number(item.confidence);
    out.push({
      parent_topic: parent,
      label_vi: label.slice(0, 120),
      label_zh_cn: item.label_zh_cn ? String(item.label_zh_cn).slice(0, 120) : null,
      description: item.description ? String(item.description).slice(0, 400) : null,
      comment_ids: ids,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(confidence, 1)) : 0.7,
      novelty: item.novelty === "known" || item.novelty === "emerging" ? item.novelty : "new",
    });
  }
  return out;
}

export function buildDiscoverySystem(): string {
  return [
    "Bạn là taxonomy memory agent cho liveops game Crossfire Legends.",
    "Nhiệm vụ: đọc hiểu comment đã được phân loại theo chủ đề lớn và phát hiện chủ đề con theo ý định/vấn đề vận hành bên trong từng chủ đề lớn.",
    "Không tạo chủ đề con chỉ vì một n-gram hoặc cụm chữ lặp lại. Cụm chữ chỉ là evidence; label cuối cùng phải phản ánh cùng một vấn đề thật mà người chơi đang nói.",
    "Hãy gộp các cách diễn đạt giống nghĩa vào một label canonical ngắn, dễ hiểu, không trùng chủ đề lớn. Ví dụ update_download: \"nhật xong\", \"cập nhật xong\", \"phiên bản mới\", \"cập nhật mới\", \"nhật phiên bản mới\" đều gộp về \"Cập nhật/phiên bản mới\".",
    "Nếu existing active/pending subtopic đã bao phủ ý nghĩa của comment mới, hãy dùng lại label gần nhất thay vì tạo biến thể text mới.",
    "Ưu tiên các vấn đề lặp lại trong nhiều comment của cùng một lượt phân tích, kể cả khi chúng chưa nằm trong taxonomy lớn hiện tại.",
    "Chỉ tạo chủ đề con khi có evidence từ comment; không suy đoán campaign, lỗi kỹ thuật hoặc nguyên nhân nếu comment không nói rõ.",
    "Chủ đề con tốt cho liveops nên trả lời được: người chơi đang gặp/khen/chê điều gì, team nào có thể triage, và nó khác gì với chủ đề lớn.",
    "Trả về duy nhất JSON: {\"subtopics\":[{\"parent_topic\":\"gameplay_mode_map\",\"label_vi\":\"...\",\"label_zh_cn\":\"...\",\"description\":\"...\",\"comment_ids\":[1,2],\"confidence\":0.8,\"novelty\":\"new|known|emerging\"}]}",
  ].join("\n");
}

function buildDiscoveryUser(comments: RunCommentForMemory[], existingByTopic: Record<string, string[]>): string {
  const lines = ["Existing active/pending subtopics by parent topic:"];
  for (const [topic, labels] of Object.entries(existingByTopic)) {
    lines.push(`- ${topic}: ${labels.length ? labels.join(", ") : "(none)"}`);
  }
  lines.push("\nComments:");
  for (const c of comments.slice(0, 160)) {
    lines.push("---");
    lines.push(`[id=${c.id}] parent_topic=${c.topic_main} sentiment=${c.sentiment} urgency=${c.urgency}`);
    if (c.summary) lines.push(`summary=${c.summary.slice(0, 260)}`);
    if (c.other_suggested) lines.push(`other_suggested=${c.other_suggested.slice(0, 120)}`);
    lines.push(`message=${c.message.slice(0, 700)}`);
  }
  return lines.join("\n");
}

const SUBTOPIC_STOPWORDS = new Set([
  "a", "ad", "admin", "anh", "ban", "bang", "bi", "bị", "cac", "cai", "can", "cho",
  "choi", "cua", "cung", "da", "dang", "de", "den", "duoc", "game", "gi", "gio",
  "hay", "hon", "k", "kh", "khi", "khong", "ko", "la", "lai", "lam", "len", "luon",
  "ma", "may", "minh", "mot", "nay", "nen", "nguoi", "nhieu", "nhung", "no", "qua",
  "ra", "roi", "sau", "thi", "thoi", "trong", "van", "vao", "vi", "voi",
]);

interface SubtopicToken {
  raw: string;
  normalized: string;
}

function tokenizeForSubtopics(message: string): SubtopicToken[] {
  return [...message.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => {
      const raw = match[0];
      return { raw, normalized: normalizeTopicText(raw) };
    })
    .filter((token) => token.normalized.length >= 2 && !/^\d+$/.test(token.normalized));
}

function usefulPhrase(tokens: SubtopicToken[]): boolean {
  const normalizedTokens = tokens.map((token) => token.normalized);
  const normalizedPhrase = normalizedTokens.join(" ");
  if (isGenericMajorTopicKeyword(normalizedPhrase)) return false;
  if (SUBTOPIC_STOPWORDS.has(normalizedTokens[0]) || SUBTOPIC_STOPWORDS.has(normalizedTokens.at(-1)!)) return false;
  if (normalizedTokens.every((token) => SUBTOPIC_STOPWORDS.has(token))) return false;
  return normalizedTokens.some((token) => token.length >= 3 && !SUBTOPIC_STOPWORDS.has(token));
}

export function extractRepeatedSubtopicCandidates(
  comments: RunCommentForMemory[],
  minEvidence = MEMORY_ACTIVE_EVIDENCE_THRESHOLD
): SubtopicCandidate[] {
  const byKey = new Map<string, { parent_topic: Topic; label_vi: string; token_count: number; ids: Set<number> }>();

  for (const comment of comments) {
    if (!isTopic(comment.topic_main) || !comment.message.trim()) continue;
    const tokens = tokenizeForSubtopics(comment.message);
    const seenInComment = new Set<string>();

    for (let size = 2; size <= 4; size += 1) {
      for (let start = 0; start <= tokens.length - size; start += 1) {
        const phraseTokens = tokens.slice(start, start + size);
        if (!usefulPhrase(phraseTokens)) continue;
        const normalizedPhrase = phraseTokens.map((token) => token.normalized).join(" ");
        const semantic = getSemanticSubtopic(comment.topic_main, normalizedPhrase);
        const key = semantic?.key || `${comment.topic_main}:${normalizedPhrase}`;
        if (seenInComment.has(key)) continue;
        seenInComment.add(key);

        const label = semantic?.label_vi || phraseTokens.map((token) => token.raw).join(" ");
        const existing = byKey.get(key);
        if (existing) {
          existing.ids.add(comment.id);
        } else {
          byKey.set(key, {
            parent_topic: comment.topic_main,
            label_vi: label.slice(0, 120),
            token_count: size,
            ids: new Set([comment.id]),
          });
        }
      }
    }
  }

  return [...byKey.values()]
    .filter((candidate) => candidate.ids.size >= minEvidence)
    .sort((a, b) => b.ids.size - a.ids.size || a.token_count - b.token_count || a.label_vi.localeCompare(b.label_vi))
    .slice(0, 20)
    .map((candidate) => ({
      parent_topic: candidate.parent_topic,
      label_vi: candidate.label_vi,
      label_zh_cn: null,
      description: `Cụm được nhắc lại ${candidate.ids.size} lần trong ${TOPIC_LABELS_VI[candidate.parent_topic] || candidate.parent_topic}; nên theo dõi như chủ đề con.`,
      comment_ids: [...candidate.ids].sort((a, b) => a - b),
      confidence: Math.min(0.82, 0.52 + candidate.ids.size * 0.07),
      novelty: "emerging",
    }));
}

function mergeSubtopicCandidates(candidates: SubtopicCandidate[]): SubtopicCandidate[] {
  const byKey = new Map<string, SubtopicCandidate>();
  for (const candidate of candidates) {
    const key = normalizeSubtopicKey(candidate.parent_topic, candidate.label_vi);
    const semantic = getSemanticSubtopic(candidate.parent_topic, candidate.label_vi);
    const normalizedCandidate = semantic
      ? {
          ...candidate,
          label_vi: semantic.label_vi,
          label_zh_cn: candidate.label_zh_cn || semantic.label_zh_cn,
        }
      : candidate;
    const existing = byKey.get(key);
    if (existing) {
      existing.comment_ids = Array.from(new Set([...existing.comment_ids, ...normalizedCandidate.comment_ids])).sort((a, b) => a - b);
      existing.confidence = Math.max(existing.confidence ?? 0, normalizedCandidate.confidence ?? 0.7);
      continue;
    }
    byKey.set(key, { ...normalizedCandidate, comment_ids: Array.from(new Set(normalizedCandidate.comment_ids)).sort((a, b) => a - b) });
  }
  return [...byKey.values()];
}

function fallbackCandidates(comments: RunCommentForMemory[]): SubtopicCandidate[] {
  const candidates: SubtopicCandidate[] = [];
  for (const c of comments) {
    if (!isTopic(c.topic_main) || !c.other_suggested) continue;
    const label = c.other_suggested.trim();
    if (label.length < 3) continue;
    candidates.push({
      parent_topic: c.topic_main,
      label_vi: label.slice(0, 120),
      label_zh_cn: null,
      description: `Signal mới do classifier đề xuất trong ${TOPIC_LABELS_VI[c.topic_main] || c.topic_main}.`,
      comment_ids: [c.id],
      confidence: 0.55,
      novelty: "new",
    });
  }
  return mergeSubtopicCandidates([...candidates, ...extractRepeatedSubtopicCandidates(comments)]);
}

async function loadRunComments(env: Env, runId: number): Promise<RunCommentForMemory[]> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.message, c.created_at, c.source_type,
            a.topic_main, a.sentiment, a.urgency, a.summary, a.other_suggested
     FROM comments c
     JOIN analyses a ON a.comment_id = c.id
     WHERE c.ingest_run_id = ?
       AND c.skipped_analysis = 0
     ORDER BY c.created_at DESC`
  ).bind(runId).all<RunCommentForMemory>();
  return rows.results;
}

async function loadExistingSubtopics(env: Env, parentTopics: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const topic of parentTopics) out[topic] = [];
  if (!parentTopics.length) return out;

  const placeholders = parentTopics.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT parent_topic, label_vi
     FROM taxonomy_subtopics
     WHERE parent_topic IN (${placeholders})
       AND status IN ('pending','active')
     ORDER BY evidence_count DESC, last_seen_at DESC
     LIMIT 120`
  ).bind(...parentTopics).all<{ parent_topic: string; label_vi: string }>();
  for (const row of rows.results) {
    if (!out[row.parent_topic]) out[row.parent_topic] = [];
    out[row.parent_topic].push(row.label_vi);
  }
  return out;
}

async function discoverCandidates(env: Env, comments: RunCommentForMemory[]): Promise<{ candidates: SubtopicCandidate[]; provider: string; model: string | null }> {
  const parentTopics = [...new Set(comments.map((c) => c.topic_main).filter(isTopic))];
  const existing = await loadExistingSubtopics(env, parentTopics);
  const provider = await resolveLlmProvider(env, "reasoning");

  if (!provider) return { candidates: fallbackCandidates(comments), provider: "fallback", model: null };

  try {
    const raw = await provider.completeJson(buildDiscoverySystem(), buildDiscoveryUser(comments, existing));
    const parsed = parseSubtopicDiscoveryResults(raw);
    return {
      candidates: mergeSubtopicCandidates(parsed.length
        ? [...parsed, ...extractRepeatedSubtopicCandidates(comments)]
        : fallbackCandidates(comments)),
      provider: provider.name,
      model: provider.model,
    };
  } catch (e) {
    console.warn(`taxonomy memory discovery failed (${e}), using fallback`);
    return { candidates: fallbackCandidates(comments), provider: "fallback", model: null };
  }
}

async function upsertCandidate(env: Env, candidate: SubtopicCandidate, observedAt: string): Promise<number> {
  const key = normalizeSubtopicKey(candidate.parent_topic, candidate.label_vi);
  const existing = await env.DB.prepare(
    `SELECT id, evidence_count, status FROM taxonomy_subtopics WHERE key = ?`
  ).bind(key).first<{ id: number; evidence_count: number; status: string }>();
  const uniqueEvidence = Array.from(new Set(candidate.comment_ids));
  const status = existing?.status === "active"
    ? "active"
    : nextSubtopicStatus(existing?.evidence_count || 0, uniqueEvidence.length);

  if (!existing) {
    const res = await env.DB.prepare(
      `INSERT INTO taxonomy_subtopics
         (key, parent_topic, label_vi, label_zh_cn, description, aliases_json, status, evidence_count, first_seen_at, last_seen_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 'llm_memory', ?)`
    ).bind(
      key,
      candidate.parent_topic,
      candidate.label_vi,
      candidate.label_zh_cn || null,
      candidate.description || null,
      status,
      uniqueEvidence.length,
      observedAt,
      observedAt,
      observedAt
    ).run();
    return Number(res.meta.last_row_id);
  }

  await env.DB.prepare(
    `UPDATE taxonomy_subtopics
     SET label_zh_cn = COALESCE(?, label_zh_cn),
         description = COALESCE(?, description),
         status = ?,
         evidence_count = evidence_count + ?,
         last_seen_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    candidate.label_zh_cn || null,
    candidate.description || null,
    status,
    uniqueEvidence.length,
    observedAt,
    observedAt,
    existing.id
  ).run();
  return existing.id;
}

export async function discoverAndStoreRunMemory(env: Env, opts: { runId: number }) {
  const comments = await loadRunComments(env, opts.runId);
  if (!comments.length) {
    return { run_id: opts.runId, comments: 0, subtopics: 0, evidence: 0, provider: "none", model: null };
  }

  const observedAt = new Date().toISOString();
  const { candidates, provider, model } = await discoverCandidates(env, comments);
  const commentIds = new Set(comments.map((c) => c.id));
  const saved: Array<SubtopicCandidate & { subtopic_id: number; status_key: string }> = [];

  for (const candidate of candidates) {
    const cleanIds = Array.from(new Set(candidate.comment_ids.filter((id) => commentIds.has(id))));
    if (!cleanIds.length) continue;
    const subtopicId = await upsertCandidate(env, { ...candidate, comment_ids: cleanIds }, observedAt);
    const key = normalizeSubtopicKey(candidate.parent_topic, candidate.label_vi);
    const statements = cleanIds.map((commentId) =>
      env.DB.prepare(
        `INSERT INTO comment_subtopics (comment_id, subtopic_id, confidence, source, observed_at)
         VALUES (?, ?, ?, 'llm_memory', ?)
         ON CONFLICT(comment_id, subtopic_id) DO UPDATE SET
           confidence = MAX(confidence, excluded.confidence),
           observed_at = excluded.observed_at`
      ).bind(commentId, subtopicId, candidate.confidence ?? 0.7, observedAt)
    );
    if (statements.length) await env.DB.batch(statements);
    saved.push({ ...candidate, comment_ids: cleanIds, subtopic_id: subtopicId, status_key: key });
  }

  const periodStart = comments.map((c) => c.created_at).filter(Boolean).sort()[0] || null;
  const periodEnd = comments.map((c) => c.created_at).filter(Boolean).sort().at(-1) || null;
  const sourceGroup = comments.some((c) => c.source_type === "store") ? "store" : "facebook";
  const summary = saved.length
    ? `Memory run #${opts.runId}: phát hiện ${saved.length} chủ đề con / signal mới.`
    : `Memory run #${opts.runId}: chưa phát hiện chủ đề con mới đủ rõ.`;
  const memoryRes = await env.DB.prepare(
    `INSERT INTO feedback_memories (run_id, source_group, period_start, period_end, summary, novel_signals_json, provider, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    opts.runId,
    sourceGroup,
    periodStart,
    periodEnd,
    summary,
    JSON.stringify(saved.map((c) => ({
      subtopic_id: c.subtopic_id,
      key: c.status_key,
      parent_topic: c.parent_topic,
      label_vi: c.label_vi,
      label_zh_cn: c.label_zh_cn,
      comment_ids: c.comment_ids,
      novelty: c.novelty,
    }))),
    provider,
    model,
    observedAt
  ).run();
  const memoryId = Number(memoryRes.meta.last_row_id);

  const evidenceStatements = saved.flatMap((candidate) =>
    candidate.comment_ids.slice(0, 8).map((commentId) =>
      env.DB.prepare(
        `INSERT INTO memory_evidence (memory_id, comment_id, subtopic_id, note, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(memory_id, comment_id, subtopic_id) DO NOTHING`
      ).bind(memoryId, commentId, candidate.subtopic_id, candidate.label_vi, observedAt)
    )
  );
  if (evidenceStatements.length) await env.DB.batch(evidenceStatements);

  return {
    run_id: opts.runId,
    comments: comments.length,
    subtopics: saved.length,
    evidence: saved.reduce((sum, candidate) => sum + candidate.comment_ids.length, 0),
    provider,
    model,
  };
}
