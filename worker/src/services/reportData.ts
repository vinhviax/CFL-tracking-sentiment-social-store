import { LEGACY_TOPIC_LABELS_VI, LEGACY_TOPIC_LABELS_ZH_CN, TOPIC_LABELS_VI, TOPIC_LABELS_ZH_CN } from "../taxonomy";
import type { Env } from "../types";
import { buildTrendSeries, computeOverview, computeSubtopicRanking } from "../routes/stats";
import { generateSummary, sampleBySentiment } from "./insights";
import { summarizeStoreBreakdown } from "./storeStats";
import type { FeedbackReportData, ReportComment, ReportLanguage, ReportPost, ReportInsight } from "./reportHtml";

export type ReportGroup = "store" | "facebook";

export interface BuildReportParams {
  group: ReportGroup;
  from?: string;
  to?: string;
  lang?: ReportLanguage;
  topic?: string;
  autoGenerateInsight?: boolean;
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

function normalizeLang(value?: string | null): ReportLanguage {
  return value === "zh-CN" ? "zh-CN" : "vi";
}

function topicLabel(topic?: string | null, lang: ReportLanguage = "vi") {
  if (!topic) return lang === "zh-CN" ? "未分类" : "Chưa phân loại";
  const labels = lang === "zh-CN" ? TOPIC_LABELS_ZH_CN : TOPIC_LABELS_VI;
  const legacyLabels = lang === "zh-CN" ? LEGACY_TOPIC_LABELS_ZH_CN : LEGACY_TOPIC_LABELS_VI;
  return labels[topic] || legacyLabels[topic] || topic;
}

function isActionableTopic(topic?: string | null) {
  return Boolean(topic) && topic !== "other";
}

function sourceLabel(sourceType: string, lang: ReportLanguage = "vi") {
  if (sourceType === "store") return "Store";
  if (sourceType === "fb_page") return lang === "zh-CN" ? "粉丝页" : "Fanpage";
  if (sourceType === "fb_group_csv") return "Group Fanpage";
  return sourceType || (lang === "zh-CN" ? "未知来源" : "Không rõ nguồn");
}

function buildBaseWhere(params: BuildReportParams, opts: { includeTopic?: boolean } = {}) {
  const where = [groupWhere(params.group)];
  const bind: any[] = [];
  addDateFilter(where, bind, "c.created_at", ">=", params.from);
  addDateFilter(where, bind, "c.created_at", "<=", params.to);
  if (opts.includeTopic && params.topic) {
    where.push("a.topic_main = ?");
    bind.push(params.topic);
  }
  return { where, bind };
}

async function loadTrend(db: D1Database, params: BuildReportParams) {
  const { where, bind } = buildBaseWhere(params, { includeTopic: true });
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
  const lang = normalizeLang(params.lang);
  const { where, bind } = buildBaseWhere(params, { includeTopic: true });
  const rows = await db.prepare(
    `SELECT a.topic_main,
            COUNT(*) as count,
            SUM(CASE WHEN a.sentiment = 'negative' THEN 1 ELSE 0 END) as negative_count,
            SUM(CASE WHEN a.sentiment = 'positive' THEN 1 ELSE 0 END) as positive_count,
            SUM(CASE WHEN a.urgency IN ('medium','high') THEN 1 ELSE 0 END) as urgent_count
     FROM comments c
     JOIN analyses a ON a.comment_id = c.id
     WHERE ${where.join(" AND ")} AND a.topic_main IS NOT NULL AND a.topic_main != 'other'
     GROUP BY a.topic_main
     ORDER BY count DESC, negative_count DESC
     LIMIT 10`
  ).bind(...bind).all<any>();

  const items = [];
  for (const row of rows.results) {
    const sampleRows = await db.prepare(
      `SELECT c.id, c.message, t.message_translated, a.sentiment, a.urgency, a.summary, t.summary_translated
       FROM comments c
       JOIN analyses a ON a.comment_id = c.id
       LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
       WHERE ${where.join(" AND ")} AND a.topic_main = ?
       ORDER BY CASE WHEN a.sentiment = 'negative' THEN 0 ELSE 1 END, c.created_at DESC
       LIMIT 3`
    ).bind(lang, ...bind, row.topic_main).all<any>();
    items.push({
      topic: row.topic_main,
      label: topicLabel(row.topic_main, lang),
      count: Number(row.count || 0),
      negative_count: Number(row.negative_count || 0),
      positive_count: Number(row.positive_count || 0),
      urgent_count: Number(row.urgent_count || 0),
      sample_comments: sampleRows.results.map((sample: any) => ({
        id: sample.id,
        message: lang === "zh-CN" && sample.message_translated ? sample.message_translated : sample.message,
        sentiment: sample.sentiment,
        urgency: sample.urgency,
        summary: lang === "zh-CN" && sample.summary_translated ? sample.summary_translated : sample.summary,
      })),
    });
  }
  return items;
}

async function loadComments(db: D1Database, params: BuildReportParams): Promise<ReportComment[]> {
  const lang = normalizeLang(params.lang);
  const { where, bind } = buildBaseWhere(params, { includeTopic: true });
  const rows = await db.prepare(
    `SELECT c.id, c.source_type, c.created_at, c.message, c.rating, c.store,
            t.message_translated, t.summary_translated,
            p.message as post_message,
            a.topic_main, a.sentiment, a.urgency, a.summary
     FROM comments c
     LEFT JOIN posts p ON p.id = c.post_id
     LEFT JOIN analyses a ON a.comment_id = c.id
     LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
     WHERE ${where.join(" AND ")}
     ORDER BY CASE WHEN a.sentiment = 'negative' THEN 0 ELSE 1 END,
              CASE WHEN a.urgency IN ('high','medium') THEN 0 ELSE 1 END,
              c.created_at DESC
     LIMIT 30`
  ).bind(lang, ...bind).all<any>();

  return rows.results.map((row: any) => ({
    id: row.id,
    source_type: row.source_type,
    created_at: row.created_at || null,
    message: lang === "zh-CN" && row.message_translated ? row.message_translated : row.message || "",
    rating: row.rating ?? null,
    store: row.store || null,
    post_message: row.post_message || null,
    topic_label: topicLabel(row.topic_main, lang),
    sentiment: row.sentiment || "neutral",
    urgency: row.urgency || "none",
    summary: lang === "zh-CN" && row.summary_translated ? row.summary_translated : row.summary || "",
  }));
}

async function loadChannels(db: D1Database, params: BuildReportParams) {
  const lang = normalizeLang(params.lang);
  const { where, bind } = buildBaseWhere(params, { includeTopic: true });
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
    label: sourceLabel(row.source_type, lang),
    total: Number(row.total || 0),
    positive: Number(row.positive || 0),
    neutral: Number(row.neutral || 0),
    negative: Number(row.negative || 0),
  }));
}

async function loadStoreBreakdown(db: D1Database, params: BuildReportParams) {
  if (params.group !== "store") return null;
  const { where, bind } = buildBaseWhere(params, { includeTopic: Boolean(params.topic) });
  const analysisJoin = params.topic ? "JOIN analyses a ON a.comment_id = c.id" : "";
  const ratingRows = await db.prepare(
    `SELECT c.rating, COUNT(*) as n FROM comments c ${analysisJoin} WHERE ${where.join(" AND ")} GROUP BY c.rating`
  ).bind(...bind).all<any>();
  const ratingDist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const row of ratingRows.results) if (row.rating) ratingDist[String(row.rating)] = Number(row.n || 0);

  const platformRows = await db.prepare(
    `SELECT c.store, COUNT(*) as n, AVG(c.rating) as avg_rating
     FROM comments c
     ${analysisJoin}
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
  const { where, bind } = buildBaseWhere(params, { includeTopic: true });
  const rows = await db.prepare(
    `SELECT p.id, p.source_type, p.published_at, p.message, p.permalink,
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
    permalink: row.permalink || null,
    comment_count: Number(row.comment_count || 0),
    negative_count: Number(row.negative_count || 0),
  }));
}

function buildHighlights(data: Pick<FeedbackReportData, "group" | "overview" | "channels" | "store_breakdown">) {
  const lang = normalizeLang((data as any).language);
  const highlights = [];
  const negative = data.overview.sentiment.negative || 0;
  highlights.push({
    title: lang === "zh-CN"
      ? (data.group === "store" ? "关注评分与负面商店评论" : "关注 Facebook 社群情绪")
      : (data.group === "store" ? "Theo dõi rating và review tiêu cực" : "Theo dõi sentiment cộng đồng Facebook"),
    detail: lang === "zh-CN"
      ? `${data.overview.negative_pct}% negative trên ${data.overview.analyzed} feedback đã phân tích.`
      : `${data.overview.negative_pct}% negative trên ${data.overview.analyzed} feedback đã phân tích.`,
    signal: negative > 0 ? "negative" : "neutral",
  });
  for (const issue of data.overview.hot_issues.filter((issue) => isActionableTopic(issue.topic)).slice(0, 3)) {
    highlights.push({
      title: lang === "zh-CN" ? `需要关注 ${issue.label}` : `${issue.label} cần theo dõi`,
      detail: lang === "zh-CN"
        ? `${issue.negative} 条负面评论，${issue.urgent} 条 medium/high urgency。`
        : `${issue.negative} comment negative, ${issue.urgent} comment medium/high urgency.`,
      signal: issue.urgent > 0 ? "negative" : "mixed",
    });
  }
  if (data.store_breakdown?.platforms?.length) {
    const weakest = [...data.store_breakdown.platforms].sort((a: any, b: any) => a.avg_rating - b.avg_rating)[0];
    highlights.push({
      title: lang === "zh-CN"
        ? `${weakest.store === "ios" ? "App Store" : weakest.store === "gp" ? "Google Play" : weakest.store} 是需要优先处理的平台`
        : `${weakest.store === "ios" ? "App Store" : weakest.store === "gp" ? "Google Play" : weakest.store} là điểm cần ưu tiên`,
      detail: lang === "zh-CN"
        ? `Avg rating ${weakest.avg_rating} trên ${weakest.count} review.`
        : `Avg rating ${weakest.avg_rating} trên ${weakest.count} review.`,
      signal: "negative",
    });
  } else if (data.channels.length > 1) {
    const weakest = [...data.channels].sort((a, b) => b.negative - a.negative)[0];
    highlights.push({
      title: lang === "zh-CN" ? `${weakest.label} 的负面信号最多` : `${weakest.label} có nhiều tín hiệu negative nhất`,
      detail: lang === "zh-CN"
        ? `${weakest.negative}/${weakest.total} 条评论为 negative。`
        : `${weakest.negative}/${weakest.total} comment negative trong khoảng chọn.`,
      signal: "negative",
    });
  }
  return highlights.slice(0, 5);
}

function sameDateFilter(saved: any, params: BuildReportParams) {
  const from = dateKey(params.from);
  const to = dateKey(params.to);
  const savedFrom = dateKey(saved?.from);
  const savedTo = dateKey(saved?.to);
  if (from && savedFrom !== from) return false;
  if (to && savedTo !== to) return false;
  return true;
}

async function loadLatestInsight(env: Env, params: BuildReportParams): Promise<ReportInsight | null> {
  const lang = normalizeLang(params.lang);
  const rows = await env.DB.prepare(
    `SELECT title, summary, filters, provider, model, created_at
     FROM saved_insights
     WHERE source_group = ? AND lang = ?
     ORDER BY created_at DESC
     LIMIT 30`
  ).bind(params.group, lang).all<any>();

  let fallback: any | null = null;
  for (const row of rows.results) {
    let filters: any = {};
    try {
      filters = JSON.parse(row.filters || "{}");
    } catch {
      filters = {};
    }
    if (!fallback) fallback = row;
    if (sameDateFilter(filters, params)) {
      return { title: row.title, summary: row.summary, provider: row.provider || null, model: row.model || null, created_at: row.created_at };
    }
  }
  return fallback
    ? { title: fallback.title, summary: fallback.summary, provider: fallback.provider || null, model: fallback.model || null, created_at: fallback.created_at }
    : null;
}

async function generateReportInsight(env: Env, params: BuildReportParams, overview: any): Promise<ReportInsight> {
  const lang = normalizeLang(params.lang);
  const filters = {
    group: params.group,
    from: params.from || "",
    to: params.to || "",
    topic: params.topic || "",
  };
  const samples = await sampleBySentiment(env, filters);
  const result = await generateSummary(env, overview, samples, undefined, lang);
  return {
    title: lang === "zh-CN"
      ? `${params.group === "store" ? "Store" : "Facebook"} Insight`
      : `${params.group === "store" ? "Store" : "Facebook"} Insight`,
    summary: result.summary,
    provider: result.provider,
    model: result.model,
    created_at: new Date().toISOString(),
  };
}

export async function buildReportData(env: Env, params: BuildReportParams): Promise<FeedbackReportData> {
  const lang = normalizeLang(params.lang);
  const q = { group: params.group, from: params.from || "", to: params.to || "", lang, topic: params.topic || "" };
  const overview = await computeOverview(env.DB, q);
  const channels = await loadChannels(env.DB, params);
  const storeBreakdown = await loadStoreBreakdown(env.DB, params);
  const topicFocus = params.topic ? { key: params.topic, label: topicLabel(params.topic, lang) } : null;
  const base = {
    group: params.group,
    language: lang,
    title: lang === "zh-CN"
      ? `${params.group === "store" ? "CFL 商店反馈报告" : "CFL Facebook 反馈报告"}${topicFocus ? ` - ${topicFocus.label}` : ""}`
      : `${params.group === "store" ? "CFL Store Feedback Report" : "CFL Facebook Feedback Report"}${topicFocus ? ` - ${topicFocus.label}` : ""}`,
    generated_at: new Date().toISOString(),
    range: { from: dateKey(params.from), to: dateKey(params.to) },
    topic_focus: topicFocus,
    overview,
    trend: await loadTrend(env.DB, params),
    topic_ranking: await loadTopicRanking(env.DB, params),
    subtopic_ranking: await computeSubtopicRanking(env.DB, q, 10),
    comments: await loadComments(env.DB, params),
    channels,
    store_breakdown: storeBreakdown,
    top_posts: await loadTopPosts(env.DB, params),
    llm_insight: params.autoGenerateInsight
      ? await generateReportInsight(env, { ...params, lang }, overview)
      : await loadLatestInsight(env, { ...params, lang }),
  };
  return {
    ...base,
    highlights: buildHighlights(base),
  };
}
