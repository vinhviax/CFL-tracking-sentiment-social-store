import { Hono } from "hono";
import type { Env } from "../types";
import { LEGACY_TOPIC_LABELS_VI, LEGACY_TOPIC_LABELS_ZH_CN, TOPIC_LABELS_VI, TOPIC_LABELS_ZH_CN } from "../taxonomy";
import { summarizeStoreBreakdown } from "../services/storeStats";
import { getSemanticSubtopic } from "../services/subtopicSemantics";
import { addTopicFilter, parseTopicKeys } from "../services/topicScope";
import { loadTokenUsageByRange } from "../services/tokenUsage";

export const statsRoute = new Hono<{ Bindings: Env }>();

type TrendRow = { d: string | null; sentiment: string | null; n: number };
type TrendPoint = { date: string; negative: number; neutral: number; positive: number };

function dateKey(value?: string | null) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
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

function addSubtopicFilter(where: string[], params: any[], value?: string, alias = "st_filter") {
  const keys = parseSubtopicKeys(value);
  if (!keys.length) return;
  const placeholders = keys.map(() => "?").join(",");
  where.push(`EXISTS (
      SELECT 1 FROM comment_subtopics cs_filter
      JOIN taxonomy_subtopics ${alias} ON ${alias}.id = cs_filter.subtopic_id
      WHERE cs_filter.comment_id = c.id AND ${alias}.key IN (${placeholders})
    )`);
  params.push(...keys);
}

export function buildTrendSeries(rows: TrendRow[], q: Record<string, string> = {}): TrendPoint[] {
  const series = new Map<string, TrendPoint>();
  const ensurePoint = (date: string) => {
    if (!series.has(date)) series.set(date, { date, negative: 0, neutral: 0, positive: 0 });
    return series.get(date)!;
  };

  const from = dateKey(q.from);
  const to = dateKey(q.to);
  if (from && to) {
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (Number.isFinite(days) && days >= 0 && days <= 370) {
      for (let offset = 0; offset <= days; offset += 1) {
        ensurePoint(toIsoDate(addDays(start, offset)));
      }
    }
  }

  for (const r of rows) {
    const day = dateKey(r.d);
    if (!day) continue;
    const point = ensurePoint(day);
    if (r.sentiment === "negative" || r.sentiment === "neutral" || r.sentiment === "positive") {
      point[r.sentiment] = Number(r.n || 0);
    }
  }

  return [...series.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function baseFilters(q: Record<string, string>) {
  const where: string[] = [];
  const params: any[] = [];
  if (q.group === "store") where.push("c.source_type = 'store'");
  if (q.group === "facebook") where.push("c.source_type IN ('fb_page','fb_group_csv')");
  if (q.source) { where.push("c.source_type = ?"); params.push(q.source); }
  if (q.store) { where.push("c.store = ?"); params.push(q.store); }
  if (q.post_id) { where.push("c.post_id = ?"); params.push(Number(q.post_id)); }
  addDateFilter(where, params, "c.created_at", ">=", q.from);
  addDateFilter(where, params, "c.created_at", "<=", q.to);
  addSubtopicFilter(where, params, q.subtopic);
  return { where, params };
}

function overviewFilters(q: Record<string, string>) {
  const { where, params } = baseFilters(q);
  const topicKeys = addTopicFilter(where, params, q.topic);
  return { where, params, topicKeys };
}

function topicLabel(topic: string, lang?: string) {
  const labels = lang === "zh-CN" ? TOPIC_LABELS_ZH_CN : TOPIC_LABELS_VI;
  const legacyLabels = lang === "zh-CN" ? LEGACY_TOPIC_LABELS_ZH_CN : LEGACY_TOPIC_LABELS_VI;
  return labels[topic] || legacyLabels[topic] || topic;
}

function isActionableTopic(topic?: string | null) {
  return Boolean(topic) && topic !== "other";
}

function subtopicLabel(row: { label_vi: string; label_zh_cn?: string | null }, lang?: string) {
  return lang === "zh-CN" && row.label_zh_cn ? row.label_zh_cn : row.label_vi;
}

export async function computeSubtopicRanking(db: D1Database, q: Record<string, string>, limitInput = 12) {
  const { where, params } = baseFilters(q);
  const w = [...where];
  addTopicFilter(w, params, q.topic);
  if (q.sentiment) { w.push("a.sentiment = ?"); params.push(q.sentiment); }
  if (q.urgency) { w.push("a.urgency = ?"); params.push(q.urgency); }
  const whereSql = w.length ? `WHERE ${w.join(" AND ")}` : "";
  const lang = q.lang === "zh-CN" ? "zh-CN" : "vi";
  const limit = Math.max(1, Math.min(Number(limitInput) || 12, 50));

  const rowLimit = Math.max(limit * 6, limit);
  const rows = await db.prepare(
    `SELECT st.id, st.key, st.parent_topic, st.label_vi, st.label_zh_cn, st.status, st.evidence_count,
            COUNT(DISTINCT c.id) as count,
            SUM(CASE WHEN a.sentiment = 'negative' THEN 1 ELSE 0 END) as negative_count,
            SUM(CASE WHEN a.urgency IN ('medium','high') THEN 1 ELSE 0 END) as urgent_count
     FROM comments c
     JOIN analyses a ON a.comment_id = c.id
     JOIN comment_subtopics cs ON cs.comment_id = c.id
     JOIN taxonomy_subtopics st ON st.id = cs.subtopic_id
     ${whereSql}
     GROUP BY st.id
     ORDER BY count DESC, negative_count DESC, st.evidence_count DESC
     LIMIT ?`
  ).bind(...params, rowLimit).all<any>();

  const groups = new Map<string, any>();
  for (const row of rows.results) {
    const semantic = getSemanticSubtopic(row.parent_topic, row.label_vi);
    const groupKey = semantic?.key || row.key;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.keys.push(row.key);
      existing.source_rows.push(row);
      existing.evidence_count += Number(row.evidence_count || 0);
      existing.status = existing.status === "active" || row.status === "active" ? "active" : existing.status;
      continue;
    }
    groups.set(groupKey, {
      id: row.id,
      key: row.key,
      keys: [row.key],
      source_rows: [row],
      parent_topic: row.parent_topic,
      parent_label: topicLabel(row.parent_topic, lang),
      label: semantic ? (lang === "zh-CN" && semantic.label_zh_cn ? semantic.label_zh_cn : semantic.label_vi) : subtopicLabel(row, lang),
      label_vi: semantic?.label_vi || row.label_vi,
      label_zh_cn: semantic?.label_zh_cn || row.label_zh_cn || null,
      status: row.status,
      evidence_count: Number(row.evidence_count || 0),
      count: Number(row.count || 0),
      negative_count: Number(row.negative_count || 0),
      urgent_count: Number(row.urgent_count || 0),
    });
  }

  const out = [];
  for (const group of groups.values()) {
    if (group.keys.length > 1) {
      const keyPlaceholders = group.keys.map(() => "?").join(",");
      const counts = await db.prepare(
        `SELECT COUNT(DISTINCT c.id) as count,
                COUNT(DISTINCT CASE WHEN a.sentiment = 'negative' THEN c.id END) as negative_count,
                COUNT(DISTINCT CASE WHEN a.urgency IN ('medium','high') THEN c.id END) as urgent_count
         FROM comments c
         JOIN analyses a ON a.comment_id = c.id
         JOIN comment_subtopics cs ON cs.comment_id = c.id
         JOIN taxonomy_subtopics st ON st.id = cs.subtopic_id
         ${whereSql ? `${whereSql} AND` : "WHERE"} st.key IN (${keyPlaceholders})`
      ).bind(...params, ...group.keys).first<any>();
      group.count = Number(counts?.count || 0);
      group.negative_count = Number(counts?.negative_count || 0);
      group.urgent_count = Number(counts?.urgent_count || 0);
    }
    group.key = group.keys.join(",");
    delete group.source_rows;
    out.push(group);
  }

  return out
    .sort((a, b) => b.count - a.count || b.negative_count - a.negative_count || b.evidence_count - a.evidence_count)
    .slice(0, limit);
}

export async function computeOverview(db: D1Database, q: Record<string, string>) {
  const { where, params, topicKeys } = overviewFilters(q);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const scopedByTopic = topicKeys.length > 0;
  const totalRow = scopedByTopic
    ? await db
      .prepare(`SELECT COUNT(*) as n FROM comments c JOIN analyses a ON a.comment_id = c.id ${whereSql}`)
      .bind(...params).first<{ n: number }>()
    : await db.prepare(`SELECT COUNT(*) as n FROM comments c ${whereSql}`).bind(...params).first<{ n: number }>();
  const analyzedRow = scopedByTopic
    ? totalRow
    : await db
      .prepare(`SELECT COUNT(*) as n FROM comments c JOIN analyses a ON a.comment_id = c.id ${whereSql}`)
      .bind(...params).first<{ n: number }>();

  const sentimentRows = await db
    .prepare(`SELECT a.sentiment, COUNT(*) as n FROM comments c JOIN analyses a ON a.comment_id=c.id ${whereSql} GROUP BY a.sentiment`)
    .bind(...params).all<{ sentiment: string; n: number }>();
  const sentiment: Record<string, number> = { negative: 0, neutral: 0, positive: 0 };
  for (const r of sentimentRows.results) sentiment[r.sentiment] = r.n;

  const topicRows = await db
    .prepare(`SELECT a.topic_main, COUNT(*) as n FROM comments c JOIN analyses a ON a.comment_id=c.id ${whereSql} GROUP BY a.topic_main ORDER BY n DESC`)
    .bind(...params).all<{ topic_main: string; n: number }>();
  const topTopics = topicRows.results
    .filter((r) => isActionableTopic(r.topic_main))
    .map((r) => ({ topic: r.topic_main, label: topicLabel(r.topic_main, q.lang), count: r.n }));

  const hotWhere = [...where, "a.sentiment = 'negative'", "a.topic_main IS NOT NULL", "a.topic_main != 'other'"];
  const hotRows = await db
    .prepare(
      `SELECT a.topic_main, COUNT(*) as negative, SUM(CASE WHEN a.urgency IN ('medium','high') THEN 1 ELSE 0 END) as urgent
       FROM comments c JOIN analyses a ON a.comment_id=c.id
       WHERE ${hotWhere.join(" AND ")}
       GROUP BY a.topic_main
       ORDER BY urgent DESC, negative DESC
       LIMIT 8`
    ).bind(...params).all<{ topic_main: string; negative: number; urgent: number }>();
  const hotIssues = hotRows.results
    .filter((r) => isActionableTopic(r.topic_main))
    .map((r) => ({
      topic: r.topic_main, label: topicLabel(r.topic_main, q.lang),
      negative: r.negative, urgent: Number(r.urgent || 0),
    }));

  const analyzed = analyzedRow?.n || 0;
  const neg = sentiment.negative || 0;
  const topSubtopics = await computeSubtopicRanking(db, q, 8);
  return {
    total_comments: totalRow?.n || 0,
    analyzed,
    sentiment,
    negative_pct: analyzed ? Math.round((neg / analyzed) * 1000) / 10 : 0,
    top_topics: topTopics,
    top_subtopics: topSubtopics,
    hot_issues: hotIssues,
  };
}

statsRoute.get("/overview", async (c) => {
  const overview = await computeOverview(c.env.DB, c.req.query());
  return c.json(overview);
});

statsRoute.get("/trend", async (c) => {
  const q = c.req.query();
  const { where, params } = baseFilters(q);
  const w = [...where];
  const p = [...params];
  addTopicFilter(w, p, q.topic);
  const whereSql = w.length ? `WHERE ${w.join(" AND ")}` : "";

  const rows = await c.env.DB
    .prepare(
      `SELECT substr(c.created_at, 1, 10) as d, a.sentiment, COUNT(*) as n
       FROM comments c JOIN analyses a ON a.comment_id = c.id
       ${whereSql}
       GROUP BY d, a.sentiment ORDER BY d`
    ).bind(...p).all<{ d: string; sentiment: string; n: number }>();

  return c.json(buildTrendSeries(rows.results, q));
});

statsRoute.get("/topic-ranking", async (c) => {
  const q = c.req.query();
  const { where, params } = baseFilters(q);
  const w = [...where, "a.topic_main IS NOT NULL"];
  addTopicFilter(w, params, q.topic);
  if (q.sentiment) { w.push("a.sentiment = ?"); params.push(q.sentiment); }
  if (q.urgency) { w.push("a.urgency = ?"); params.push(q.urgency); }
  const whereSql = `WHERE ${w.join(" AND ")}`;
  const lang = q.lang === "zh-CN" ? "zh-CN" : "vi";
  const limit = Math.max(1, Math.min(Number(q.limit) || 12, 50));

  const rows = await c.env.DB.prepare(
    `SELECT a.topic_main,
            COUNT(*) as count,
            SUM(CASE WHEN a.sentiment = 'negative' THEN 1 ELSE 0 END) as negative_count,
            SUM(CASE WHEN a.urgency IN ('medium','high') THEN 1 ELSE 0 END) as urgent_count
     FROM comments c
     JOIN analyses a ON a.comment_id = c.id
     ${whereSql}
     GROUP BY a.topic_main
     ORDER BY count DESC, negative_count DESC
     LIMIT ?`
  ).bind(...params, limit).all<{ topic_main: string; count: number; negative_count: number; urgent_count: number }>();

  const ranking = [];
  for (const row of rows.results) {
    const sampleRows = await c.env.DB.prepare(
      `SELECT c.id, c.message, t.message_translated, a.sentiment, a.urgency, a.summary, t.summary_translated
       FROM comments c
       JOIN analyses a ON a.comment_id = c.id
       LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
       ${whereSql} AND a.topic_main = ?
       ORDER BY CASE WHEN a.sentiment = 'negative' THEN 0 ELSE 1 END, c.created_at DESC
       LIMIT 3`
    ).bind(lang, ...params, row.topic_main).all<any>();

    ranking.push({
      topic: row.topic_main,
      label: topicLabel(row.topic_main, lang),
      count: row.count,
      negative_count: Number(row.negative_count || 0),
      urgent_count: Number(row.urgent_count || 0),
      sample_comments: sampleRows.results.map((r) => ({
        id: r.id,
        message: lang === "zh-CN" && r.message_translated ? r.message_translated : r.message,
        message_original: r.message,
        sentiment: r.sentiment,
        urgency: r.urgency,
        summary: lang === "zh-CN" && r.summary_translated ? r.summary_translated : r.summary,
      })),
    });
  }

  return c.json({ items: ranking });
});

statsRoute.get("/subtopic-ranking", async (c) => {
  const q = c.req.query();
  const lang = q.lang === "zh-CN" ? "zh-CN" : "vi";
  const limit = Math.max(1, Math.min(Number(q.limit) || 12, 50));
  const items = await computeSubtopicRanking(c.env.DB, q, limit);

  const withSamples = [];
  for (const item of items) {
    const { where, params } = baseFilters(q);
    const itemKeys = Array.isArray((item as any).keys) && (item as any).keys.length ? (item as any).keys : parseSubtopicKeys(item.key);
    const w = [...where, `st.key IN (${itemKeys.map(() => "?").join(",")})`];
    const p = [...params, ...itemKeys];
    addTopicFilter(w, p, q.topic);
    if (q.sentiment) { w.push("a.sentiment = ?"); p.push(q.sentiment); }
    if (q.urgency) { w.push("a.urgency = ?"); p.push(q.urgency); }
    const rows = await c.env.DB.prepare(
      `SELECT c.id, c.message, t.message_translated, a.sentiment, a.urgency, a.summary, t.summary_translated
       FROM comments c
       JOIN analyses a ON a.comment_id = c.id
       JOIN comment_subtopics cs ON cs.comment_id = c.id
       JOIN taxonomy_subtopics st ON st.id = cs.subtopic_id
       LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
       WHERE ${w.join(" AND ")}
       ORDER BY CASE WHEN a.sentiment = 'negative' THEN 0 ELSE 1 END, c.created_at DESC
       LIMIT 3`
    ).bind(lang, ...p).all<any>();
    withSamples.push({
      ...item,
      sample_comments: rows.results.map((r) => ({
        id: r.id,
        message: lang === "zh-CN" && r.message_translated ? r.message_translated : r.message,
        message_original: r.message,
        sentiment: r.sentiment,
        urgency: r.urgency,
        summary: lang === "zh-CN" && r.summary_translated ? r.summary_translated : r.summary,
      })),
    });
  }

  return c.json({ items: withSamples });
});

statsRoute.get("/subtopics", async (c) => {
  const q = c.req.query();
  const lang = q.lang === "zh-CN" ? "zh-CN" : "vi";
  const topicKeys = parseTopicKeys(q.topic);
  const where = ["st.status = 'active'"];
  const params: any[] = [];
  if (topicKeys.length) {
    where.push(`st.parent_topic IN (${topicKeys.map(() => "?").join(",")})`);
    params.push(...topicKeys);
  }
  const rows = await c.env.DB.prepare(
    `SELECT st.key, st.parent_topic, st.label_vi, st.label_zh_cn, st.evidence_count
     FROM taxonomy_subtopics st
     WHERE ${where.join(" AND ")}
     ORDER BY st.parent_topic, st.evidence_count DESC, st.label_vi`
  ).bind(...params).all<any>();

  return c.json({
    items: rows.results.map((row) => ({
      key: row.key,
      parent_topic: row.parent_topic,
      parent_label: topicLabel(row.parent_topic, lang),
      label: subtopicLabel(row, lang),
      label_vi: row.label_vi,
      label_zh_cn: row.label_zh_cn || null,
      evidence_count: Number(row.evidence_count || 0),
    })),
  });
});

statsRoute.get("/store", async (c) => {
  const q = c.req.query();
  const where = ["c.source_type = 'store'"];
  const params: any[] = [];
  if (q.from) { where.push("c.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("c.created_at <= ?"); params.push(q.to); }
  if (q.store) { where.push("c.store = ?"); params.push(q.store); }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const db = c.env.DB;

  const ratingRows = await db
    .prepare(`SELECT c.rating, COUNT(*) as n FROM comments c ${whereSql} GROUP BY c.rating`)
    .bind(...params).all<{ rating: number; n: number }>();
  const ratingDist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const r of ratingRows.results) if (r.rating) ratingDist[String(r.rating)] = r.n;

  const platformRows = await db
    .prepare(`SELECT c.store, COUNT(*) as n, AVG(c.rating) as avg_rating FROM comments c ${whereSql} GROUP BY c.store`)
    .bind(...params).all<{ store: string; n: number; avg_rating: number }>();
  const platforms = platformRows.results.map((r) => ({
    store: r.store || "unknown", count: r.n, avg_rating: Math.round((r.avg_rating || 0) * 100) / 100,
  }));

  return c.json({ rating_distribution: ratingDist, platforms, ...summarizeStoreBreakdown(ratingDist, platforms) });
});

/**
 * LLM token spend over a date range, grouped by model.
 *
 * `from`/`to` are inclusive Bangkok-local days. Only batches logged after token
 * capture shipped have figures, so an empty result for older dates means "not
 * recorded", not "nothing spent".
 */
statsRoute.get("/token-usage", async (c) => {
  const q = c.req.query();
  return c.json(await loadTokenUsageByRange(c.env, { from: q.from, to: q.to }));
});
