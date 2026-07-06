import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteIngestRun,
  getAnalyzeProgress,
  getHealth,
  getIngestStatus,
  getTranslateProgress,
  ingestFacebook,
  ingestSensorTower,
  listProcessingJobs,
  listRuns,
  previewCsv,
  runAnalyze,
  runTranslate,
  uploadCsv,
} from "../api/client.js";
import DateTextInput from "../components/DateTextInput.jsx";
import { StatusPill } from "../components/Badges.jsx";
import { formatDisplayDate, formatDisplayDateTime } from "../utils/dateFormat.js";

const FACEBOOK_POST_LIMIT = 50;

function useProgressPoll(progressKey, loader) {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!progressKey) return;
    let stop = false;
    let unknownTries = 0;
    const tick = () => {
      loader(progressKey).then((p) => {
        if (stop) return;
        setProgress(p);
        unknownTries = p.status === "unknown" ? unknownTries + 1 : 0;
        if (!["done", "failed"].includes(p.status) && unknownTries < 20) {
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
  return value ? formatDisplayDate(value) : null;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDisplayDateTime(value);
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
  if (run.data_start_date || run.data_end_date) {
    return `Dữ liệu: ${formatDate(run.data_start_date) || "?"} → ${formatDate(run.data_end_date) || "?"}`;
  }
  if (note.start_date || note.end_date) {
    return `Yêu cầu kéo: ${formatDate(note.start_date) || "?"} → ${formatDate(note.end_date) || "?"}`;
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

function jobLabel(kind) {
  return kind === "translation" ? "dịch zh-CN" : "phân tích";
}

function progressTitle(job, progress) {
  const label = jobLabel(job.kind);
  if (progress?.status === "queued") return `Đang chờ ${label}: ${runTitle(job.run)}`;
  if (progress?.status === "done") return `Đã ${label} xong: ${runTitle(job.run)}`;
  if (progress?.status === "failed") return `${label[0].toUpperCase()}${label.slice(1)} lỗi: ${runTitle(job.run)}`;
  return `Đang ${label}: ${runTitle(job.run)}`;
}

function TrackedProgressJob({ job, onComplete }) {
  const loader = job.kind === "translation" ? getTranslateProgress : getAnalyzeProgress;
  const progress = useProgressPoll(job.progressKey, loader);

  useEffect(() => {
    if (["done", "failed"].includes(progress?.status)) onComplete?.();
  }, [progress?.status, onComplete]);

  if (!progress) return null;
  return (
    <ProgressBlock
      title={progressTitle(job, progress)}
      progress={progress}
      color={job.kind === "translation" ? "var(--positive)" : "var(--accent)"}
      error={progress.error}
    />
  );
}

export default function IngestSettings() {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [trackedJobs, setTrackedJobs] = useState([]);

  const [stRange, setStRange] = useState({ start_date: "", end_date: "" });
  const [stBusy, setStBusy] = useState(false);
  const [stError, setStError] = useState(null);

  const [fbBusy, setFbBusy] = useState(false);
  const [fbError, setFbError] = useState(null);

  const [runs, setRuns] = useState([]);
  const [deletingRunId, setDeletingRunId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [health, setHealth] = useState(null);
  const [ingestStatus, setIngestStatus] = useState(null);

  const loadRuns = useCallback(() => {
    listRuns({ limit: 20 }).then(setRuns).catch(() => {});
  }, []);

  const loadTrackedJobs = useCallback(() => {
    listProcessingJobs({ limit: 20 })
      .then((jobs) => {
        enqueueTrackedJobs(jobs.map((job) => ({
          kind: job.job_type === "translation" ? "translation" : "analysis",
          progressKey: job.progress_key,
          run: job.run || { id: job.run_id },
        })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadRuns();
    loadTrackedJobs();
    getHealth().then(setHealth).catch(() => {});
    getIngestStatus().then(setIngestStatus).catch(() => {});
  }, [loadRuns, loadTrackedJobs]);

  function enqueueTrackedJobs(jobs) {
    setTrackedJobs((current) => {
      const byKey = new Map(current.map((job) => [job.progressKey, job]));
      for (const job of jobs) byKey.set(job.progressKey, job);
      return [...byKey.values()].slice(-12);
    });
  }

  function trackAutoProcessing(run) {
    const auto = run?.auto_processing;
    if (!auto?.queued) return false;
    enqueueTrackedJobs([
      { kind: "analysis", progressKey: auto.analysis_progress_key, run },
      ...(auto.translation_progress_key
        ? [{ kind: "translation", progressKey: auto.translation_progress_key, run }]
        : []),
    ]);
    return true;
  }

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
        trackAutoProcessing(run);
        loadRuns();
      })
      .catch((e) => setUploadError(e?.response?.data?.detail || e.message))
      .finally(() => setUploading(false));
  };

  const resolveRun = (run) => (typeof run === "object" ? run : runs.find((item) => item.id === run) || { id: run });

  const startAnalyze = (run) => {
    const target = resolveRun(run);
    runAnalyze({ run_id: target.id, only_unanalyzed: true })
      .then((r) => enqueueTrackedJobs([{ kind: "analysis", progressKey: r.progress_key, run: target }]));
  };

  const startTranslate = (run) => {
    const target = resolveRun(run);
    runTranslate({ run_id: target.id, locale: "zh-CN" })
      .then((r) => enqueueTrackedJobs([{ kind: "translation", progressKey: r.progress_key, run: target }]));
  };

  function deleteRun(run) {
    const answer = window.prompt(
      `Xóa Ingest #${run.id} sẽ xóa toàn bộ comment, phân tích, dịch zh-CN và memory/subtopic gắn với run này.\nGõ XOA để xác nhận.`
    );
    if (answer !== "XOA") return;
    setDeletingRunId(run.id);
    setDeleteError(null);
    deleteIngestRun(run.id)
      .then(() => {
        if (lastRun?.id === run.id) setLastRun(null);
        loadRuns();
      })
      .catch((e) => setDeleteError(e?.response?.data?.detail || e.message))
      .finally(() => setDeletingRunId(null));
  }

  const pullSensorTower = () => {
    setStBusy(true);
    setStError(null);
    ingestSensorTower(stRange)
      .then((run) => {
        setLastRun(run);
        trackAutoProcessing(run);
        loadRuns();
      })
      .catch((e) => setStError(e?.response?.data?.detail || e.message))
      .finally(() => setStBusy(false));
  };

  const pullFacebook = () => {
    setFbBusy(true);
    setFbError(null);
    ingestFacebook({
      since: stRange.start_date || undefined,
      until: stRange.end_date || undefined,
      post_limit: FACEBOOK_POST_LIMIT,
    })
      .then((run) => {
        setLastRun(run);
        trackAutoProcessing(run);
        loadRuns();
      })
      .catch((e) => setFbError(e?.response?.data?.detail || e.message))
      .finally(() => setFbBusy(false));
  };

  return (
    <>
      <h2 className="page-title">Ingest &amp; Cài đặt</h2>
      <p className="page-subtitle">Nạp dữ liệu mới; hệ thống tự xếp hàng phân loại LLM rồi dịch zh-CN.</p>
      <p className="queue-note">
        Sau mỗi lần kéo/upload thành công: Phân loại LLM -&gt; ghi nhớ chủ đề con -&gt; dịch zh-CN. Nút trong lịch sử chỉ dùng để chạy lại khi cần.
      </p>

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
              <p>
                Tổng <b>{preview.total_rows}</b> dòng; sẽ nhập <b>{preview.group_rows ?? preview.total_rows}</b> dòng Facebook Group.
              </p>
              {preview.skipped_non_group_rows > 0 && (
                <div className="warning-banner">
                  Bỏ qua {preview.skipped_non_group_rows} dòng không có cột A = Group (ví dụ Fanpage).
                </div>
              )}
              {preview.group_rows === 0 && (
                <div className="error-banner">
                  File này không có dòng Group hợp lệ, nên không thể nạp vào Facebook Group CSV.
                </div>
              )}
              {(preview.data_start_date || preview.data_end_date) && (
                <p className="progress-caption">
                  Khoảng thời gian Group trong file: <b>{formatDate(preview.data_start_date) || "?"}</b> → <b>{formatDate(preview.data_end_date) || "?"}</b>
                </p>
              )}
              <p className="progress-caption">Xem trước tối đa 10 dòng Group đầu tiên:</p>
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
              <button className="btn" disabled={uploading || preview.group_rows === 0} onClick={confirmUpload} style={{ marginTop: 12 }}>
                {uploading ? "Đang nạp..." : preview.group_rows === 0 ? "Không có dòng Group để nạp" : "Xác nhận nạp dữ liệu Group"}
              </button>
            </>
          )}

          {lastRun && (
            <div style={{ marginTop: 14 }}>
              <p>Đã nạp {lastRun.rows_new}/{lastRun.rows_fetched} dòng mới ({runTitle(lastRun)}). Hệ thống đã tự xếp hàng phân loại rồi dịch zh-CN.</p>
              <button className="btn btn-secondary" onClick={() => startAnalyze(lastRun)}>
                Chạy lại phân loại AI cho {runTitle(lastRun)}
              </button>
            </div>
          )}

          {trackedJobs.length > 0 && (
            <div className="processing-list">
              <p className="progress-caption"><b>Hàng đợi xử lý</b></p>
              {trackedJobs.map((job) => (
                <TrackedProgressJob key={job.progressKey} job={job} onComplete={loadRuns} />
              ))}
            </div>
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
              <DateTextInput
                value={stRange.start_date}
                onChange={(value) => setStRange({ ...stRange, start_date: value })}
              />
              <DateTextInput
                value={stRange.end_date}
                onChange={(value) => setStRange({ ...stRange, end_date: value })}
              />
            </div>
            <button className="btn" disabled={stBusy} onClick={pullSensorTower}>
              {stBusy ? "Đang kéo..." : "Kéo review Store"}
            </button>
            {stError && <div className="error-banner" style={{ marginTop: 8 }}>{stError}</div>}
          </div>

          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Facebook Fanpage (Graph API)</h4>
            <p className="progress-caption" style={{ marginTop: 0 }}>
              Dùng cùng khoảng ngày đang chọn ở trên.
            </p>
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
        {deleteError && <div className="error-banner">{deleteError}</div>}
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
                  <th className="run-actions-head">Thao tác</th>
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
                    <td className="run-actions-cell">
                      {run.status === "done" && run.rows_new > 0 && (
                        <div className="run-action-group">
                          <button className="btn btn-secondary run-action-button" onClick={() => startAnalyze(run)}>Phân loại #{run.id}</button>
                          <button className="btn btn-secondary run-action-button" onClick={() => startTranslate(run)}>Dịch #{run.id}</button>
                          <button className="btn btn-danger run-action-button" disabled={deletingRunId === run.id} onClick={() => deleteRun(run)}>
                            {deletingRunId === run.id ? "Đang xóa..." : `Xóa #${run.id}`}
                          </button>
                        </div>
                      )}
                      {(run.status !== "done" || run.rows_new <= 0) && (
                        <div className="run-action-group">
                          <button className="btn btn-danger run-action-button" disabled={deletingRunId === run.id} onClick={() => deleteRun(run)}>
                            {deletingRunId === run.id ? "Đang xóa..." : `Xóa #${run.id}`}
                          </button>
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
