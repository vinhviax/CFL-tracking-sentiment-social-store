import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { getOverview, getTrend, getStoreBreakdown } from "../api/client.js";
import DateTextInput from "../components/DateTextInput.jsx";
import { formatDisplayDate } from "../utils/dateFormat.js";

export default function StorePage() {
  const [filters, setFilters] = useState({ from: "", to: "" });
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState([]);
  const [breakdown, setBreakdown] = useState(null);
  const [error, setError] = useState(null);

  const params = useCallback(() => {
    const p = { source: "store" };
    if (filters.from) p.from = filters.from;
    if (filters.to) p.to = filters.to;
    return p;
  }, [filters]);

  useEffect(() => {
    setError(null);
    const p = params();
    Promise.all([getOverview(p), getTrend(p), getStoreBreakdown(p)])
      .then(([ov, tr, bd]) => {
        setOverview(ov);
        setTrend(tr);
        setBreakdown(bd);
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message));
  }, [params]);

  const ratingData = breakdown
    ? Object.entries(breakdown.rating_distribution).map(([star, count]) => ({ star: `${star}★`, count }))
    : [];

  return (
    <>
      <h2 className="page-title">Store — Google Play &amp; App Store</h2>
      <p className="page-subtitle">Review người chơi từ Sensor Tower API (Việt Nam).</p>

      <div className="filters-bar">
        <label>
          Từ ngày
          <DateTextInput value={filters.from} onChange={(value) => setFilters({ ...filters, from: value })} />
        </label>
        <label>
          Đến ngày
          <DateTextInput value={filters.to} onChange={(value) => setFilters({ ...filters, to: value })} />
        </label>
      </div>

      {error && <div className="error-banner">Lỗi tải dữ liệu: {error}</div>}

      {!overview ? (
        <div className="empty-state">Đang tải...</div>
      ) : overview.total_comments === 0 ? (
        <div className="empty-state panel">
          Chưa có review Store nào trong DB. Vào <b>Ingest &amp; Cài đặt</b> để kéo dữ liệu từ Sensor Tower.
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">Tổng review</div>
              <div className="value">{overview.total_comments.toLocaleString("vi-VN")}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Tỉ lệ tiêu cực</div>
              <div className="value" style={{ color: "#e5484d" }}>{overview.negative_pct}%</div>
            </div>
            {breakdown?.platforms.map((p) => (
              <div className="kpi-card" key={p.store}>
                <div className="label">{p.store === "gp" ? "Google Play" : p.store === "ios" ? "App Store" : p.store}</div>
                <div className="value">⭐ {p.avg_rating}</div>
                <div className="sub">{p.count.toLocaleString("vi-VN")} review</div>
              </div>
            ))}
          </div>

          <div className="two-col">
            <div className="panel">
              <h3>Xu hướng sentiment theo ngày</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3245" />
                  <XAxis dataKey="date" tickFormatter={formatDisplayDate} tick={{ fill: "#9aa4b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#9aa4b8", fontSize: 11 }} />
                  <Tooltip labelFormatter={formatDisplayDate} contentStyle={{ background: "#1e2536", border: "1px solid #2a3245" }} />
                  <Legend />
                  <Bar dataKey="negative" stackId="s" fill="#e5484d" name="Tiêu cực" />
                  <Bar dataKey="neutral" stackId="s" fill="#8a94a6" name="Trung lập" />
                  <Bar dataKey="positive" stackId="s" fill="#2fb872" name="Tích cực" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <h3>Phân bố số sao</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={ratingData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3245" />
                  <XAxis dataKey="star" tick={{ fill: "#9aa4b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#9aa4b8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#1e2536", border: "1px solid #2a3245" }} />
                  <Bar dataKey="count" fill="#4f8cff" name="Số review" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3>Top chủ đề (Store)</h3>
            <table>
              <thead><tr><th>Chủ đề</th><th>Số lượng</th></tr></thead>
              <tbody>
                {overview.top_topics.map((t) => (
                  <tr key={t.topic}><td>{t.label}</td><td>{t.count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
