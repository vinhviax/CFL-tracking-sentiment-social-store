import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, PieChart, Pie, Cell,
} from "recharts";
import FiltersBar from "../components/FiltersBar.jsx";
import useMeta from "../hooks/useMeta.js";
import { getOverview, getTrend, getInsightsSummary, exportUrl } from "../api/client.js";

const SENTIMENT_COLORS = { negative: "#e5484d", neutral: "#8a94a6", positive: "#2fb872" };
const TOPIC_COLORS = ["#4f8cff", "#2fb872", "#e5a34d", "#e5484d", "#a06cff", "#4dd0e1", "#f06292", "#9ccc65"];

export default function Dashboard() {
  const { meta } = useMeta();
  const [filters, setFilters] = useState({ from: "", to: "", source: "" });
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState([]);
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [error, setError] = useState(null);

  const cleanParams = useCallback(() => {
    const p = {};
    if (filters.from) p.from = filters.from;
    if (filters.to) p.to = filters.to;
    if (filters.source) p.source = filters.source;
    return p;
  }, [filters]);

  useEffect(() => {
    const params = cleanParams();
    setError(null);
    Promise.all([getOverview(params), getTrend(params)])
      .then(([ov, tr]) => {
        setOverview(ov);
        setTrend(tr);
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message));
  }, [cleanParams]);

  const loadInsight = useCallback(() => {
    setInsightLoading(true);
    getInsightsSummary(cleanParams())
      .then((r) => setInsight(r.summary))
      .catch(() => setInsight("Không tải được insight."))
      .finally(() => setInsightLoading(false));
  }, [cleanParams]);

  useEffect(() => {
    if (overview) loadInsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview !== null]);

  if (error) {
    return (
      <>
        <h2 className="page-title">Tổng quan</h2>
        <div className="error-banner">Lỗi tải dữ liệu: {error}</div>
      </>
    );
  }

  return (
    <>
      <h2 className="page-title">Tổng quan Feedback</h2>
      <p className="page-subtitle">Thống kê phản hồi người chơi Crossfire Legends từ Store, Fanpage và Group.</p>

      <FiltersBar filters={filters} onChange={setFilters} meta={meta} />

      {!overview ? (
        <div className="empty-state">Đang tải...</div>
      ) : overview.total_comments === 0 ? (
        <div className="empty-state panel">
          Chưa có dữ liệu nào phù hợp bộ lọc. Hãy vào trang <b>Ingest &amp; Cài đặt</b> để nạp dữ liệu.
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">Tổng phản hồi</div>
              <div className="value">{overview.total_comments.toLocaleString("vi-VN")}</div>
              <div className="sub">{overview.analyzed.toLocaleString("vi-VN")} đã phân tích</div>
            </div>
            <div className="kpi-card">
              <div className="label">Tỉ lệ tiêu cực</div>
              <div className="value" style={{ color: "#e5484d" }}>{overview.negative_pct}%</div>
              <div className="sub">{overview.sentiment.negative?.toLocaleString("vi-VN")} bình luận</div>
            </div>
            <div className="kpi-card">
              <div className="label">Trung lập</div>
              <div className="value" style={{ color: "#8a94a6" }}>{overview.sentiment.neutral?.toLocaleString("vi-VN")}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Tích cực</div>
              <div className="value" style={{ color: "#2fb872" }}>{overview.sentiment.positive?.toLocaleString("vi-VN")}</div>
            </div>
          </div>

          <div className="insight-box">
            <strong>🧠 Insight AI: </strong>
            {insightLoading ? "Đang tổng hợp..." : insight}
          </div>

          <div className="two-col">
            <div className="panel">
              <h3>Xu hướng Sentiment theo ngày</h3>
              {trend.length === 0 ? (
                <div className="empty-state">Chưa có dữ liệu trend.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3245" />
                    <XAxis dataKey="date" tick={{ fill: "#9aa4b8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#9aa4b8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#1e2536", border: "1px solid #2a3245" }} />
                    <Legend />
                    <Bar dataKey="negative" stackId="s" fill={SENTIMENT_COLORS.negative} name="Tiêu cực" />
                    <Bar dataKey="neutral" stackId="s" fill={SENTIMENT_COLORS.neutral} name="Trung lập" />
                    <Bar dataKey="positive" stackId="s" fill={SENTIMENT_COLORS.positive} name="Tích cực" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="panel">
              <h3>Top chủ đề</h3>
              {overview.top_topics.length === 0 ? (
                <div className="empty-state">Không có dữ liệu.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={overview.top_topics.slice(0, 8)}
                      dataKey="count"
                      nameKey="label"
                      outerRadius={100}
                      label={({ label, count }) => `${label}: ${count}`}
                      labelLine={false}
                    >
                      {overview.top_topics.slice(0, 8).map((_, i) => (
                        <Cell key={i} fill={TOPIC_COLORS[i % TOPIC_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1e2536", border: "1px solid #2a3245" }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="panel">
            <h3>🔥 Vấn đề nổi cộm</h3>
            {overview.hot_issues.length === 0 ? (
              <div className="empty-state">Không có vấn đề nổi cộm nào trong khoảng thời gian này.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Chủ đề</th>
                    <th>Số bình luận tiêu cực</th>
                    <th>Số bình luận khẩn cấp</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.hot_issues.map((h) => (
                    <tr key={h.topic}>
                      <td>{h.label}</td>
                      <td>{h.negative}</td>
                      <td>{h.urgent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <a className="btn btn-secondary" href={exportUrl(cleanParams())} style={{ display: "inline-block" }}>
            ⬇ Xuất Excel (theo bộ lọc hiện tại)
          </a>
        </>
      )}
    </>
  );
}
