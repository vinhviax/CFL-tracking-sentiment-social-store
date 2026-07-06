import { useEffect, useState, useCallback } from "react";
import FiltersBar from "../components/FiltersBar.jsx";
import { SentimentBadge, UrgencyBadge } from "../components/Badges.jsx";
import useMeta from "../hooks/useMeta.js";
import { listComments, exportUrl } from "../api/client.js";

const PAGE_SIZE = 30;

export default function CommentExplorer() {
  const { meta } = useMeta();
  const [filters, setFilters] = useState({ from: "", to: "", source: "", topic: "", sentiment: "" });
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const params = useCallback(() => {
    const p = { page, page_size: PAGE_SIZE };
    if (filters.from) p.from = filters.from;
    if (filters.to) p.to = filters.to;
    if (filters.source) p.source = filters.source;
    if (filters.topic) p.topic = filters.topic;
    if (filters.sentiment) p.sentiment = filters.sentiment;
    if (q) p.q = q;
    return p;
  }, [filters, q, page]);

  useEffect(() => {
    setError(null);
    listComments(params())
      .then(setData)
      .catch((e) => setError(e?.response?.data?.detail || e.message));
  }, [params]);

  const onFiltersChange = (next) => {
    setFilters(next);
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <h2 className="page-title">Comment Explorer</h2>
      <p className="page-subtitle">Tìm kiếm và lọc toàn bộ phản hồi đã thu thập.</p>

      <FiltersBar
        filters={filters}
        onChange={onFiltersChange}
        meta={meta}
        extra={
          <label>
            Tìm kiếm nội dung
            <input
              type="text"
              placeholder="vd: lag, nạp, hack..."
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              style={{ minWidth: 220 }}
            />
          </label>
        }
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="page-subtitle" style={{ margin: 0 }}>
          {data ? `${data.total.toLocaleString("vi-VN")} kết quả` : "..."}
        </span>
        <a className="btn btn-secondary" href={exportUrl({ ...params(), page: undefined, page_size: undefined })}>
          ⬇ Xuất Excel (theo bộ lọc)
        </a>
      </div>

      {error && <div className="error-banner">Lỗi tải dữ liệu: {error}</div>}

      {!data ? (
        <div className="empty-state">Đang tải...</div>
      ) : data.items.length === 0 ? (
        <div className="empty-state panel">Không có bình luận nào khớp bộ lọc.</div>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Nguồn</th>
                <th>Nội dung</th>
                <th>Chủ đề</th>
                <th>Sentiment</th>
                <th>Khẩn cấp</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>{c.created_at ? new Date(c.created_at).toLocaleDateString("vi-VN") : "—"}</td>
                  <td>{c.source_type}</td>
                  <td className="msg-preview">{c.message}</td>
                  <td>{meta?.topics[c.analysis?.topic_main] || c.analysis?.topic_main || "—"}</td>
                  <td><SentimentBadge value={c.analysis?.sentiment} /></td>
                  <td><UrgencyBadge value={c.analysis?.urgency} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pagination">
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Trước
            </button>
            <span>Trang {page}/{totalPages}</span>
            <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Sau →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
