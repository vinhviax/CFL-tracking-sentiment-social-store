import { LEGACY_TOPIC_LABELS_VI, TOPIC_LABELS_VI } from "../taxonomy";
import type { Env } from "../types";
import { buildTrendSeries, computeOverview, computeSubtopicRanking } from "../routes/stats";
import { summarizeStoreBreakdown } from "./storeStats";
import type { FeedbackReportData, ReportComment, ReportPost } from "./reportHtml";

export type ReportGroup = "store" | "facebook";

export interface BuildReportParams {
  group: ReportGroup;
  from?: string;
  to?: string;
}

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

function groupWhere(group: ReportGroup) {
  return group === "store" ? "c.source_type = 'store'" : "c.source_type IN ('fb_page','fb_group_csv')";
}

function topicLabel(topic?: string | null) {
  if (!topic) return "Chua phan loai";
  return TOPIC_LABELS_VI[topic] || LEGACY_TOPIC_LABELS_VI[topic] || topic;
}

function sourceLabel(sourceType: string) {
  if (sourceType === "store") return "Store";
  if (sourceType === "fb_page") return "Fanpage";
  if (sourceType === "fb_group_csv") return "Group CSV";
  return sourceType || "Khong ro nguon";
}

function buildBaseWhere(params: BuildReportParams) {
  const where = [groupWhere(params.group)];
  const bind: any[] = [];
  addDateFilter(where, bind, "c.created_at", ">=", params.from);
  addDateFilter(where, bind, "c.created_at", "<=", params.to);
  return { where, bind };
}

async function loadTrend(db: D1Database, params: BuildReportParams) {
  const { where, bind } = buildBaseWhere(params);
  const rows = await db.prepare(
    `SELECT substr(c.created_at, 1, 10) as d, a.sentiment, COUNT(*) as n
     FROM comments c
     JOIN analyses a ON a.comment_id = c.id
     WHERE ${where.join(" AND ")}
     GROUP BY d, a.sentiment
     ORDER BY d`
  ).bind(...bind).all<any>();
  return buildTrendSeries(rows.results, { from: params.from || "", to: params.to || "" });
}

async function loadTopicRanking(db: D1Database, params: BuildReportParams) {
  const { where, bind } = buildBaseWhere(params);
  const rows = await db.prepare(
    `SELECT a.topic_main,
            COUNT(*) as count,
            SUM(CASE WHEN a.sentiment = 'negative' THEN 1 ELSE 0 END) as negative_count,
            SUM(CASE WHEN a.urgency IN ('medium','high') THEN 1 ELSE 0 END) as urgent_count
     FROM comments c
     JOIN analyses a ON a.comment_id = c.id
     WHERE ${where.join(" AND ")} AND a.topic_main IS NOT NULL
     GROUP BY a.topic_main
     ORDER BY count DESC, negative_count DESC
     LIMIT 10`
  ).bind(...bind).all<any>();

  const items = [];
  for (const row of rows.results) {
    const sampleRows = await db.prepare(
      `SELECT c.id, c.message, a.sentiment, a.urgency, a.summary
       FROM comments c
       JOIN analyses a ON a.comment_id = c.id
       WHERE ${where.join(" AND ")} AND a.topic_main = ?
       ORDER BY CASE WHEN a.sentiment = 'negative' THEN 0 ELSE 1 END, c.created_at DESC
       LIMIT 3`
    ).bind(...bind, row.topic_main).all<any>();
    items.push({
      topic: row.topic_main,
      label: topicLabel(row.topic_main),
      count: Number(row.count || 0),
      negative_count: Number(row.negative_count || 0),
      urgent_count: Number(row.urgent_count || 0),
      sample_comments: sampleRows.results.map((sample: any) => ({
        id: sample.id,
        message: sample.message,
        sentiment: sample.sentiment,
        urgency: sample.urgency,
        summary: sample.summary,
      })),
    });
  }
  return items;
}

async function loadComments(db: D1Database, params: BuildReportParams): Promise<ReportComment[]> {
  const { where, bind } = buildBaseWhere(params);
  const rows = await db.prepare(
    `SELECT c.id, c.source_type, c.created_at, c.message, c.rating, c.store,
            p.message as post_message,
            a.topic_main, a.sentiment, a.urgency, a.summary
     FROM comments c
     LEFT JOIN posts p ON p.id = c.post_id
     LEFT JOIN analyses a ON a.comment_id = c.id
     WHERE ${where.join(" AND ")}
     ORDER BY CASE WHEN a.sentiment = 'negative' THEN 0 ELSE 1 END,
              CASE WHEN a.urgency IN ('high','medium') THEN 0 ELSE 1 END,
              c.created_at DESC
     LIMIT 30`
  ).bind(...bind).all<any>();

  return rows.results.map((row: any) => ({
    id: row.id,
    source_type: row.source_type,
    created_at: row.created_at || null,
    message: row.message || "",
    rating: row.rating ?? null,
    store: row.store || null,
    post_message: row.post_message || null,
    topic_label: topicLabel(row.topic_main),
    sentiment: row.sentiment || "neutral",
    urgency: row.urgency || "none",
    summary: row.summary || "",
  }));
}

async function loadChannels(db: D1Database, params: BuildReportParams) {
  const { where, bind } = buildBaseWhere(params);
  const rows = await db.prepare(
    `SELECT c.source_type,
            COUNT(*) as total,
            SUM(CASE WHEN a.sentiment = 'positive' THEN 1 ELSE 0 END) as positive,
            SUM(CASE WHEN a.sentiment = 'neutral' THEN 1 ELSE 0 END) as neutral,
            SUM(CASE WHEN a.sentiment = 'negative' THEN 1 ELSE 0 END) as negative
     FROM comments c
     LEFT JOIN analyses a ON a.comment_id = c.id
     WHERE ${where.join(" AND ")}
     GROUP BY c.source_type
     ORDER BY total DESC`
  ).bind(...bind).all<any>();
  return rows.results.map((row: any) => ({
    source_type: row.source_type,
    label: sourceLabel(row.source_type),
    total: Number(row.total || 0),
    positive: Number(row.positive || 0),
    neutral: Number(row.neutral || 0),
    negative: Number(row.negative || 0),
  }));
}

async function loadStoreBreakdown(db: D1Database, params: BuildReportParams) {
  if (params.group !== "store") return null;
  const { where, bind } = buildBaseWhere(params);
  const ratingRows = await db.prepare(
    `SELECT c.rating, COUNT(*) as n FROM comments c WHERE ${where.join(" AND ")} GROUP BY c.rating`
  ).bind(...bind).all<any>();
  const ratingDist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const row of ratingRows.results) if (row.rating) ratingDist[String(row.rating)] = Number(row.n || 0);

  const platformRows = await db.prepare(
    `SELECT c.store, COUNT(*) as n, AVG(c.rating) as avg_rating
     FROM comments c
     WHERE ${where.join(" AND ")}
     GROUP BY c.store`
  ).bind(...bind).all<any>();
  const platforms = platformRows.results.map((row: any) => ({
    store: row.store || "unknown",
    count: Number(row.n || 0),
    avg_rating: Math.round(Number(row.avg_rating || 0) * 100) / 100,
  }));

  return { rating_distribution: ratingDist, platforms, ...summarizeStoreBreakdown(ratingDist, platforms) };
}

async function loadTopPosts(db: D1Database, params: BuildReportParams): Promise<ReportPost[]> {
  if (params.group !== "facebook") return [];
  const { where, bind } = buildBaseWhere(params);
  const rows = await db.prepare(
    `SELECT p.id, p.source_type, p.published_at, p.message,
            COUNT(c.id) as comment_count,
            SUM(CASE WHEN a.sentiment = 'negative' THEN 1 ELSE 0 END) as negative_count
     FROM comments c
     JOIN posts p ON p.id = c.post_id
     LEFT JOIN analyses a ON a.comment_id = c.id
     WHERE ${where.join(" AND ")}
     GROUP BY p.id
     ORDER BY comment_count DESC, negative_count DESC
     LIMIT 10`
  ).bind(...bind).all<any>();
  return rows.results.map((row: any) => ({
    id: row.id,
    source_type: row.source_type,
    published_at: row.published_at || null,
    message: row.message || "",
    comment_count: Number(row.comment_count || 0),
    negative_count: Number(row.negative_count || 0),
  }));
}

function buildHighlights(data: Pick<FeedbackReportData, "group" | "overview" | "channels" | "store_breakdown">) {
  const highlights = [];
  const negative = data.overview.sentiment.negative || 0;
  highlights.push({
    title: data.group === "store" ? "Theo doi rating va review tieu cuc" : "Theo doi sentiment cong dong Facebook",
    detail: `${data.overview.negative_pct}% negative tren ${data.overview.analyzed} feedback da phan tich.`,
    signal: negative > 0 ? "negative" : "neutral",
  });
  for (const issue of data.overview.hot_issues.slice(0, 3)) {
    highlights.push({
      title: `${issue.label} can theo doi`,
      detail: `${issue.negative} comment negative, ${issue.urgent} comment medium/high urgency.`,
      signal: issue.urgent > 0 ? "negative" : "mixed",
    });
  }
  if (data.store_breakdown?.platforms?.length) {
    const weakest = [...data.store_breakdown.platforms].sort((a: any, b: any) => a.avg_rating - b.avg_rating)[0];
    highlights.push({
      title: `${weakest.store === "ios" ? "App Store" : weakest.store === "gp" ? "Google Play" : weakest.store} la diem can uu tien`,
      detail: `Avg rating ${weakest.avg_rating} tren ${weakest.count} review.`,
      signal: "negative",
    });
  } else if (data.channels.length > 1) {
    const weakest = [...data.channels].sort((a, b) => b.negative - a.negative)[0];
    highlights.push({
      title: `${weakest.label} co nhieu tin hieu negative nhat`,
      detail: `${weakest.negative}/${weakest.total} comment negative trong khoang chon.`,
      signal: "negative",
    });
  }
  return highlights.slice(0, 5);
}

export async function buildReportData(env: Env, params: BuildReportParams): Promise<FeedbackReportData> {
  const q = { group: params.group, from: params.from || "", to: params.to || "" };
  const overview = await computeOverview(env.DB, q);
  const channels = await loadChannels(env.DB, params);
  const storeBreakdown = await loadStoreBreakdown(env.DB, params);
  const base = {
    group: params.group,
    title: params.group === "store" ? "CFL Store Feedback Report" : "CFL Facebook Feedback Report",
    generated_at: new Date().toISOString(),
    range: { from: dateKey(params.from), to: dateKey(params.to) },
    overview,
    trend: await loadTrend(env.DB, params),
    topic_ranking: await loadTopicRanking(env.DB, params),
    subtopic_ranking: await computeSubtopicRanking(env.DB, q, 10),
    comments: await loadComments(env.DB, params),
    channels,
    store_breakdown: storeBreakdown,
    top_posts: await loadTopPosts(env.DB, params),
  };
  return {
    ...base,
    highlights: buildHighlights(base),
  };
}
