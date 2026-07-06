import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAnalyzeProgress,
  getHealth,
  getIngestStatus,
  getTranslateProgress,
  ingestFacebook,
  ingestSensorTower,
  listRuns,
  previewCsv,
  runAnalyze,
  runTranslate,
  uploadCsv,
} from "../api/client.js";
import { StatusPill } from "../components/Badges.jsx";

function useProgressPoll(progressKey, loader) {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!progressKey) return;
    let stop = false;
    const tick = () => {
      loader(progressKey).then((p) => {
        if (stop) return;
        setProgress(p);
        if (!["done", "failed", "unknown"].includes(p.status)) {
          setTimeout(tick, 1200);
        }
      });
    };
    tick();
    return () => { stop = true; };
  }, [progressKey, loader]);

  return progress;
}

function parseRunNote(note) {
  if (!note) return {};
  try {
    return JSON.parse(note);
  } catch {
    return { text: note };
  }
}

function formatDate(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("vi-VN");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN");
}

function sourceName(sourceType) {
  if (sourceType === "store") return "Store reviews";
  if (sourceType === "fb_page") return "Facebook Fanpage";
  if (sourceType === "fb_group_csv") return "Facebook Group CSV";
  return sourceType || "Không rõ nguồn";
}

function runScope(run) {
  if (!run) return "Chưa rõ phạm vi";
  const note = parseRunNote(run.note);
  if (note.start_date || note.end_date) {
    return `${formatDate(note.start_date) || "?"} → ${formatDate(note.end_date) || "?"}`;
  }
  if (note.text) return note.text;
  return `Ngày kéo: ${formatDate(run.started_at) || "—"}`;
}

function runTitle(run) {
  if (!run) return "Chưa rõ run";
  return `Run #${run.id} · ${sourceName(run.source_type)} · ${runScope(run)}`;
}

function statusText(status, kind) {
  const label = kind === "translation" ? "dịch" : "phân tích";
  if (status === "done") return `Đã ${label}`;
  if (status === "partial") return `${label[0].toUpperCase()}${label.slice(1)} một phần`;
  if (status === "not_started") return `Chưa ${label}`;
  return "Không có dữ liệu";
}

function ProcessingBadge({ status, progress, kind }) {
  const className = status === "done"
    ? "processing-badge done"
    : status === "partial"
      ? "processing-badge partial"
      : "processing-badge pending";
  return (
    <span className={className}>
      {statusText(status, kind)} · {progress?.done ?? 0}/{progress?.total ?? 0}
    </span>
  );
}

function ProgressBlock({ title, progress, color, error }) {
  return (
    <div className="processing-progress">
      <p><b>{title}</b></p>
      <p className="progress-caption">
        {progress.done ?? 0}/{progress.total ?? 0} comment
        {progress.provider ? ` · Provider: ${progress.provider}` : ""}
      </p>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{
            width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
            background: color,
          }}
        />
      </div>
      {error && <div className="error-banner" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

export default function IngestSettings() {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [progressKey, setProgressKey] = useState(null);
  const [translateKey, setTranslateKey] = useState(null);
  const [analysisTarget, setAnalysisTarget] = useState(null);
  const [translationTarget, setTranslationTarget] = useState(null);

  const [stRange, setStRange] = useState({ start_date: "", end_date: "" });
  const [stBusy, setStBusy] = useState(false);
  const [stError, setStError] = useState(null);

  const [fbBusy, setFbBusy] = useState(false);
  const [fbError, setFbError] = useState(null);

  const [runs, setRuns] = useState([]);
  const [health, setHealth] = useState(null);
  const [ingestStatus, setIngestStatus] = useState(null);

  const progress = useProgressPoll(progressKey, getAnalyzeProgress);
  const translateProgress = useProgressPoll(translateKey, getTranslateProgress);

  const loadRuns = useCallback(() => {
    listRuns({ limit: 20 }).then(setRuns).catch(() => {});
  }, []);

  useEffect(() => {
    loadRuns();
    getHealth().then(setHealth).catch(() => {});
    getIngestStatus().then(setIngestStatus).catch(() => {});
  }, [loadRuns]);

  useEffect(() => {
    if (["done", "failed"].includes(progress?.status)) loadRuns();
  }, [progress?.status, loadRuns]);

  useEffect(() => {
    if (["done", "failed"].includes(translateProgress?.status)) loadRuns();
  }, [translateProgress?.status, loadRuns]);

  const onFileSelect = (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setUploadError(null);
    previewCsv(selectedFile)
      .then(setPreview)
      .catch((e) => setUploadError(e?.response?.data?.detail || e.message));
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

  const resolveRun = (run) => (typeof run === "object" ? run : runs.find((item) => item.id === run) || { id: run });

  const startAnalyze = (run) => {
    const target = resolveRun(run);
    setAnalysisTarget(target);
    runAnalyze({ run_id: target.id, only_unanalyzed: true })
      .then((r) => setProgressKey(r.progress_key));
  };

  const startTranslate = (run) => {
    const target = resolveRun(run);
    setTranslationTarget(target);
    runTranslate({ run_id: target.id, locale: "zh-CN", limit: 300 })
      .then((r) => setTranslateKey(r.progress_key));
  };

  const pullSensorTower = () => {
    setStBusy(true);
    setStError(null);
    ingestSensorTower(stRange)
      .then((run) => { loadRuns(); startAnalyze(run); })
      .catch((e) => setStError(e?.response?.data?.detail || e.message))
      .finally(() => setStBusy(false));
  };

  const pullFacebook = () => {
    setFbBusy(true);
    setFbError(null);
    ingestFacebook({})
      .then((run) => { loadRuns(); startAnalyze(run); })
      .catch((e) => setFbError(e?.response?.data?.detail || e.message))
      .finally(() => setFbBusy(false));
  };

  return (
    <>
      <h2 className="page-title">Ingest &amp; Cài đặt</h2>
      <p className="page-subtitle">Nạp dữ liệu mới, phân loại LLM và dịch zh-CN có kiểm soát.</p>

      <div className="two-col">
        <div className="panel">
          <h3>Upload CSV (Facebook Group)</h3>
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
                  {preview.sample.map((row, index) => (
                    <tr key={index}>
                      <td>{row.source}</td>
                      <td>{row.created_date}</td>
                      <td className="msg-preview">{row.comment_message}</td>
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
              <p>Đã nạp {lastRun.rows_new}/{lastRun.rows_fetched} dòng mới ({runTitle(lastRun)}).</p>
              <button className="btn btn-secondary" onClick={() => startAnalyze(lastRun)}>
                Chạy phân loại AI cho {runTitle(lastRun)}
              </button>
            </div>
          )}

          {progressKey && progress && (
            <ProgressBlock
              title={`${progress.status === "done" ? "Đã phân tích xong" : "Đang phân tích"}: ${runTitle(analysisTarget)}`}
              progress={progress}
              color="var(--accent)"
              error={progress.error}
            />
          )}

          {translateKey && translateProgress && (
            <ProgressBlock
              title={`${translateProgress.status === "done" ? "Đã dịch xong zh-CN" : "Đang dịch zh-CN"}: ${runTitle(translationTarget)}`}
              progress={translateProgress}
              color="var(--positive)"
              error={translateProgress.error}
            />
          )}
        </div>

        <div className="panel">
          <h3>Kéo dữ liệu tự động</h3>
          {ingestStatus && (
            <div className="status-card">
              <p><b>Cron Sensor Tower:</b> {ingestStatus.cron.bangkok_time} GMT+7 mỗi ngày ({ingestStatus.cron.utc} UTC)</p>
              <p><b>Cursor:</b> {ingestStatus.sensortower_cursor?.cursor_date || "Chưa khởi tạo"}</p>
              <p><b>Store run gần nhất:</b> {ingestStatus.latest_store_run ? `#${ingestStatus.latest_store_run.id} - ${ingestStatus.latest_store_run.status}` : "Chưa có"}</p>
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Sensor Tower (Store, VN)</h4>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                type="date"
                value={stRange.start_date}
                onChange={(e) => setStRange({ ...stRange, start_date: e.target.value })}
              />
              <input
                type="date"
                value={stRange.end_date}
                onChange={(e) => setStRange({ ...stRange, end_date: e.target.value })}
              />
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

          <h3 style={{ marginTop: 0 }}>Trạng thái hệ thống</h3>
          {health ? (
            <table>
              <tbody>
                <tr><td>LLM provider</td><td>{health.llm_provider}</td></tr>
                <tr><td>LLM sẵn sàng</td><td>{health.llm_ready ? "Có key" : "Chưa cấu hình, đang dùng fallback rule-based"}</td></tr>
                <tr><td>Prompt version</td><td>{health.prompt_version}</td></tr>
                <tr><td>Translation locale</td><td>zh-CN</td></tr>
              </tbody>
            </table>
          ) : <div className="empty-state">Đang tải...</div>}
        </div>
      </div>

      <div className="panel">
        <h3>Lịch sử Ingest</h3>
        {runs.length === 0 ? (
          <div className="empty-state">Chưa có lần nạp dữ liệu nào.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nguồn</th>
                  <th>Phạm vi dữ liệu</th>
                  <th>Trạng thái</th>
                  <th>Bắt đầu</th>
                  <th>Mới</th>
                  <th>Tổng lấy</th>
                  <th>Phân tích</th>
                  <th>Dịch zh-CN</th>
                  <th>Lỗi</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.id}</td>
                    <td>{sourceName(run.source_type)}</td>
                    <td>{runScope(run)}</td>
                    <td><StatusPill status={run.status} /></td>
                    <td>{formatDateTime(run.started_at)}</td>
                    <td>{run.rows_new}</td>
                    <td>{run.rows_fetched}</td>
                    <td><ProcessingBadge status={run.analysis_status} progress={run.analysis_progress} kind="analysis" /></td>
                    <td><ProcessingBadge status={run.translation_status} progress={run.translation_progress} kind="translation" /></td>
                    <td style={{ color: "var(--negative)", fontSize: 12 }}>{run.error || ""}</td>
                    <td>
                      {run.status === "done" && run.rows_new > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn btn-secondary" onClick={() => startAnalyze(run)}>Phân loại run #{run.id}</button>
                          <button className="btn btn-secondary" onClick={() => startTranslate(run)}>Dịch run #{run.id}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
