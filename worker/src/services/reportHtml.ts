export type ReportLanguage = "vi" | "zh-CN";

export interface FeedbackReportData {
  group: "store" | "facebook";
  language?: ReportLanguage;
  title: string;
  generated_at: string;
  range: { from: string | null; to: string | null };
  topic_focus?: { key?: string; keys?: string[]; label: string } | null;
  overview: {
    total_comments: number;
    analyzed: number;
    sentiment: Record<string, number>;
    negative_pct: number;
    top_topics: Array<{ topic: string; label: string; count: number }>;
    top_subtopics: Array<any>;
    hot_issues: Array<{ topic: string; label: string; negative: number; urgent: number }>;
  };
  trend: Array<{ date: string; positive: number; neutral: number; negative: number }>;
  topic_ranking: Array<{
    topic: string;
    label: string;
    count: number;
    negative_count: number;
    positive_count?: number;
    urgent_count: number;
    sample_comments: Array<{ id: number; message: string; sentiment: string; urgency: string; summary: string }>;
  }>;
  subtopic_ranking: Array<any>;
  comments: ReportComment[];
  channels: Array<{ source_type: string; label: string; total: number; positive: number; neutral: number; negative: number }>;
  store_breakdown: any | null;
  top_posts: ReportPost[];
  highlights: Array<{ title: string; detail: string; signal: string }>;
  llm_insight?: ReportInsight | null;
}

export interface ReportInsight {
  title: string;
  summary: string;
  provider: string | null;
  model: string | null;
  created_at: string;
}

export interface ReportComment {
  id: number;
  source_type: string;
  created_at: string | null;
  message: string;
  rating: number | null;
  store: string | null;
  post_message: string | null;
  topic_label: string;
  sentiment: string;
  urgency: string;
  summary: string;
}

export interface ReportPost {
  id: number;
  source_type: string;
  published_at: string | null;
  message: string;
  permalink?: string | null;
  comment_count: number;
  negative_count: number;
}

const NON_ACTIONABLE_TOPICS = new Set(["other"]);

function isActionableTopic(topic?: string | null) {
  return Boolean(topic) && !NON_ACTIONABLE_TOPICS.has(String(topic));
}

function actionableTopTopics(data: FeedbackReportData) {
  return data.overview.top_topics.filter((row) => isActionableTopic(row.topic));
}

function actionableHotIssues(data: FeedbackReportData) {
  return data.overview.hot_issues.filter((row) => isActionableTopic(row.topic));
}

function actionableTopicRanking(data: FeedbackReportData) {
  return data.topic_ranking.filter((row) => isActionableTopic(row.topic));
}

function actionableIssueDetails(data: FeedbackReportData) {
  return (data.subtopic_ranking || [])
    .filter((row) => isActionableTopic(row.parent_topic) && !isOtherText(row.label))
    .sort((a, b) =>
      Number(b.urgent_count || 0) - Number(a.urgent_count || 0)
      || Number(b.negative_count || 0) - Number(a.negative_count || 0)
      || Number(b.count || 0) - Number(a.count || 0)
    );
}

function topicPositiveCount(row: { count: number; negative_count?: number; positive_count?: number }) {
  if (typeof row.positive_count === "number") return row.positive_count;
  const negativeCount = typeof row.negative_count === "number" ? row.negative_count : 0;
  return Math.max(0, row.count - negativeCount);
}

function topNegativeTopic(data: FeedbackReportData) {
  const ranked = [...actionableTopicRanking(data)]
    .sort((a, b) => b.negative_count - a.negative_count || b.urgent_count - a.urgent_count || b.count - a.count);
  if (ranked[0]?.negative_count) return ranked[0];
  const hot = [...actionableHotIssues(data)].sort((a, b) => b.negative - a.negative || b.urgent - a.urgent)[0];
  if (hot) {
    return { topic: hot.topic, label: hot.label, count: hot.negative, negative_count: hot.negative, urgent_count: hot.urgent, sample_comments: [] };
  }
  return actionableTopicRanking(data)[0] || null;
}

function topPositiveTopic(data: FeedbackReportData) {
  const ranked = [...actionableTopicRanking(data)]
    .filter((row) => topicPositiveCount(row) > 0)
    .sort((a, b) => topicPositiveCount(b) - topicPositiveCount(a) || b.count - a.count);
  const positive = ranked[0];
  if (positive) return positive;
  return actionableTopTopics(data).find((row) => row.topic === "positive_feedback") || null;
}

function isOtherText(text?: string) {
  return /Khác\/Không đủ ngữ cảnh|其他\/上下文不足/.test(String(text || ""));
}

function actionableHighlights(data: FeedbackReportData) {
  return data.highlights.filter((row) => !isOtherText(row.title) && !isOtherText(row.detail));
}

const COPY = {
  vi: {
    docTitle: "Crossfire Legends Feedback Intelligence",
    rangeAll: "Tất cả dữ liệu",
    rangeFrom: "Từ",
    rangeTo: "Đến",
    generated: "Tạo lúc",
    subtitle: "Report tổng hợp KPI, sentiment, chủ đề nổi bật, vấn đề cần ưu tiên, bằng chứng comment và khuyến nghị vận hành.",
    totalFeedback: "Tổng feedback",
    analyzed: "đã phân tích",
    negativeRate: "Tỉ lệ tiêu cực",
    topTopic: "Chủ đề nổi bật",
    topNegativeTopic: "Top vấn đề tiêu cực",
    topPositiveTopic: "Top điểm tích cực",
    positive: "Tích cực",
    methodology: "Bộ lọc và nguyên tắc đọc report",
    methodologyDesc: "Phần này minh bạch cách report được tạo trước khi đọc số liệu.",
    source: "Nguồn",
    dateRange: "Khoảng ngày",
    language: "Ngôn ngữ",
    topicFocus: "Chủ đề report",
    promptRule: "Cách tạo insight",
    promptRuleText: "Khi export HTML, hệ thống tự tổng hợp Insight and Summarize theo đúng nguồn, khoảng ngày và ngôn ngữ của từng tab report.",
    hardRules: "Rule cứng",
    hardRulesText: "Chỉ dùng dữ liệu đã ingest và phân tích trong DB; xếp ưu tiên theo urgent, negative rồi volume; luôn kèm bằng chứng comment; không tự bịa vấn đề ngoài dữ liệu.",
    filterRule: "Bộ lọc",
    filterRuleText: "Nguồn và khoảng ngày được áp dụng theo created_at của comment. Facebook gồm Fanpage và Group CSV; Store gồm Google Play và App Store.",
    sentiment: "Tổng quan sentiment",
    negative: "Tiêu cực",
    neutral: "Trung lập",
    storePlatform: "Store platform và rating",
    channelBreakdown: "Phân bổ kênh",
    reviews: "review",
    issuePriority: "Bảng ưu tiên vấn đề cần quan tâm",
    issue: "Vấn đề",
    total: "Tổng",
    urgent: "Khẩn cấp",
    sample: "Comment mẫu",
    noIssue: "Chưa có vấn đề nổi bật.",
    topPostContext: "Bối cảnh post nổi bật",
    date: "Ngày",
    post: "Post",
    comments: "Comments",
    recommendations: "Key highlights và khuyến nghị vận hành",
    llmInsight: "Insight and Summarize",
    noLlmInsight: "Không tạo được Insight and Summarize cho tab này. Vui lòng kiểm tra cấu hình hệ thống rồi xuất lại.",
    evidence: "Bằng chứng comment",
    rating: "Rating",
    topic: "Chủ đề",
    contextSummary: "Bối cảnh/Summary",
    lessons: "Bài học rút ra",
    nextSteps: "Next step đề xuất",
    footer: "CFL Feedback Report - Internal liveops use - Data source: Store/Facebook comments đã ingest và phân tích.",
    noData: "Không có dữ liệu phù hợp.",
    lessonsBullets: (data: FeedbackReportData) => {
      const top = topNegativeTopic(data)?.label || topPositiveTopic(data)?.label || "vấn đề chính";
      return [
        `Người chơi đang tập trung nhiều nhất vào ${top}; đây là tín hiệu cần đọc theo volume và sắc thái, không chỉ nhìn một vài comment lẻ.`,
        `${data.overview.negative_pct}% feedback đã phân tích là tiêu cực, nên các vấn đề có urgent cao cần được ưu tiên hơn các chủ đề chỉ có tương tác lớn.`,
        data.group === "facebook"
          ? "Với Facebook, cần đọc comment cùng bối cảnh post vì nhiều phản hồi ngắn chỉ có nghĩa khi gắn với bài đăng gốc."
          : "Với Store, rating 1-2 sao là tín hiệu ảnh hưởng trực tiếp đến perception và cần được đối chiếu theo platform.",
      ];
    },
    nextStepBullets: (data: FeedbackReportData) => {
      const hot = actionableHotIssues(data).slice(0, 3).map((x) => x.label).join(", ");
      return [
        hot ? `Rà soát ngay nhóm vấn đề: ${hot}.` : "Tiếp tục theo dõi thêm dữ liệu để xác định nhóm vấn đề đủ lớn.",
        "Đọc các comment evidence trong report trước khi chốt action để tránh xử lý lệch ngữ cảnh.",
        "Sau khi xử lý, chạy lại ingest và report cùng khoảng ngày để đo thay đổi sentiment/rating.",
      ];
    },
  },
  "zh-CN": {
    docTitle: "Crossfire Legends Feedback Intelligence",
    rangeAll: "全部数据",
    rangeFrom: "从",
    rangeTo: "到",
    generated: "生成时间",
    subtitle: "报告汇总 KPI、情绪、重点主题、优先问题、评论证据和运营建议。",
    totalFeedback: "反馈总量",
    analyzed: "已分析",
    negativeRate: "负面比例",
    topTopic: "主要主题",
    topNegativeTopic: "Top 负面问题",
    topPositiveTopic: "Top 正向亮点",
    positive: "正向",
    methodology: "筛选条件与报告规则",
    methodologyDesc: "先说明报告生成口径，再阅读数据。",
    source: "来源",
    dateRange: "日期范围",
    language: "语言",
    topicFocus: "报告主题",
    promptRule: "Insight 生成方式",
    promptRuleText: "导出 HTML 时会按每个报告 tab 的来源、日期和语言自动生成 Insight and Summarize。",
    hardRules: "硬规则",
    hardRulesText: "只使用数据库中已导入和已分析的数据；按 urgent、negative、volume 排优先级；必须附评论证据；不编造数据外的问题。",
    filterRule: "筛选规则",
    filterRuleText: "来源和日期按评论 created_at 筛选。Facebook 包含 Fanpage 与 Group CSV；Store 包含 Google Play 与 App Store。",
    sentiment: "情绪概览",
    negative: "负面",
    neutral: "中立",
    storePlatform: "商店平台与评分",
    channelBreakdown: "渠道分布",
    reviews: "条评论",
    issuePriority: "重点问题优先级排行",
    issue: "问题",
    total: "总量",
    urgent: "紧急",
    sample: "样例评论",
    noIssue: "暂无重点问题。",
    topPostContext: "重点帖子背景",
    date: "日期",
    post: "帖子",
    comments: "评论数",
    recommendations: "关键发现与运营建议",
    llmInsight: "Insight and Summarize",
    noLlmInsight: "此 tab 暂未生成 Insight and Summarize。请检查系统配置后重新导出。",
    evidence: "评论证据",
    rating: "评分",
    topic: "主题",
    contextSummary: "背景/Summary",
    lessons: "经验总结",
    nextSteps: "建议下一步",
    footer: "CFL Feedback Report - Internal liveops use - Data source: Store/Facebook comments already ingested and analyzed.",
    noData: "没有符合条件的数据。",
    lessonsBullets: (data: FeedbackReportData) => {
      const top = topNegativeTopic(data)?.label || topPositiveTopic(data)?.label || "核心问题";
      return [
        `玩家讨论最集中的是 ${top}；需要结合量级和情绪一起判断，而不是只看少量评论。`,
        `${data.overview.negative_pct}% 已分析反馈为负面，urgent 高的问题应优先于单纯互动量高的主题。`,
        data.group === "facebook"
          ? "Facebook 评论必须结合原帖背景阅读，因为很多短评论离开帖子后语义不完整。"
          : "Store 侧 1-2 星评分会直接影响外部感知，需要按平台交叉验证。",
      ];
    },
    nextStepBullets: (data: FeedbackReportData) => {
      const hot = actionableHotIssues(data).slice(0, 3).map((x) => x.label).join(", ");
      return [
        hot ? `优先复盘这些问题：${hot}。` : "继续积累数据，等待问题规模足够清晰后再定优先级。",
        "先阅读 report 中的评论证据，再决定具体运营动作，避免脱离上下文。",
        "处理后用同一日期范围重新 ingest 并导出 report，对比 sentiment/rating 变化。",
      ];
    },
  },
} satisfies Record<ReportLanguage, any>;

function lang(data: FeedbackReportData): ReportLanguage {
  return data.language === "zh-CN" ? "zh-CN" : "vi";
}

function t(data: FeedbackReportData) {
  return COPY[lang(data)];
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pct(part: number, total: number) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function fmt(value: number | null | undefined, language: ReportLanguage = "vi") {
  return Number(value || 0).toLocaleString(language === "zh-CN" ? "zh-CN" : "vi-VN");
}

function dateOnly(value?: string | null) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function rangeText(data: FeedbackReportData) {
  const copy = t(data);
  if (data.range.from && data.range.to) return `${data.range.from} - ${data.range.to}`;
  if (data.range.from) return `${copy.rangeFrom} ${data.range.from}`;
  if (data.range.to) return `${copy.rangeTo} ${data.range.to}`;
  return copy.rangeAll;
}

function sourceLabel(sourceType: string, language: ReportLanguage) {
  if (sourceType === "fb_page") return language === "zh-CN" ? "粉丝页" : "Fanpage";
  if (sourceType === "fb_group_csv") return "Group Fanpage";
  if (sourceType === "store") return "Store";
  return sourceType || (language === "zh-CN" ? "未知" : "Không rõ");
}

function channelLabel(sourceType: string, label: string | null | undefined, language: ReportLanguage) {
  if (sourceType === "fb_group_csv") return sourceLabel(sourceType, language);
  return label || sourceLabel(sourceType, language);
}

function sentimentClass(value: string) {
  if (value === "negative") return "neg";
  if (value === "positive") return "pos";
  return "neu";
}

function sentimentLabel(value: string, data: FeedbackReportData) {
  const copy = t(data);
  if (value === "negative") return copy.negative;
  if (value === "positive") return copy.positive;
  return copy.neutral;
}

function bar(label: string, value: number, total: number, cls = "", language: ReportLanguage = "vi") {
  const width = Math.min(100, Math.max(3, pct(value, total)));
  return `<div class="bar-row">
    <div class="bar-label">${esc(label)}</div>
    <div class="bar-track"><div class="bar-fill ${cls}" style="width:${width}%"></div></div>
    <div class="bar-num">${fmt(value, language)}</div>
  </div>`;
}

function renderMarkdownLite(text: string) {
  const blocks: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${esc(item).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(`<h3>${esc(heading[1])}</h3>`);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    blocks.push(`<p>${esc(line).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</p>`);
  }
  flush();
  return blocks.join("");
}

function publicInsightTitle(title?: string | null) {
  const cleaned = String(title || "")
    .replace(/\bLLM\b/gi, "")
    .replace(/\bAI\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Insight and Summarize";
}

function compactPostText(text?: string | null) {
  const clean = String(text || "").trim();
  if (!clean) return "Mở bài viết";
  return clean.length > 260 ? `${clean.slice(0, 260)}...` : clean;
}

function renderPostText(post: ReportPost) {
  const text = compactPostText(post.message);
  if (!post.permalink) return esc(text);
  return `<a class="post-link" href="${esc(post.permalink)}" target="_blank" rel="noreferrer">${esc(text)}</a>`;
}

function renderMethodology(data: FeedbackReportData, sectionNo: string) {
  const copy = t(data);
  const language = lang(data);
  const source = data.group === "store"
    ? "Store: Google Play, App Store"
    : "Facebook: Fanpage, Group CSV";
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.methodology)}</h2></div>
    <p class="sec-desc">${esc(copy.methodologyDesc)}</p>
    <div class="grid three">
      <div class="panel"><h3>${esc(copy.source)}</h3><p>${esc(source)}</p></div>
      <div class="panel"><h3>${esc(copy.dateRange)}</h3><p>${esc(rangeText(data))}</p></div>
      <div class="panel"><h3>${esc(copy.language)}</h3><p>${language === "zh-CN" ? "中文" : "Tiếng Việt"}</p></div>
    </div>
    <div class="rule-list">
      <div><strong>${esc(copy.promptRule)}</strong><p>${esc(copy.promptRuleText)}</p></div>
      <div><strong>${esc(copy.hardRules)}</strong><p>${esc(copy.hardRulesText)}</p></div>
      <div><strong>${esc(copy.filterRule)}</strong><p>${esc(copy.filterRuleText)}</p></div>
    </div>
  </section>`;
}

function renderSentiment(data: FeedbackReportData, sectionNo: string) {
  const copy = t(data);
  const language = lang(data);
  const s = data.overview.sentiment || {};
  const total = Math.max(1, data.overview.analyzed || 0);
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.sentiment)}</h2></div>
    <div class="grid three">
      <div class="metric neg"><small>${esc(copy.negative)}</small><strong>${fmt(s.negative, language)}</strong><em>${pct(s.negative || 0, total)}%</em></div>
      <div class="metric neu"><small>${esc(copy.neutral)}</small><strong>${fmt(s.neutral, language)}</strong><em>${pct(s.neutral || 0, total)}%</em></div>
      <div class="metric pos"><small>${esc(copy.positive)}</small><strong>${fmt(s.positive, language)}</strong><em>${pct(s.positive || 0, total)}%</em></div>
    </div>
    <div class="chart-block">
      ${bar(copy.negative, s.negative || 0, total, "neg", language)}
      ${bar(copy.neutral, s.neutral || 0, total, "neu", language)}
      ${bar(copy.positive, s.positive || 0, total, "pos", language)}
    </div>
  </section>`;
}

function renderChannels(data: FeedbackReportData, sectionNo: string) {
  const copy = t(data);
  const language = lang(data);
  if (data.group === "store" && data.store_breakdown) {
    const platforms = data.store_breakdown.platforms || [];
    const rating = data.store_breakdown.rating_distribution || {};
    const ratingTotal = Object.values(rating).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
    return `<section>
      <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.storePlatform)}</h2></div>
      <div class="grid two">
        ${platforms.map((p: any) => `<div class="panel">
          <h3>${esc(p.store === "gp" ? "Google Play" : p.store === "ios" ? "App Store" : p.store)}</h3>
          <p class="big">${esc(p.avg_rating)}</p>
          <p>${fmt(p.count, language)} ${esc(copy.reviews)}</p>
        </div>`).join("") || `<div class="empty">${esc(copy.noData)}</div>`}
      </div>
      <div class="chart-block">
        ${["1", "2", "3", "4", "5"].map((star) => bar(`${star} sao`, Number(rating[star] || 0), ratingTotal, Number(star) <= 2 ? "neg" : Number(star) >= 4 ? "pos" : "neu", language)).join("")}
      </div>
    </section>`;
  }

  const total = data.channels.reduce((sum, row) => sum + row.total, 0);
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.channelBreakdown)}</h2></div>
      <div class="grid two">
        ${data.channels.map((row) => `<div class="panel">
        <h3>${esc(channelLabel(row.source_type, row.label, language))}</h3>
        <p class="big">${fmt(row.total, language)}</p>
        <p><span class="pill neg">${fmt(row.negative, language)} ${esc(copy.negative)}</span> <span class="pill pos">${fmt(row.positive, language)} ${esc(copy.positive)}</span></p>
      </div>`).join("") || `<div class="empty">${esc(copy.noData)}</div>`}
    </div>
    <div class="chart-block">${data.channels.map((row) => bar(channelLabel(row.source_type, row.label, language), row.total, total, row.source_type === "fb_page" ? "pos" : "neu", language)).join("")}</div>
  </section>`;
}

function renderIssuePriority(data: FeedbackReportData, sectionNo: string) {
  const copy = t(data);
  const language = lang(data);
  const rows = [...actionableTopicRanking(data)]
    .sort((a, b) => b.urgent_count - a.urgent_count || b.negative_count - a.negative_count || b.count - a.count)
    .slice(0, 10);
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.issuePriority)}</h2></div>
    <table>
      <thead><tr><th>#</th><th>${esc(copy.issue)}</th><th>${esc(copy.total)}</th><th>${esc(copy.negative)}</th><th>${esc(copy.urgent)}</th><th>${esc(copy.sample)}</th></tr></thead>
      <tbody>
        ${rows.map((row, idx) => `<tr>
          <td>${idx + 1}</td>
          <td><strong>${esc(row.label)}</strong></td>
          <td>${fmt(row.count, language)}</td>
          <td>${fmt(row.negative_count, language)}</td>
          <td>${fmt(row.urgent_count, language)}</td>
          <td>${row.sample_comments.slice(0, 2).map((sample) => `<p class="sample">${esc(sample.message)}<br><small>${esc(sample.summary || "")}</small></p>`).join("")}</td>
        </tr>`).join("") || `<tr><td colspan="6">${esc(copy.noIssue)}</td></tr>`}
      </tbody>
    </table>
  </section>`;
}

function renderIssueDetail(data: FeedbackReportData, sectionNo: string) {
  const language = lang(data);
  const rows = actionableIssueDetails(data).slice(0, 12);
  if (!rows.length) return "";
  const title = language === "zh-CN" ? "玩家提到的具体问题" : "Chi tiết vấn đề user nhắc tới";
  const parentTopic = language === "zh-CN" ? "主题" : "Chủ đề";
  const specificIssue = language === "zh-CN" ? "具体问题" : "Vấn đề cụ thể";
  const total = language === "zh-CN" ? "总量" : "Tổng";
  const negative = language === "zh-CN" ? "负面" : "Tiêu cực";
  const urgent = language === "zh-CN" ? "紧急" : "Khẩn cấp";
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(title)}</h2></div>
    <table class="issue-detail-table">
      <thead><tr><th>${esc(parentTopic)}</th><th>${esc(specificIssue)}</th><th>${esc(total)}</th><th>${esc(negative)}</th><th>${esc(urgent)}</th></tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>
          <td>${esc(row.parent_label || row.parent_topic || "")}</td>
          <td><strong>${esc(row.label)}</strong></td>
          <td>${fmt(Number(row.count || 0), language)}</td>
          <td>${fmt(Number(row.negative_count || 0), language)}</td>
          <td>${fmt(Number(row.urgent_count || 0), language)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </section>`;
}

function renderPosts(data: FeedbackReportData, sectionNo: string) {
  if (data.group !== "facebook") return "";
  const copy = t(data);
  const language = lang(data);
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.topPostContext)}</h2></div>
    <table>
      <thead><tr><th>${esc(copy.source)}</th><th>${esc(copy.date)}</th><th>${esc(copy.post)}</th><th>${esc(copy.comments)}</th><th>${esc(copy.negative)}</th></tr></thead>
      <tbody>
        ${data.top_posts.map((post) => `<tr>
          <td>${esc(sourceLabel(post.source_type, language))}</td>
          <td>${esc(dateOnly(post.published_at))}</td>
          <td>${renderPostText(post)}</td>
          <td>${fmt(post.comment_count, language)}</td>
          <td>${fmt(post.negative_count, language)}</td>
        </tr>`).join("") || `<tr><td colspan="5">${esc(copy.noData)}</td></tr>`}
      </tbody>
    </table>
  </section>`;
}

function renderHighlights(data: FeedbackReportData, sectionNo: string) {
  const copy = t(data);
  const highlights = actionableHighlights(data);
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.recommendations)}</h2></div>
    <div class="highlight-list">
      ${highlights.map((h, idx) => `<div class="highlight ${sentimentClass(h.signal)}">
        <strong>${idx + 1}. ${esc(h.title)}</strong>
        <p>${esc(h.detail)}</p>
      </div>`).join("") || `<div class="empty">${esc(copy.noData)}</div>`}
    </div>
  </section>`;
}

function renderLlmInsight(data: FeedbackReportData, sectionNo: string) {
  const copy = t(data);
  const insight = data.llm_insight;
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.llmInsight)}</h2></div>
    ${insight?.summary ? `<div class="insight-box">
      <p class="insight-meta">${esc(publicInsightTitle(insight.title))} - ${esc(insight.created_at)}</p>
      ${renderMarkdownLite(insight.summary)}
    </div>` : `<div class="empty">${esc(copy.noLlmInsight)}</div>`}
  </section>`;
}

function renderEvidence(data: FeedbackReportData, sectionNo: string) {
  const copy = t(data);
  const language = lang(data);
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.evidence)}</h2></div>
    <table>
      <thead><tr><th>${esc(copy.date)}</th><th>${esc(copy.source)}</th><th>${esc(copy.rating)}</th><th>${esc(copy.topic)}</th><th>Sentiment</th><th>Comment</th></tr></thead>
      <tbody>
        ${data.comments.map((c) => `<tr>
          <td>${esc(dateOnly(c.created_at))}</td>
          <td>${esc(sourceLabel(c.source_type, language))}</td>
          <td>${c.rating == null ? "" : esc(c.rating)}</td>
          <td>${esc(c.topic_label)}</td>
          <td><span class="pill ${sentimentClass(c.sentiment)}">${esc(sentimentLabel(c.sentiment, data))}</span></td>
          <td>${esc(c.message)}</td>
        </tr>`).join("") || `<tr><td colspan="6">${esc(copy.noData)}</td></tr>`}
      </tbody>
    </table>
  </section>`;
}

function renderLessons(data: FeedbackReportData, sectionNo: string) {
  const copy = t(data);
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.lessons)}</h2></div>
    <ul class="lesson-list">${copy.lessonsBullets(data).map((item: string) => `<li>${esc(item)}</li>`).join("")}</ul>
  </section>`;
}

function renderNextSteps(data: FeedbackReportData, sectionNo: string) {
  const copy = t(data);
  return `<section>
    <div class="sec-head"><span>${sectionNo}</span><h2>${esc(copy.nextSteps)}</h2></div>
    <ol class="next-list">${copy.nextStepBullets(data).map((item: string) => `<li>${esc(item)}</li>`).join("")}</ol>
  </section>`;
}

function sectionNumber(index: number) {
  return String(index).padStart(2, "0");
}

function renderReportBody(data: FeedbackReportData) {
  const copy = t(data);
  const language = lang(data);
  const generated = new Date(data.generated_at);
  const generatedText = Number.isNaN(generated.getTime()) ? data.generated_at : generated.toISOString().slice(0, 19).replace("T", " ");
  const topNegative = topNegativeTopic(data);
  const topPositive = topPositiveTopic(data);
  const topicScope = data.topic_focus?.label
    ? `<p class="scope-line"><strong>${esc(copy.topicFocus)}:</strong> ${esc(data.topic_focus.label)}</p>`
    : "";
  let section = 1;
  const next = () => sectionNumber(section++);
  return `<article class="report-body lang-${language}">
    <header>
      <div class="eyebrow">${esc(copy.docTitle)}</div>
      <h1>${esc(data.title)}</h1>
      <p class="sub">${esc(copy.dateRange)}: <b>${esc(rangeText(data))}</b>. ${esc(copy.generated)} ${esc(generatedText)}. ${esc(copy.subtitle)}</p>
      ${topicScope}
      <div class="hero-grid">
        <div class="metric"><small>${esc(copy.totalFeedback)}</small><strong>${fmt(data.overview.total_comments, language)}</strong><em>${fmt(data.overview.analyzed, language)} ${esc(copy.analyzed)}</em></div>
        <div class="metric neg"><small>${esc(copy.negativeRate)}</small><strong>${esc(data.overview.negative_pct)}%</strong><em>${fmt(data.overview.sentiment.negative, language)} ${esc(copy.negative)}</em></div>
        <div class="metric neg"><small>${esc(copy.topNegativeTopic)}</small><strong>${esc(topNegative?.label || "N/A")}</strong><em>${fmt(topNegative?.negative_count || 0, language)} ${esc(copy.negative)}</em></div>
        <div class="metric pos"><small>${esc(copy.topPositiveTopic)}</small><strong>${esc(topPositive?.label || "N/A")}</strong><em>${fmt(topPositive ? topicPositiveCount(topPositive) : data.overview.sentiment.positive, language)} ${esc(copy.positive)}</em></div>
      </div>
    </header>
    ${renderSentiment(data, next())}
    ${renderChannels(data, next())}
    ${renderIssuePriority(data, next())}
    ${actionableIssueDetails(data).length ? renderIssueDetail(data, next()) : ""}
    ${data.group === "facebook" ? renderPosts(data, next()) : ""}
    ${renderHighlights(data, next())}
    ${renderLlmInsight(data, next())}
    ${renderEvidence(data, next())}
    ${renderLessons(data, next())}
    ${renderNextSteps(data, next())}
  </article>`;
}

function groupLabel(group: FeedbackReportData["group"]) {
  return group === "store" ? "Store" : "Facebook";
}

function languageLabel(language: ReportLanguage) {
  return language === "zh-CN" ? "中文" : "VI";
}

function uniqueValues<T>(values: T[]) {
  return [...new Set(values)];
}

function renderBundleControls(groups: FeedbackReportData["group"][], languages: ReportLanguage[]) {
  if (groups.length <= 1 && languages.length <= 1) return "";
  return `<div class="report-switcher" data-report-switcher>
    ${groups.length > 1 ? `<div class="report-switcher-row">
      <span>Source</span>
      <div class="report-toggle">
        ${groups.map((group, idx) => `<button type="button" class="${idx === 0 ? "is-active" : ""}" data-report-filter="group" data-value="${esc(group)}">${esc(groupLabel(group))}</button>`).join("")}
      </div>
    </div>` : ""}
    ${languages.length > 1 ? `<div class="report-switcher-row">
      <span>Language</span>
      <div class="report-toggle">
        ${languages.map((language, idx) => `<button type="button" class="${idx === 0 ? "is-active" : ""}" data-report-filter="lang" data-value="${esc(language)}">${esc(languageLabel(language))}</button>`).join("")}
      </div>
    </div>` : ""}
  </div>`;
}

function renderBundleScript() {
  return `<script id="report-switcher-script">
    (function () {
      var root = document.querySelector("[data-report-root]");
      if (!root) return;
      var state = {
        group: root.getAttribute("data-active-group") || "",
        lang: root.getAttribute("data-active-lang") || ""
      };

      function render() {
        root.querySelectorAll("[data-report-panel]").forEach(function (panel) {
          var visible = panel.getAttribute("data-report-group") === state.group
            && panel.getAttribute("data-report-lang") === state.lang;
          panel.hidden = !visible;
          panel.classList.toggle("is-active", visible);
        });
        root.querySelectorAll("[data-report-filter]").forEach(function (button) {
          var key = button.getAttribute("data-report-filter");
          button.classList.toggle("is-active", button.getAttribute("data-value") === state[key]);
        });
      }

      root.addEventListener("click", function (event) {
        var target = event.target.closest("[data-report-filter]");
        if (!target || !root.contains(target)) return;
        state[target.getAttribute("data-report-filter")] = target.getAttribute("data-value");
        render();
      });

      render();
    })();
  </script>`;
}

function renderBundleBody(reports: FeedbackReportData[]) {
  const groups = uniqueValues(reports.map((report) => report.group));
  const languages = uniqueValues(reports.map((report) => lang(report)));
  const activeGroup = groups[0];
  const activeLanguage = languages[0];

  return `<div class="report-shell" data-report-root data-active-group="${esc(activeGroup)}" data-active-lang="${esc(activeLanguage)}">
    ${renderBundleControls(groups, languages)}
    <div class="report-panels">
      ${reports.map((report) => {
        const reportLanguage = lang(report);
        const active = report.group === activeGroup && reportLanguage === activeLanguage;
        return `<div class="report-panel ${active ? "is-active" : ""}" data-report-panel data-report-group="${esc(report.group)}" data-report-lang="${esc(reportLanguage)}"${active ? "" : " hidden"}>
          ${renderReportBody(report)}
        </div>`;
      }).join("\n")}
    </div>
  </div>
  ${renderBundleScript()}`;
}

function renderStyles() {
  return `<style>
    :root{--ink:#172033;--muted:#667085;--line:#e4e7ec;--bg:#f6f8fb;--card:#fff;--neg:#e5484d;--pos:#16a164;--neu:#8a94a6;--accent:#b85d1c;}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 Inter,Segoe UI,Arial,sans-serif;}
    .wrap{max-width:1160px;margin:0 auto;padding:34px 24px 56px;}
    .report-shell{display:grid;gap:18px}.report-switcher{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;background:rgba(246,248,251,.94);backdrop-filter:blur(10px);border:1px solid var(--line);border-radius:8px;padding:12px 14px;box-shadow:0 10px 26px rgba(23,32,51,.08)}.report-switcher-row{display:flex;align-items:center;gap:10px}.report-switcher-row>span{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:850}.report-toggle{display:inline-flex;gap:4px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:4px}.report-toggle button{border:0;border-radius:6px;background:transparent;color:var(--muted);font-weight:850;padding:8px 14px;cursor:pointer}.report-toggle button.is-active{background:var(--accent);color:#fff;box-shadow:0 8px 18px rgba(184,93,28,.22)}.report-panel[hidden]{display:none!important}.report-panel.is-active{display:block}.report-panel .report-body{margin-bottom:0}
    .report-body{margin-bottom:34px;break-after:page}.report-body:last-child{break-after:auto}
    header{padding:34px 0 22px;border-bottom:3px solid var(--accent);margin-bottom:22px;}
    .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);font-weight:800;}
    h1{font-size:38px;line-height:1.05;margin:8px 0 10px;} h2{font-size:20px;margin:0;} h3{margin:0 0 10px;font-size:15px;}
    .sub,.sec-desc{color:var(--muted);max-width:860px}.scope-line{display:inline-flex;gap:6px;align-items:center;margin:4px 0 0;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:#fff8f1;color:var(--ink)}.scope-line strong{color:var(--accent)}.hero-grid,.grid{display:grid;gap:14px}.hero-grid{grid-template-columns:repeat(4,minmax(0,1fr));margin-top:20px}.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .metric,.panel{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px}.metric small{display:block;color:var(--muted);font-weight:700}.metric strong,.big{display:block;font-size:30px;line-height:1.15;margin:5px 0;font-weight:850}.metric em{font-style:normal;color:var(--muted)}.metric.neg strong{color:var(--neg)}.metric.pos strong{color:var(--pos)}
    section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:20px;margin:18px 0}.sec-head{display:flex;align-items:center;gap:12px;margin-bottom:15px}.sec-head span{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#fff3e8;color:var(--accent);font-weight:850}
    .rule-list{display:grid;gap:10px;margin-top:16px}.rule-list>div{border-left:4px solid var(--accent);background:#fff8f1;padding:12px 14px;border-radius:6px}.rule-list p{margin:4px 0 0;color:var(--muted)}
    .chart-block{display:grid;gap:10px;margin-top:14px}.bar-row{display:grid;grid-template-columns:180px 1fr 70px;gap:10px;align-items:center}.bar-label{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-track{height:12px;background:#eef1f5;border-radius:999px;overflow:hidden}.bar-fill{height:100%;background:var(--accent)}.bar-fill.neg{background:var(--neg)}.bar-fill.pos{background:var(--pos)}.bar-fill.neu{background:var(--neu)}.bar-num{text-align:right;color:var(--muted);font-weight:700}
    table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top} th{font-size:12px;color:var(--muted);text-transform:uppercase} td{font-size:13px}.sample{margin:0 0 8px}.sample small{color:var(--muted)}
    .pill{display:inline-flex;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:800;background:#eef1f5;color:var(--muted)}.pill.neg,.highlight.neg{background:#fff1f1;color:#b42318}.pill.pos,.highlight.pos{background:#ecfdf3;color:#067647}.pill.neu{background:#f2f4f7;color:#475467}
    .highlight-list{display:grid;gap:12px}.highlight{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:14px;background:#fff}.highlight p{margin:6px 0 0;color:var(--muted)}.empty{color:var(--muted);padding:12px}
    .insight-box{border:1px solid var(--line);border-radius:8px;padding:16px;background:#fbfcfe}.insight-box p{margin:8px 0}.insight-meta{color:var(--muted);font-size:12px}.post-link{color:var(--accent);font-weight:750;text-decoration:none}.post-link:hover{text-decoration:underline}.lesson-list,.next-list{display:grid;gap:8px;margin:0;padding-left:22px}
    footer{color:var(--muted);font-size:12px;margin-top:28px}
    @media(max-width:820px){.hero-grid,.grid.two,.grid.three{grid-template-columns:1fr}.bar-row{grid-template-columns:1fr}.bar-num{text-align:left}h1{font-size:30px}.wrap{padding:24px 14px}.report-switcher{position:static;align-items:stretch}.report-switcher-row{width:100%;justify-content:space-between}.report-toggle button{padding:8px 10px}}
  </style>`;
}

function renderDocument(title: string, body: string, language: ReportLanguage) {
  const footer = COPY[language].footer;
  return `<!doctype html>
<html lang="${language === "zh-CN" ? "zh-CN" : "vi"}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  ${renderStyles()}
</head>
<body>
  <div class="wrap">
    ${body}
    <footer>${esc(footer)}</footer>
  </div>
</body>
</html>`;
}

export function renderFeedbackReportHtml(data: FeedbackReportData): string {
  return renderDocument(data.title, renderReportBody(data), lang(data));
}

export function renderFeedbackReportBundleHtml(reports: FeedbackReportData[]): string {
  if (reports.length === 1) return renderFeedbackReportHtml(reports[0]);
  const title = reports.length === 1 ? reports[0].title : "CFL Combined Feedback Report";
  const language = reports.some((report) => report.language === "zh-CN") ? "zh-CN" : "vi";
  return renderDocument(title, renderBundleBody(reports), language);
}
