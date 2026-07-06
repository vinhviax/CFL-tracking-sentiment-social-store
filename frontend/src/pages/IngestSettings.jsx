import { useEffect, useRef, useState, useCallback } from "react";
import {
  previewCsv, uploadCsv, ingestSensorTower, ingestFacebook,
  listRuns, runAnalyze, getAnalyzeProgress, getHealth,
} from "../api/client.js";
import { StatusPill } from "../components/Badges.jsx";

function useProgressPoll(progressKey) {
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (!progressKey) return;
    let stop = false;
    const tick = () => {
      getAnalyzeProgress(progressKey).then((p) => {
        if (stop) return;
        setProgress(p);
        if (p.status !== "done" && p.status !== "unknown") {
          setTimeout(tick, 1200);
        }
      });
    };
    tick();
    return () => { stop = true; };
  }, [progressKey]);
  return progress;
}

export default function IngestSettings() {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [progressKey, setProgressKey] = useState(null);

  const [stRange, setStRange] = useState({ start_date: "", end_date: "" });
  const [stBusy, setStBusy] = useState(false);
  const [stError, setStError] = useState(null);

  const [fbBusy, setFbBusy] = useState(false);
  const [fbError, setFbError] = useState(null);

  const [runs, setRuns] = useState([]);
  const [health, setHealth] = useState(null);

  const progress = useProgressPoll(progressKey);

  const loadRuns = useCallback(() => {
    listRuns({ limit: 20 }).then(setRuns).catch(() => {});
  }, []);

  useEffect(() => {
    loadRuns();
    getHealth().then(setHealth).catch(() => {});
  }, [loadRuns]);

  useEffect(() => {
    if (progress?.status === "done") loadRuns();
  }, [progress?.status, loadRuns]);

  const onFileSelect = (f) => {
    if (!f) return;
    setFile(f);
    setUploadError(null);
    previewCsv(f).then(setPreview).catch((e) => setUploadError(e?.response?.data?.detail || e.message));
  };

  const confirmUpload = () => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    uploadCsv(file)
      .then((run) => {
        setLastRun(run);
        setPreview(null);
        setFile(null);
        loadRuns();
      })
      .catch((e) => setUploadError(e?.response?.data?.detail || e.message))
      .finally(() => setUploading(false));
  };

  const startAnalyze = (runId) => {
    runAnalyze({ run_id: runId, only_unanalyzed: true }).then((r) => setProgressKey(r.progress_key));
  };

  const pullSensorTower = () => {
    setStBusy(true);
    setStError(null);
    ingestSensorTower(stRange)
      .then((run) => { loadRuns(); startAnalyze(run.id); })
      .catch((e) => setStError(e?.response?.data?.detail || e.message))
      .finally(() => setStBusy(false));
  };

  const pullFacebook = () => {
    setFbBusy(true);
    setFbError(null);
    ingestFacebook({})
      .then((run) => { loadRuns(); startAnalyze(run.id); })
      .catch((e) => setFbError(e?.response?.data?.detail || e.message))
      .finally(() => setFbBusy(false));
  };

  return (
    <>
      <h2 className="page-title">Ingest &amp; Cài đặt</h2>
      <p className="page-subtitle">Nạp dữ liệu mới và theo dõi trạng thái xử lý.</p>

      <div className="two-col">
        <div className="panel">
          <h3>📤 Upload CSV (Facebook Group)</h3>
          <div
            className="upload-zone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFileSelect(e.dataTransfer.files?.[0]); }}
          >
            {file ? `Đã chọn: ${file.name}` : "Kéo thả file CSV vào đây, hoặc bấm để chọn file"}
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(e) => onFileSelect(e.target.files?.[0])}
            />
          </div>

          {uploadError && <div className="error-banner">{uploadError}</div>}

          {preview && (
            <>
              <p>Tổng <b>{preview.total_rows}</b> dòng. Xem trước 10 dòng đầu:</p>
              <table>
                <thead><tr><th>Nguồn</th><th>Ngày</th><th>Bình luận</th></tr></thead>
                <tbody>
                  {preview.sample.map((r, i) => (
                    <tr key={i}>
                      <td>{r.source}</td>
                      <td>{r.created_date}</td>
                      <td className="msg-preview">{r.comment_message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn" disabled={uploading} onClick={confirmUpload} style={{ marginTop: 12 }}>
                {uploading ? "Đang nạp..." : "Xác nhận nạp dữ liệu"}
              </button>
            </>
          )}

          {lastRun && (
            <div style={{ marginTop: 14 }}>
              <p>✅ Đã nạp {lastRun.rows_new}/{lastRun.rows_fetched} dòng mới (run #{lastRun.id}).</p>
              <button className="btn btn-secondary" onClick={() => startAnalyze(lastRun.id)}>
                Chạy phân loại AI cho dữ liệu vừa nạp
              </button>
            </div>
          )}

          {progressKey && progress && (
            <div style={{ marginTop: 14 }}>
              <p>
                Đang phân tích: {progress.done ?? 0}/{progress.total ?? 0}
                {progress.provider ? ` (${progress.provider})` : ""}
              </p>
              <div style={{ background: "var(--panel-2)", borderRadius: 6, height: 8, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                    background: "var(--accent)", height: "100%",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <h3>🔄 Kéo dữ liệu tự động</h3>

          <div style={{ marginBottom: 20 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Sensor Tower (Store, VN)</h4>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input type="date" value={stRange.start_date}
                onChange={(e) => setStRange({ ...stRange, start_date: e.target.value })} />
              <input type="date" value={stRange.end_date}
                onChange={(e) => setStRange({ ...stRange, end_date: e.target.value })} />
            </div>
            <button className="btn" disabled={stBusy} onClick={pullSensorTower}>
              {stBusy ? "Đang kéo..." : "Kéo review Store"}
            </button>
            {stError && <div className="error-banner" style={{ marginTop: 8 }}>{stError}</div>}
          </div>

          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Facebook Fanpage (Graph API)</h4>
            <button className="btn" disabled={fbBusy} onClick={pullFacebook}>
              {fbBusy ? "Đang kéo..." : "Kéo bài viết + bình luận Fanpage"}
            </button>
            {fbError && <div className="error-banner" style={{ marginTop: 8 }}>{fbError}</div>}
          </div>

          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "20px 0" }} />

          <h3 style={{ marginTop: 0 }}>⚙️ Trạng thái hệ thống</h3>
          {health ? (
            <table>
              <tbody>
                <tr><td>LLM provider</td><td>{health.llm_provider}</td></tr>
                <tr><td>LLM sẵn sàng</td><td>{health.llm_ready ? "✅ Có key" : "⚠️ Chưa cấu hình — đang dùng fallback rule-based"}</td></tr>
                <tr><td>Prompt version</td><td>{health.prompt_version}</td></tr>
              </tbody>
            </table>
          ) : <div className="empty-state">Đang tải...</div>}
          <p className="page-subtitle">Cấu hình provider/key qua file <code>.env</code> ở backend (xem README).</p>
        </div>
      </div>

      <div className="panel">
        <h3>📜 Lịch sử Ingest</h3>
        {runs.length === 0 ? (
          <div className="empty-state">Chưa có lần nạp dữ liệu nào.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Nguồn</th><th>Trạng thái</th><th>Bắt đầu</th>
                <th>Mới</th><th>Tổng lấy</th><th>Lỗi</th><th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.source_type}</td>
                  <td><StatusPill status={r.status} /></td>
                  <td>{r.started_at ? new Date(r.started_at).toLocaleString("vi-VN") : "—"}</td>
                  <td>{r.rows_new}</td>
                  <td>{r.rows_fetched}</td>
                  <td style={{ color: "var(--negative)", fontSize: 12 }}>{r.error || ""}</td>
                  <td>
                    {r.status === "done" && r.rows_new > 0 && (
                      <button className="btn btn-secondary" onClick={() => startAnalyze(r.id)}>Phân loại</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
