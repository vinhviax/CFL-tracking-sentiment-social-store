import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { SentimentBadge, UrgencyBadge } from "../components/Badges.jsx";
import useMeta from "../hooks/useMeta.js";
import {
  generateInsight,
  getInsightPrompt,
  getOverview,
  getStoreBreakdown,
  getSubtopicRanking,
  getTopicRanking,
  getTrend,
  listSavedInsights,
  listComments,
  listPosts,
  saveInsight,
  saveInsightPrompt,
} from "../api/client.js";

const PAGE_SIZE = 25;
const DEFAULT_FROM_DATE = "2026-06-29";

function getTodayDateInputValue(now = new Date()) {
  const localTime = now.getTime() - now.getTimezoneOffset() * 60_000;
  return new Date(localTime).toISOString().slice(0, 10);
}

function getDefaultFilters() {
  return {
    from: DEFAULT_FROM_DATE,
    to: getTodayDateInputValue(),
    q: "",
    topic: "",
    subtopic: "",
    sentiment: "",
    urgency: "",
  };
}

const UI = {
  vi: {
    title: "Feedback User",
    subtitle: "Theo dõi phản hồi từ Store, Fanpage và Group trong một workspace.",
    store: "Store",
    facebook: "Facebook",
    archive: "Lưu trữ",
    google: "Google Play",
    appstore: "App Store",
    fanpage: "Fanpage",
    group: "Group",
    from: "Từ ngày",
    to: "Đến ngày",
    language: "Ngôn ngữ",
    search: "Tìm comment",
    topic: "Chủ đề",
    subtopic: "Chủ đề con",
    topSubtopics: "Chủ đề con mới nổi",
    sentiment: "Sentiment",
    urgency: "Khẩn cấp",
    all: "Tất cả",
    total: "Tổng feedback",
    analyzed: "Đã phân tích",
    negativeRate: "Tỉ lệ tiêu cực",
    topTopics: "Bảng xếp hạng user quan tâm",
    hotIssues: "Vấn đề nổi cộm",
    trend: "Xu hướng sentiment",
    insight: "Insight and Summarize",
    createInsight: "Tạo Insight and Summarize",
    save: "Lưu",
    editPrompt: "Sửa prompt",
    savePrompt: "Lưu prompt",
    prompt: "Prompt Insight",
    savedArchive: "Tab lưu trữ",
    noInsight: "Chọn giai đoạn và bấm nút để tạo insight.",
    topNegative: "Top 10 vấn đề tiêu cực",
    topNeutral: "Top 10 vấn đề trung lập",
    topPositive: "Top 10 điểm tích cực",
    rating: "Số sao Store",
    dark: "Dark",
    light: "Light",
    comments: "Đọc từng comment",
    date: "Ngày",
    source: "Nguồn",
    platform: "Platform/Post",
    content: "Nội dung",
    confidence: "Tin cậy",
    detail: "Chi tiết comment",
    original: "Bản gốc",
    translated: "Tiếng Trung",
    close: "Đóng",
    noData: "Chưa có dữ liệu phù hợp bộ lọc.",
    loading: "Đang tải...",
  },
  "zh-CN": {
    title: "用户反馈",
    subtitle: "集中查看 Store、粉丝页和 Group 的玩家反馈。",
    store: "商店",
    facebook: "Facebook",
    archive: "归档",
    google: "Google Play",
    appstore: "App Store",
    fanpage: "粉丝页",
    group: "群组",
    from: "开始日期",
    to: "结束日期",
    language: "语言",
    search: "搜索评论",
    topic: "主题",
    subtopic: "子主题",
    topSubtopics: "新兴子主题",
    sentiment: "情绪",
    urgency: "紧急度",
    all: "全部",
    total: "反馈总数",
    analyzed: "已分析",
    negativeRate: "负面比例",
    topTopics: "用户关注排行",
    hotIssues: "重点问题",
    trend: "情绪趋势",
    insight: "Insight and Summarize",
    createInsight: "生成 Insight",
    save: "保存",
    editPrompt: "编辑 Prompt",
    savePrompt: "保存 Prompt",
    prompt: "Insight Prompt",
    savedArchive: "归档标签",
    noInsight: "选择时间范围后点击按钮生成 insight。",
    topNegative: "负面问题 Top 10",
    topNeutral: "中立问题 Top 10",
    topPositive: "正向反馈 Top 10",
    rating: "商店评分",
    dark: "深色",
    light: "浅色",
    comments: "逐条评论",
    date: "日期",
    source: "来源",
    platform: "平台/帖子",
    content: "内容",
    confidence: "置信度",
    detail: "评论详情",
    original: "原文",
    translated: "中文",
    close: "关闭",
    noData: "当前筛选条件下没有数据。",
    loading: "加载中...",
  },
};

function sourceLabel(row, lang) {
  if (row.source_type === "store") {
    if (row.store === "gp") return lang === "zh-CN" ? "Google Play" : "Google Play";
    if (row.store === "ios") return lang === "zh-CN" ? "App Store" : "App Store";
    return "Store";
  }
  if (row.source_type === "fb_page") return lang === "zh-CN" ? "粉丝页" : "Fanpage";
  if (row.source_type === "fb_group_csv") return lang === "zh-CN" ? "群组 CSV" : "Group CSV";
  return row.source_type;
}

function cleanParams(filters, group, subtab, page, metaLang) {
  const params = { group, lang: metaLang, page, page_size: PAGE_SIZE };
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.q) params.q = filters.q;
  if (filters.topic) params.topic = filters.topic;
  if (filters.subtopic) params.subtopic = filters.subtopic;
  if (filters.sentiment) params.sentiment = filters.sentiment;
  if (filters.urgency) params.urgency = filters.urgency;
  if (group === "store") params.store = subtab;
  if (group === "facebook") params.source = subtab;
  return params;
}

function renderInlineMarkdown(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

function InsightMarkdown({ text, emptyText }) {
  const source = String(text || "").trim();
  if (!source) return <p className="insight-placeholder">{emptyText}</p>;

  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`list-${blocks.length}`} className="insight-list">
        {items.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
      </ul>
    );
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      blocks.push(
        <h4 key={`heading-${blocks.length}`} className="insight-heading">
          {renderInlineMarkdown(heading[2])}
        </h4>
      );
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      listItems.push(bullet[1]);
      continue;
    }

    flushList();
    blocks.push(
      <p key={`paragraph-${blocks.length}`} className="insight-paragraph">
        {renderInlineMarkdown(line)}
      </p>
    );
  }

  flushList();
  return <div className="insight-markdown">{blocks}</div>;
}

export default function FeedbackWorkspace({ theme = "light", onThemeChange = () => {} }) {
  const { meta } = useMeta();
  const [lang, setLang] = useState("vi");
  const t = UI[lang];
  const [group, setGroup] = useState("store");
  const [subtab, setSubtab] = useState("gp");
  const [section, setSection] = useState("data");
  const [filters, setFilters] = useState(getDefaultFilters);
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [subtopicRanking, setSubtopicRanking] = useState([]);
  const [sentimentRankings, setSentimentRankings] = useState({ negative: [], neutral: [], positive: [] });
  const [storeBreakdown, setStoreBreakdown] = useState(null);
  const [comments, setComments] = useState(null);
  const [posts, setPosts] = useState([]);
  const [insight, setInsight] = useState(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightPrompt, setInsightPrompt] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [savedInsights, setSavedInsights] = useState([]);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);

  const tabs = group === "store"
    ? [{ value: "gp", label: t.google }, { value: "ios", label: t.appstore }]
    : [{ value: "fb_page", label: t.fanpage }, { value: "fb_group_csv", label: t.group }];

  useEffect(() => {
    setSubtab(group === "store" ? "gp" : "fb_page");
    setPage(1);
  }, [group]);

  const params = useMemo(() => cleanParams(filters, group, subtab, page, lang), [filters, group, subtab, page, lang]);
  const aggregateParams = useMemo(() => {
    const p = { ...params };
    delete p.page;
    delete p.page_size;
    return p;
  }, [params]);

  const topicLabels = lang === "zh-CN" ? meta?.topics_zh_cn || meta?.topics : meta?.topics;
  const sentimentLabels = lang === "zh-CN" ? meta?.sentiments_zh_cn || meta?.sentiments : meta?.sentiments;

  const loadData = useCallback(() => {
    setError(null);
    Promise.all([
      getOverview(aggregateParams),
      getTrend(aggregateParams),
      getTopicRanking({ ...aggregateParams, limit: 10 }),
      getTopicRanking({ ...aggregateParams, sentiment: "negative", limit: 10 }),
      getTopicRanking({ ...aggregateParams, sentiment: "neutral", limit: 10 }),
      getTopicRanking({ ...aggregateParams, sentiment: "positive", limit: 10 }),
      getSubtopicRanking({ ...aggregateParams, limit: 12 }),
      listComments(params),
      group === "facebook" ? listPosts({ source: subtab, limit: 50 }) : Promise.resolve([]),
      group === "store" ? getStoreBreakdown(aggregateParams) : Promise.resolve(null),
    ])
      .then(([ov, tr, rank, negRank, neuRank, posRank, subRank, cmts, postList, storeStats]) => {
        setOverview(ov);
        setTrend(tr);
        setRanking(rank.items || []);
        setSubtopicRanking(subRank.items || []);
        setSentimentRankings({
          negative: negRank.items || [],
          neutral: neuRank.items || [],
          positive: posRank.items || [],
        });
        setComments(cmts);
        setPosts(postList);
        setStoreBreakdown(storeStats);
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message));
  }, [aggregateParams, params, group, subtab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    getInsightPrompt().then((r) => setInsightPrompt(r.prompt || "")).catch(() => {});
    listSavedInsights({ limit: 30 }).then(setSavedInsights).catch(() => {});
  }, []);

  const setFilter = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
    setPage(1);
  };

  const totalPages = comments ? Math.max(1, Math.ceil(comments.total / PAGE_SIZE)) : 1;

  const createInsight = () => {
    setInsightBusy(true);
    setError(null);
    generateInsight({ filters: aggregateParams, prompt: insightPrompt })
      .then((result) => setInsight(result))
      .catch((e) => setError(e?.response?.data?.detail || e.message))
      .finally(() => setInsightBusy(false));
  };

  const persistInsight = () => {
    if (!insight?.summary) return;
    saveInsight({
      title: `${group === "store" ? t.store : t.facebook} ${filters.from || ""} - ${filters.to || ""}`.trim(),
      summary: insight.summary,
      filters: aggregateParams,
      lang,
      provider: insight.provider,
      model: insight.model,
    })
      .then(() => listSavedInsights({ limit: 30 }).then(setSavedInsights))
      .then(() => setSection("archive"))
      .catch((e) => setError(e?.response?.data?.detail || e.message));
  };

  const persistPrompt = () => {
    saveInsightPrompt({ prompt: insightPrompt })
      .then((r) => setInsightPrompt(r.prompt))
      .catch((e) => setError(e?.response?.data?.detail || e.message));
  };

  return (
    <>
      <div className="workspace-header">
        <div>
          <h2 className="page-title">{t.title}</h2>
          <p className="page-subtitle">{t.subtitle}</p>
        </div>
        <div className="header-actions">
          <div className="segmented">
            <button className={theme === "light" ? "active" : ""} onClick={() => onThemeChange("light")}>{t.light}</button>
            <button className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")}>{t.dark}</button>
          </div>
          <div className="segmented">
            <button className={lang === "vi" ? "active" : ""} onClick={() => setLang("vi")}>VI</button>
            <button className={lang === "zh-CN" ? "active" : ""} onClick={() => setLang("zh-CN")}>中文</button>
          </div>
        </div>
      </div>

      <div className="workspace-switcher">
        <button className={section === "data" && group === "store" ? "active" : ""} onClick={() => { setSection("data"); setGroup("store"); }}>{t.store}</button>
        <button className={section === "data" && group === "facebook" ? "active" : ""} onClick={() => { setSection("data"); setGroup("facebook"); }}>{t.facebook}</button>
        <button className={section === "archive" ? "active" : ""} onClick={() => setSection("archive")}>{t.archive}</button>
      </div>

      {section === "archive" ? (
        <div className="panel archive-panel">
          <h3>{t.savedArchive}</h3>
          {savedInsights.length === 0 ? <div className="empty-state">{t.noData}</div> : (
            <div className="archive-list">
              {savedInsights.map((item) => (
                <article key={item.id} className="archive-item">
                  <div>
                    <h4>{item.title}</h4>
                    <small>{new Date(item.created_at).toLocaleString("vi-VN")} · {item.provider || "unknown"}</small>
                  </div>
                  <InsightMarkdown text={item.summary} emptyText={t.noData} />
                </article>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>

      <div className="filters-bar workspace-filters">
        <label>{t.from}<input type="date" value={filters.from} onChange={setFilter("from")} /></label>
        <label>{t.to}<input type="date" value={filters.to} onChange={setFilter("to")} /></label>
        <label>{t.search}<input type="text" value={filters.q} onChange={setFilter("q")} placeholder="lag, hack, nạp..." /></label>
        <label>{t.topic}
          <select value={filters.topic} onChange={setFilter("topic")}>
            <option value="">{t.all}</option>
            {topicLabels && Object.entries(topicLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>{t.subtopic}
          <select value={filters.subtopic} onChange={setFilter("subtopic")}>
            <option value="">{t.all}</option>
            {subtopicRanking.map((item) => (
              <option key={item.key} value={item.key}>{item.parent_label} › {item.label}</option>
            ))}
          </select>
        </label>
        <label>{t.sentiment}
          <select value={filters.sentiment} onChange={setFilter("sentiment")}>
            <option value="">{t.all}</option>
            {sentimentLabels && Object.entries(sentimentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>{t.urgency}
          <select value={filters.urgency} onChange={setFilter("urgency")}>
            <option value="">{t.all}</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>

      <div className="tabs">
        {tabs.map((tab) => (
          <button key={tab.value} className={`tab ${subtab === tab.value ? "active" : ""}`} onClick={() => { setSubtab(tab.value); setPage(1); }}>
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!overview || !comments ? (
        <div className="empty-state">{t.loading}</div>
      ) : overview.total_comments === 0 ? (
        <div className="empty-state panel">{t.noData}</div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card"><div className="label">{t.total}</div><div className="value">{overview.total_comments.toLocaleString("vi-VN")}</div></div>
            <div className="kpi-card"><div className="label">{t.analyzed}</div><div className="value">{overview.analyzed.toLocaleString("vi-VN")}</div></div>
            <div className="kpi-card"><div className="label">{t.negativeRate}</div><div className="value negative-text">{overview.negative_pct}%</div></div>
            <div className="kpi-card"><div className="label">{t.hotIssues}</div><div className="value">{overview.hot_issues.length}</div></div>
          </div>

          <section className="insight-workbench">
            <div className="insight-toolbar">
              <div>
                <h3>{t.insight}</h3>
                <p>{t.noInsight}</p>
              </div>
              <div className="insight-actions">
                <button className="btn" onClick={createInsight} disabled={insightBusy}>
                  {insightBusy ? t.loading : t.createInsight}
                </button>
                <button className="btn btn-secondary" onClick={() => setPromptOpen((v) => !v)}>{t.editPrompt}</button>
                <button className="btn btn-secondary" onClick={persistInsight} disabled={!insight?.summary}>{t.save}</button>
              </div>
            </div>
            {promptOpen && (
              <div className="prompt-editor">
                <label>{t.prompt}</label>
                <textarea value={insightPrompt} onChange={(e) => setInsightPrompt(e.target.value)} rows={7} />
                <button className="btn btn-secondary" onClick={persistPrompt}>{t.savePrompt}</button>
              </div>
            )}
            <div className="insight-result">
              <InsightMarkdown text={insight?.summary} emptyText={t.noInsight} />
            </div>
          </section>

          {group === "store" && storeBreakdown && (
            <div className="panel rating-panel">
              <h3>{t.rating}</h3>
              <div className="rating-bars">
                {Object.entries(storeBreakdown.rating_distribution || {}).reverse().map(([star, count]) => {
                  const max = Math.max(...Object.values(storeBreakdown.rating_distribution || { 1: 1 }));
                  return (
                    <div className="rating-row" key={star}>
                      <span>{star} sao</span>
                      <div><i style={{ width: `${max ? (count / max) * 100 : 0}%` }} /></div>
                      <b>{count}</b>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="workspace-grid">
            <div className="panel">
              <h3>{t.trend}</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} />
                  <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                    labelStyle={{ color: "var(--text)" }}
                    itemStyle={{ color: "var(--text)" }}
                  />
                  <Legend />
                  <Bar dataKey="negative" stackId="s" fill="#e5484d" name={sentimentLabels?.negative || "Negative"} />
                  <Bar dataKey="neutral" stackId="s" fill="#8a94a6" name={sentimentLabels?.neutral || "Neutral"} />
                  <Bar dataKey="positive" stackId="s" fill="#2fb872" name={sentimentLabels?.positive || "Positive"} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel ranking-panel">
              <h3>{t.topTopics}</h3>
              {ranking.map((item) => (
                <button key={item.topic} className="ranking-row" onClick={() => setFilters((current) => ({ ...current, topic: item.topic }))}>
                  <span>{item.label}</span>
                  <b>{item.count}</b>
                  <small>{item.negative_count} neg / {item.urgent_count} urgent</small>
                </button>
              ))}
            </div>
          </div>

          <div className="panel ranking-panel subtopic-panel">
            <h3>{t.topSubtopics}</h3>
            {subtopicRanking.length === 0 ? (
              <div className="empty-state compact">{t.noData}</div>
            ) : subtopicRanking.map((item) => (
              <button
                key={item.key}
                className="ranking-row subtopic-row"
                onClick={() => setFilters((current) => ({ ...current, topic: item.parent_topic, subtopic: item.key }))}
              >
                <span>{item.label}</span>
                <b>{item.count}</b>
                <small>{item.parent_label} · {item.negative_count} neg / {item.urgent_count} urgent · {item.status}</small>
              </button>
            ))}
          </div>

          <div className="sentiment-ranking-grid">
            {[
              ["negative", t.topNegative],
              ["neutral", t.topNeutral],
              ["positive", t.topPositive],
            ].map(([key, title]) => (
              <div className="panel ranking-panel sentiment-card" key={key}>
                <h3>{title}</h3>
                {sentimentRankings[key].map((item) => (
                  <button key={item.topic} className="ranking-row" onClick={() => setFilters((current) => ({ ...current, topic: item.topic, sentiment: key }))}>
                    <span>{item.label}</span>
                    <b>{item.count}</b>
                    <small>{item.negative_count} neg / {item.urgent_count} urgent</small>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {group === "facebook" && posts.length > 0 && (
            <div className="panel post-strip">
              <h3>Post context</h3>
              <div className="post-list">
                {posts.slice(0, 6).map((post) => (
                  <button key={post.id} onClick={() => setFilters((current) => ({ ...current, q: "" }))}>
                    <b>{post.comment_count}</b>
                    <span>{(post.message || "(empty)").slice(0, 110)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="panel comments-panel">
            <div className="panel-header-row">
              <h3>{t.comments}</h3>
              <span>{comments.total.toLocaleString("vi-VN")} rows</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t.date}</th>
                    <th>{t.source}</th>
                    <th>{t.content}</th>
                    <th>{t.topic}</th>
                    <th>{t.subtopic}</th>
                    <th>{t.sentiment}</th>
                    <th>{t.urgency}</th>
                    <th>{t.confidence}</th>
                  </tr>
                </thead>
                <tbody>
                  {comments.items.map((row) => (
                    <tr key={row.id} onClick={() => setSelected(row)} className="clickable-row">
                      <td>{row.created_at ? new Date(row.created_at).toLocaleDateString("vi-VN") : "—"}</td>
                      <td>{sourceLabel(row, lang)}</td>
                      <td className="msg-preview">{row.message}</td>
                      <td>{topicLabels?.[row.analysis?.topic_main] || row.analysis?.topic_main || "—"}</td>
                      <td>
                        {row.analysis?.subtopics_dynamic?.length
                          ? row.analysis.subtopics_dynamic.map((s) => s.label).join(", ")
                          : "—"}
                      </td>
                      <td><SentimentBadge value={row.analysis?.sentiment} lang={lang} /></td>
                      <td><UrgencyBadge value={row.analysis?.urgency} lang={lang} /></td>
                      <td>{row.analysis?.confidence != null ? Math.round(row.analysis.confidence * 100) + "%" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span>{page}/{totalPages}</span>
              <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
      </>
      )}

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="comment-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header-row">
              <h3>{t.detail}</h3>
              <button className="btn btn-secondary" onClick={() => setSelected(null)}>{t.close}</button>
            </div>
            <p className="drawer-label">{t.content}</p>
            <p className="drawer-message">{selected.message}</p>
            <p className="drawer-label">{t.original}</p>
            <p className="drawer-message dim">{selected.message_original}</p>
            {selected.message_zh_cn && (
              <>
                <p className="drawer-label">{t.translated}</p>
                <p className="drawer-message dim">{selected.message_zh_cn}</p>
              </>
            )}
            <div className="drawer-badges">
              <SentimentBadge value={selected.analysis?.sentiment} lang={lang} />
              <UrgencyBadge value={selected.analysis?.urgency} lang={lang} />
              {selected.analysis?.topic_main && <span className="badge badge-neutral">{topicLabels?.[selected.analysis.topic_main] || selected.analysis.topic_main}</span>}
              {selected.analysis?.subtopics_dynamic?.map((subtopic) => (
                <span key={subtopic.key} className="badge badge-subtopic">{subtopic.label}</span>
              ))}
            </div>
            <p className="drawer-label">Summary</p>
            <p className="drawer-message">{selected.analysis?.summary || "—"}</p>
            <p className="drawer-label">Model</p>
            <p className="drawer-message dim">{selected.analysis?.provider || "—"} / {selected.analysis?.model || "—"}</p>
          </aside>
        </div>
      )}
    </>
  );
}
