export interface FeedbackReportData {
  group: "store" | "facebook";
  title: string;
  generated_at: string;
  range: { from: string | null; to: string | null };
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
    urgent_count: number;
    sample_comments: Array<{ id: number; message: string; sentiment: string; urgency: string; summary: string }>;
  }>;
  subtopic_ranking: Array<any>;
  comments: ReportComment[];
  channels: Array<{ source_type: string; label: string; total: number; positive: number; neutral: number; negative: number }>;
  store_breakdown: any | null;
  top_posts: ReportPost[];
  highlights: Array<{ title: string; detail: string; signal: string }>;
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
  comment_count: number;
  negative_count: number;
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

function fmt(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("vi-VN");
}

function rangeText(data: FeedbackReportData) {
  if (data.range.from && data.range.to) return `${data.range.from} - ${data.range.to}`;
  if (data.range.from) return `Tu ${data.range.from}`;
  if (data.range.to) return `Den ${data.range.to}`;
  return "Tat ca du lieu";
}

function sourceLabel(sourceType: string) {
  if (sourceType === "fb_page") return "Fanpage";
  if (sourceType === "fb_group_csv") return "Group CSV";
  if (sourceType === "store") return "Store";
  return sourceType || "Khong ro";
}

function sentimentClass(value: string) {
  if (value === "negative") return "neg";
  if (value === "positive") return "pos";
  return "neu";
}

function bar(label: string, value: number, total: number, cls = "") {
  const width = Math.min(100, Math.max(3, pct(value, total)));
  return `<div class="bar-row">
    <div class="bar-label">${esc(label)}</div>
    <div class="bar-track"><div class="bar-fill ${cls}" style="width:${width}%"></div></div>
    <div class="bar-num">${fmt(value)}</div>
  </div>`;
}

function renderSentiment(data: FeedbackReportData) {
  const s = data.overview.sentiment || {};
  const total = Math.max(1, data.overview.analyzed || 0);
  return `<section>
    <div class="sec-head"><span>01</span><h2>Sentiment overview</h2></div>
    <div class="grid three">
      <div class="metric neg"><small>Negative</small><strong>${fmt(s.negative)}</strong><em>${pct(s.negative || 0, total)}%</em></div>
      <div class="metric neu"><small>Neutral</small><strong>${fmt(s.neutral)}</strong><em>${pct(s.neutral || 0, total)}%</em></div>
      <div class="metric pos"><small>Positive</small><strong>${fmt(s.positive)}</strong><em>${pct(s.positive || 0, total)}%</em></div>
    </div>
    <div class="chart-block">
      ${bar("Negative", s.negative || 0, total, "neg")}
      ${bar("Neutral", s.neutral || 0, total, "neu")}
      ${bar("Positive", s.positive || 0, total, "pos")}
    </div>
  </section>`;
}

function renderChannels(data: FeedbackReportData) {
  if (data.group === "store" && data.store_breakdown) {
    const platforms = data.store_breakdown.platforms || [];
    const rating = data.store_breakdown.rating_distribution || {};
    const ratingTotal = Object.values(rating).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
    return `<section>
      <div class="sec-head"><span>02</span><h2>Store platform and rating</h2></div>
      <div class="grid two">
        ${platforms.map((p: any) => `<div class="panel">
          <h3>${esc(p.store === "gp" ? "Google Play" : p.store === "ios" ? "App Store" : p.store)}</h3>
          <p class="big">${esc(p.avg_rating)}</p>
          <p>${fmt(p.count)} reviews</p>
        </div>`).join("")}
      </div>
      <div class="chart-block">
        ${["1", "2", "3", "4", "5"].map((star) => bar(`${star} sao`, Number(rating[star] || 0), ratingTotal, Number(star) <= 2 ? "neg" : Number(star) >= 4 ? "pos" : "neu")).join("")}
      </div>
    </section>`;
  }

  const total = data.channels.reduce((sum, row) => sum + row.total, 0);
  return `<section>
    <div class="sec-head"><span>02</span><h2>Channel breakdown</h2></div>
    <div class="grid two">
      ${data.channels.map((row) => `<div class="panel">
        <h3>${esc(row.label)}</h3>
        <p class="big">${fmt(row.total)}</p>
        <p><span class="pill neg">${fmt(row.negative)} negative</span> <span class="pill pos">${fmt(row.positive)} positive</span></p>
      </div>`).join("") || `<div class="empty">Khong co du lieu kenh.</div>`}
    </div>
    <div class="chart-block">${data.channels.map((row) => bar(row.label, row.total, total, row.source_type === "fb_page" ? "pos" : "neu")).join("")}</div>
  </section>`;
}

function renderTopics(data: FeedbackReportData) {
  const total = data.topic_ranking.reduce((sum, row) => sum + row.count, 0);
  return `<section>
    <div class="sec-head"><span>03</span><h2>Top topics and urgent issues</h2></div>
    <div class="grid two">
      <div class="panel">
        <h3>Topic ranking</h3>
        <div class="chart-block compact">
          ${data.topic_ranking.slice(0, 8).map((row) => bar(row.label, row.count, total, row.negative_count > 0 ? "neg" : "pos")).join("") || `<div class="empty">Chua co topic.</div>`}
        </div>
      </div>
      <div class="panel">
        <h3>Hot issues</h3>
        <table>
          <thead><tr><th>Issue</th><th>Negative</th><th>Urgent</th></tr></thead>
          <tbody>
            ${data.overview.hot_issues.map((row) => `<tr><td>${esc(row.label)}</td><td>${fmt(row.negative)}</td><td>${fmt(row.urgent)}</td></tr>`).join("") || `<tr><td colspan="3">Khong co issue noi bat.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  </section>`;
}

function renderPosts(data: FeedbackReportData) {
  if (data.group !== "facebook") return "";
  return `<section>
    <div class="sec-head"><span>04</span><h2>Top post context</h2></div>
    <table>
      <thead><tr><th>Source</th><th>Date</th><th>Post</th><th>Comments</th><th>Negative</th></tr></thead>
      <tbody>
        ${data.top_posts.map((post) => `<tr>
          <td>${esc(sourceLabel(post.source_type))}</td>
          <td>${esc(post.published_at || "")}</td>
          <td>${esc(post.message).slice(0, 260)}</td>
          <td>${fmt(post.comment_count)}</td>
          <td>${fmt(post.negative_count)}</td>
        </tr>`).join("") || `<tr><td colspan="5">Khong co post trong khoang nay.</td></tr>`}
      </tbody>
    </table>
  </section>`;
}

function renderHighlights(data: FeedbackReportData) {
  return `<section>
    <div class="sec-head"><span>${data.group === "facebook" ? "05" : "04"}</span><h2>Key highlights and operations recommendations</h2></div>
    <div class="highlight-list">
      ${data.highlights.map((h, idx) => `<div class="highlight ${sentimentClass(h.signal)}">
        <strong>Highlight ${idx + 1}: ${esc(h.title)}</strong>
        <p>${esc(h.detail)}</p>
      </div>`).join("")}
    </div>
  </section>`;
}

function renderEvidence(data: FeedbackReportData) {
  return `<section>
    <div class="sec-head"><span>${data.group === "facebook" ? "06" : "05"}</span><h2>Comment evidence</h2></div>
    <table>
      <thead><tr><th>Date</th><th>Source</th><th>Rating</th><th>Topic</th><th>Sentiment</th><th>Comment</th><th>Context/Summary</th></tr></thead>
      <tbody>
        ${data.comments.map((c) => `<tr>
          <td>${esc(c.created_at || "")}</td>
          <td>${esc(sourceLabel(c.source_type))}</td>
          <td>${c.rating == null ? "" : esc(c.rating)}</td>
          <td>${esc(c.topic_label)}</td>
          <td><span class="pill ${sentimentClass(c.sentiment)}">${esc(c.sentiment)}</span></td>
          <td>${esc(c.message)}</td>
          <td>${c.post_message ? `<b>Post:</b> ${esc(c.post_message)}<br>` : ""}${esc(c.summary)}</td>
        </tr>`).join("") || `<tr><td colspan="7">Khong co comment phu hop.</td></tr>`}
      </tbody>
    </table>
  </section>`;
}

export function renderFeedbackReportHtml(data: FeedbackReportData): string {
  const generated = new Date(data.generated_at);
  const generatedText = Number.isNaN(generated.getTime()) ? data.generated_at : generated.toISOString().slice(0, 19).replace("T", " ");
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(data.title)}</title>
  <style>
    :root{--ink:#172033;--muted:#667085;--line:#e4e7ec;--bg:#f6f8fb;--card:#fff;--neg:#e5484d;--pos:#16a164;--neu:#8a94a6;--accent:#b85d1c;}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 Inter,Segoe UI,Arial,sans-serif;}
    .wrap{max-width:1160px;margin:0 auto;padding:34px 24px 56px;}
    header{padding:34px 0 22px;border-bottom:3px solid var(--accent);margin-bottom:22px;}
    .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);font-weight:800;}
    h1{font-size:38px;line-height:1.05;margin:8px 0 10px;} h2{font-size:20px;margin:0;} h3{margin:0 0 10px;font-size:15px;}
    .sub{color:var(--muted);max-width:780px}.hero-grid,.grid{display:grid;gap:14px}.hero-grid{grid-template-columns:repeat(4,minmax(0,1fr));margin-top:20px}.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .metric,.panel{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px}.metric small{display:block;color:var(--muted);font-weight:700}.metric strong,.big{display:block;font-size:30px;line-height:1.15;margin:5px 0;font-weight:850}.metric em{font-style:normal;color:var(--muted)}.metric.neg strong{color:var(--neg)}.metric.pos strong{color:var(--pos)}
    section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:20px;margin:18px 0}.sec-head{display:flex;align-items:center;gap:12px;margin-bottom:15px}.sec-head span{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#fff3e8;color:var(--accent);font-weight:850}
    .chart-block{display:grid;gap:10px;margin-top:14px}.chart-block.compact{margin-top:0}.bar-row{display:grid;grid-template-columns:180px 1fr 70px;gap:10px;align-items:center}.bar-label{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-track{height:12px;background:#eef1f5;border-radius:999px;overflow:hidden}.bar-fill{height:100%;background:var(--accent)}.bar-fill.neg{background:var(--neg)}.bar-fill.pos{background:var(--pos)}.bar-fill.neu{background:var(--neu)}.bar-num{text-align:right;color:var(--muted);font-weight:700}
    table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top} th{font-size:12px;color:var(--muted);text-transform:uppercase} td{font-size:13px}
    .pill{display:inline-flex;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:800;background:#eef1f5;color:var(--muted)}.pill.neg,.highlight.neg{background:#fff1f1;color:#b42318}.pill.pos,.highlight.pos{background:#ecfdf3;color:#067647}.pill.neu{background:#f2f4f7;color:#475467}
    .highlight-list{display:grid;gap:12px}.highlight{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:14px;background:#fff}.highlight p{margin:6px 0 0;color:var(--muted)}.empty{color:var(--muted);padding:12px}
    footer{color:var(--muted);font-size:12px;margin-top:28px}
    @media(max-width:820px){.hero-grid,.grid.two,.grid.three{grid-template-columns:1fr}.bar-row{grid-template-columns:1fr}.bar-num{text-align:left}h1{font-size:30px}.wrap{padding:24px 14px}}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="eyebrow">Crossfire Legends Feedback Intelligence</div>
      <h1>${esc(data.title)}</h1>
      <p class="sub">Khoang du lieu: <b>${esc(rangeText(data))}</b>. Tao luc ${esc(generatedText)}. Report gom KPI, Sentiment, chu de noi bat, dan chung comment va khuyen nghi van hanh.</p>
      <div class="hero-grid">
        <div class="metric"><small>Total feedback</small><strong>${fmt(data.overview.total_comments)}</strong><em>${fmt(data.overview.analyzed)} analyzed</em></div>
        <div class="metric neg"><small>Negative rate</small><strong>${esc(data.overview.negative_pct)}%</strong><em>${fmt(data.overview.sentiment.negative)} negative</em></div>
        <div class="metric neu"><small>Top topic</small><strong>${esc(data.overview.top_topics[0]?.label || "N/A")}</strong><em>${fmt(data.overview.top_topics[0]?.count || 0)} mentions</em></div>
        <div class="metric pos"><small>Positive</small><strong>${fmt(data.overview.sentiment.positive)}</strong><em>community signal</em></div>
      </div>
    </header>
    ${renderSentiment(data)}
    ${renderChannels(data)}
    ${renderTopics(data)}
    ${renderPosts(data)}
    ${renderHighlights(data)}
    ${renderEvidence(data)}
    <footer>CFL Feedback Agent Report · Internal liveops use · Data source: Store/Facebook comments already ingested and analyzed by LLM.</footer>
  </div>
</body>
</html>`;
}
