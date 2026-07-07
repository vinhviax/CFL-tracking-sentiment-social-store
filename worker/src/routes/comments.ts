import { Hono } from "hono";
import { getSemanticSubtopic } from "../services/subtopicSemantics";
import type { Env } from "../types";

export const commentsRoute = new Hono<{ Bindings: Env }>();

const SELECT = `
  SELECT c.id, c.source_type, c.created_at, c.message, c.rating, c.country, c.store,
         c.legacy_topic, c.post_id,
         p.external_id as post_external_id, p.published_at as post_published_at,
         p.message as post_message, p.permalink as post_permalink,
         a.topic_main, a.topics_sub, a.sentiment, a.urgency, a.summary,
         a.other_suggested, a.confidence, a.provider, a.model,
         t.message_translated, t.summary_translated
  FROM comments c
  LEFT JOIN posts p ON p.id = c.post_id
  LEFT JOIN analyses a ON a.comment_id = c.id
  LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
`;

function dateKey(value?: string | null) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function addDateFilter(where: string[], params: any[], column: string, operator: ">=" | "<=", value?: string) {
  const key = dateKey(value);
  if (!key) return;
  where.push(`substr(${column}, 1, 10) ${operator} ?`);
  params.push(key);
}

function parseSubtopicKeys(value?: string) {
  return String(value || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .slice(0, 30);
}

async function loadCommentSubtopics(db: D1Database, commentIds: number[], lang: string): Promise<Map<number, any[]>> {
  const out = new Map<number, any[]>();
  if (!commentIds.length) return out;
  const placeholders = commentIds.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT cs.comment_id, cs.confidence,
            st.key, st.parent_topic, st.label_vi, st.label_zh_cn, st.status
     FROM comment_subtopics cs
     JOIN taxonomy_subtopics st ON st.id = cs.subtopic_id
     WHERE cs.comment_id IN (${placeholders})
     ORDER BY cs.confidence DESC, st.evidence_count DESC`
  ).bind(...commentIds).all<any>();

  for (const row of rows.results) {
    const item = {
      key: row.key,
      parent_topic: row.parent_topic,
      label: lang === "zh-CN" && row.label_zh_cn ? row.label_zh_cn : row.label_vi,
      label_vi: row.label_vi,
      label_zh_cn: row.label_zh_cn || null,
      confidence: row.confidence,
      status: row.status,
    };
    if (!out.has(row.comment_id)) out.set(row.comment_id, []);
    out.get(row.comment_id)!.push(item);
  }
  return out;
}

export function mapCommentRow(r: any, lang = "vi") {
  const wantsZh = lang === "zh-CN";
  const message = wantsZh && r.message_translated ? r.message_translated : r.message;
  const summary = wantsZh && r.summary_translated ? r.summary_translated : r.summary;
  const subtopicGroups = new Map<string, any>();
  for (const subtopic of r.dynamic_subtopics || []) {
    const semantic = getSemanticSubtopic(subtopic.parent_topic, subtopic.label_vi || subtopic.label || subtopic.key);
    const groupKey = semantic?.key || subtopic.key;
    const existing = subtopicGroups.get(groupKey);
    if (existing) {
      existing.keys.push(subtopic.key);
      continue;
    }
    subtopicGroups.set(groupKey, {
      ...subtopic,
      key: subtopic.key,
      keys: [subtopic.key],
      label: semantic
        ? (wantsZh && semantic.label_zh_cn ? semantic.label_zh_cn : semantic.label_vi)
        : (wantsZh && subtopic.label_zh_cn ? subtopic.label_zh_cn : (subtopic.label || subtopic.label_vi)),
      label_vi: semantic?.label_vi || subtopic.label_vi,
      label_zh_cn: semantic?.label_zh_cn || subtopic.label_zh_cn,
    });
  }
  const dynamicSubtopics = [...subtopicGroups.values()].map((subtopic) => ({
    ...subtopic,
    key: subtopic.keys.join(","),
  }));
  return {
    id: r.id,
    source_type: r.source_type,
    created_at: r.created_at,
    message,
    message_original: r.message,
    message_zh_cn: r.message_translated || null,
    rating: r.rating,
    country: r.country,
    store: r.store,
    legacy_topic: r.legacy_topic,
    post_id: r.post_id,
    post: r.post_id
      ? {
          id: r.post_id,
          external_id: r.post_external_id || null,
          published_at: r.post_published_at || null,
          message: r.post_message || "",
          permalink: r.post_permalink || null,
        }
      : null,
    analysis: r.topic_main
      ? {
          topic_main: r.topic_main,
          topics_sub: JSON.parse(r.topics_sub || "[]"),
          sentiment: r.sentiment,
          urgency: r.urgency,
          summary,
          summary_original: r.summary,
          summary_zh_cn: r.summary_translated || null,
          other_suggested: r.other_suggested,
          confidence: r.confidence,
          provider: r.provider,
          model: r.model,
          subtopics_dynamic: dynamicSubtopics,
        }
      : null,
  };
}

commentsRoute.get("/", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const filterParams: any[] = [];
  const lang = q.lang === "zh-CN" ? "zh-CN" : "vi";

  if (q.source) { where.push("c.source_type = ?"); filterParams.push(q.source); }
  if (q.group === "store") where.push("c.source_type = 'store'");
  if (q.group === "facebook") where.push("c.source_type IN ('fb_page','fb_group_csv')");
  if (q.post_id) { where.push("c.post_id = ?"); filterParams.push(Number(q.post_id)); }
  if (q.store) { where.push("c.store = ?"); filterParams.push(q.store); }
  if (q.q) { where.push("(c.message LIKE ? OR t.message_translated LIKE ?)"); filterParams.push(`%${q.q}%`, `%${q.q}%`); }
  addDateFilter(where, filterParams, "c.created_at", ">=", q.from);
  addDateFilter(where, filterParams, "c.created_at", "<=", q.to);
  if (q.topic) { where.push("a.topic_main = ?"); filterParams.push(q.topic); }
  if (q.subtopic) {
    const subtopicKeys = parseSubtopicKeys(q.subtopic);
    if (!subtopicKeys.length) return c.json({ detail: "Invalid subtopic filter" }, 400);
    const placeholders = subtopicKeys.map(() => "?").join(",");
    where.push(`EXISTS (
      SELECT 1 FROM comment_subtopics cs
      JOIN taxonomy_subtopics st ON st.id = cs.subtopic_id
      WHERE cs.comment_id = c.id AND st.key IN (${placeholders})
    )`);
    filterParams.push(...subtopicKeys);
  }
  if (q.sentiment) { where.push("a.sentiment = ?"); filterParams.push(q.sentiment); }
  if (q.urgency) { where.push("a.urgency = ?"); filterParams.push(q.urgency); }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.max(1, Number(q.page_size) || 50);

  const countRes = await c.env.DB
    .prepare(
      `SELECT COUNT(*) as total
       FROM comments c
       LEFT JOIN analyses a ON a.comment_id = c.id
       LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
       ${whereSql}`
    )
    .bind(lang, ...filterParams)
    .first<{ total: number }>();

  const rows = await c.env.DB
    .prepare(`${SELECT} ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`)
    .bind(lang, ...filterParams, pageSize, (page - 1) * pageSize)
    .all();
  const commentIds = rows.results.map((row: any) => Number(row.id)).filter((id) => Number.isInteger(id));
  const subtopics = await loadCommentSubtopics(c.env.DB, commentIds, lang);

  return c.json({
    total: countRes?.total || 0,
    page,
    page_size: pageSize,
    items: rows.results.map((row: any) => mapCommentRow({ ...row, dynamic_subtopics: subtopics.get(row.id) || [] }, lang)),
  });
});
