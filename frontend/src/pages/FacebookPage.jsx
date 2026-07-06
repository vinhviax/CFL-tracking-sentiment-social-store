import { useEffect, useState, useCallback } from "react";
import { listPosts, listComments } from "../api/client.js";
import { SentimentBadge, UrgencyBadge } from "../components/Badges.jsx";
import { formatDisplayDate } from "../utils/dateFormat.js";

export default function FacebookPage() {
  const [tab, setTab] = useState("fb_page");
  const [posts, setPosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [postComments, setPostComments] = useState(null);
  const [error, setError] = useState(null);

  const loadPosts = useCallback(() => {
    setError(null);
    setSelectedPost(null);
    listPosts({ source: tab, limit: 100 })
      .then(setPosts)
      .catch((e) => setError(e?.response?.data?.detail || e.message));
  }, [tab]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const openPost = (post) => {
    setSelectedPost(post);
    listComments({ post_id: post.id, page_size: 100 })
      .then((r) => setPostComments(r.items))
      .catch(() => setPostComments([]));
  };

  return (
    <>
      <h2 className="page-title">Facebook — Fanpage &amp; Group</h2>
      <p className="page-subtitle">
        Fanpage lấy tự động qua Facebook Graph API. Group chưa có API, dữ liệu nạp qua upload CSV
        (xem trang Ingest &amp; Cài đặt).
      </p>

      <div className="tabs">
        <button className={`tab ${tab === "fb_page" ? "active" : ""}`} onClick={() => setTab("fb_page")}>
          Fanpage
        </button>
        <button className={`tab ${tab === "fb_group_csv" ? "active" : ""}`} onClick={() => setTab("fb_group_csv")}>
          Group (CSV)
        </button>
      </div>

      {error && <div className="error-banner">Lỗi tải dữ liệu: {error}</div>}

      <div className="two-col">
        <div className="panel">
          <h3>Bài viết ({posts.length})</h3>
          {posts.length === 0 ? (
            <div className="empty-state">
              Chưa có bài viết nào. {tab === "fb_page" ? "Kéo dữ liệu Fanpage" : "Upload CSV Group"} ở trang Ingest.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Ngày đăng</th>
                  <th>Nội dung</th>
                  <th>Bình luận</th>
                  <th>Tiêu cực</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => openPost(p)}
                    style={{ cursor: "pointer", background: selectedPost?.id === p.id ? "#1e2536" : "transparent" }}
                  >
                    <td>{p.published_at ? formatDisplayDate(p.published_at) : "—"}</td>
                    <td className="msg-preview" style={{ maxWidth: 260 }}>
                      {(p.message || "(không có nội dung)").slice(0, 100)}
                    </td>
                    <td>{p.comment_count}</td>
                    <td style={{ color: p.negative_count > 0 ? "#e5484d" : "inherit" }}>{p.negative_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h3>{selectedPost ? "Bình luận của bài viết" : "Chọn một bài viết để xem bình luận"}</h3>
          {selectedPost && (
            <p className="page-subtitle msg-preview">{selectedPost.message}</p>
          )}
          {postComments === null ? null : postComments.length === 0 ? (
            <div className="empty-state">Không có bình luận.</div>
          ) : (
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              {postComments.map((c) => (
                <div key={c.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div className="msg-preview" style={{ marginBottom: 6 }}>{c.message}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <SentimentBadge value={c.analysis?.sentiment} />
                    <UrgencyBadge value={c.analysis?.urgency} />
                    {c.analysis?.topic_main && (
                      <span className="badge badge-neutral">{c.analysis.topic_main}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
