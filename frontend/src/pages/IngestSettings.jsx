import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelProcessingJob,
  deleteIngestRun,
  getAnalyzeProgress,
  getHealth,
  getIngestStatus,
  getLlmAgentConfig,
  getTranslateProgress,
  ingestFacebook,
  ingestSensorTower,
  listProcessingJobLogs,
  listProcessingJobs,
  listRuns,
  previewCsv,
  runAnalyze,
  saveLlmAgentConfig,
  runTranslate,
  uploadCsv,
} from "../api/client.js";
import DateTextInput from "../components/DateTextInput.jsx";
import { StatusPill } from "../components/Badges.jsx";
import { formatDisplayDate, formatDisplayDateTime } from "../utils/dateFormat.js";

const FACEBOOK_POST_LIMIT = 50;
const providerOptions = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "custom", label: "Custom" },
];

const slotLabels = {
  reasoning: "Suy luận",
  simple: "Đơn giản",
};

function defaultSlotState(slot, llmConfig) {
  const saved = llmConfig?.configs?.find((item) => item.slot === slot);
  const fallback = llmConfig?.defaults?.[slot] || {};
  return {
    enabled: saved?.enabled || false,
    provider: saved?.provider || "custom",
    endpoint_url: saved?.endpoint_url || "",
    model: saved?.model || fallback.model || "",
    api_key: "",
    api_key_masked: saved?.api_key_masked || "",
    has_api_key: saved?.has_api_key || false,
    fallback_provider: fallback.provider || "",
    fallback_model: fallback.model || "",
  };
}

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
        if (!["done", "failed", "cancelled"].includes(p.status) && unknownTries < 20) {
          setTimeout(tick, 1200);
        }
      });
    };
    tick();
    return () => { stop = true; };
  }, [progressKey, loader]);

  return progress;
}

function useProcessingLogs(jobId, active) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = () => {
      listProcessingJobLogs(jobId, { limit: 8 })
        .then((items) => {
          if (!stop) setLogs(items);
        })
        .catch(() => {});
      if (active) setTimeout(tick, 2500);
    };
    tick();
    return () => { stop = true; };
  }, [jobId, active]);

  return logs;
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
  if (run.source_type === "fb_page" && (note.start_date || note.end_date)) {
    return `Yêu cầu kéo: ${formatDate(note.start_date) || "?"} → ${formatDate(note.end_date) || "?"}`;
  }
  if (run.data_start_date || run.data_end_date) {
    return `Dữ liệu: ${formatDate(run.data_start_date) || "?"} → ${formatDate(run.data_end_date) || "?"}`;
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

function analysisRunActionLabel(run) {
  const label = run.analysis_status === "done" ? "Phân tích lại" : "Phân tích";
  return `${label} #${run.id}`;
}

function translationRunActionLabel(run) {
  const label = run.translation_status === "done" ? "Dịch lại" : "Dịch";
  return `${label} #${run.id}`;
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

function ProgressBlock({ title, progress, color, error, action, children }) {
  return (
    <div className="processing-progress">
      <div className="progress-heading">
        <p><b>{title}</b></p>
        {action}
      </div>
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
      {children}
    </div>
  );
}

function formatLogDuration(ms) {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatLogModel(model) {
  if (!model) return "";
  const parts = String(model).split("/");
  return parts.at(-1) || String(model);
}

function ProcessingLogList({ logs }) {
  if (!logs?.length) {
    return <div className="llm-log-empty">Chưa có log LLM cho task này.</div>;
  }
  return (
    <div className="llm-log-list">
      {logs.map((log) => (
        <div className={`llm-log-row ${log.level}`} key={log.id}>
          <span className="llm-log-time">{formatDateTime(log.created_at)}</span>
          <span className="llm-log-message">{log.message}</span>
          <span className="llm-log-meta">
            {log.batch_index ? `Batch ${log.batch_index}/${log.batch_total || "?"}` : ""}
            {log.item_count ? ` · ${log.item_count} comment` : ""}
            {log.provider ? ` · ${log.provider}` : ""}
            {log.model ? ` · ${formatLogModel(log.model)}` : ""}
            {log.duration_ms != null ? ` · ${formatLogDuration(log.duration_ms)}` : ""}
          </span>
          {log.error && <span className="llm-log-error">{log.error}</span>}
        </div>
      ))}
    </div>
  );
}

const DEFAULT_SOURCE_STATUS = [
  { key: "store", label: "Store", latest_data_date: null, cursor_date: null, latest_run: null },
  { key: "facebook_page", label: "Fanpage", latest_data_date: null, cursor_date: null, latest_run: null },
  { key: "facebook_group", label: "Group CSV", latest_data_date: null, cursor_date: null, latest_run: null },
];

function SourceStatusStrip({ ingestStatus }) {
  const rows = ingestStatus?.source_status?.length ? ingestStatus.source_status : DEFAULT_SOURCE_STATUS;
  return (
    <div className="source-status-strip" role="status" aria-label="Trạng thái dữ liệu mới nhất">
      <div className="source-status-title">Dữ liệu mới nhất</div>
      {rows.map((row) => (
        <div className="source-status-item" key={row.key}>
          <span>{row.label}</span>
          <b>{formatDate(row.latest_data_date) || "Chưa có dữ liệu"}</b>
          {row.latest_run?.id && <small>Run #{row.latest_run.id} · {row.latest_run.status}</small>}
        </div>
      ))}
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
  if (progress?.status === "cancelled") return `Đã hủy ${label}: ${runTitle(job.run)}`;
  if (progress?.status === "failed") return `${label[0].toUpperCase()}${label.slice(1)} lỗi: ${runTitle(job.run)}`;
  return `Đang ${label}: ${runTitle(job.run)}`;
}

function canCancelTrackedJob(job, progress) {
  return Boolean(job?.id && progress && !["done", "cancelled"].includes(progress.status));
}

function TrackedProgressJob({ job, onComplete, onDone, onCancel, cancelling }) {
  const loader = job.kind === "translation" ? getTranslateProgress : getAnalyzeProgress;
  const progress = useProgressPoll(job.progressKey, loader);
  const isTerminal = ["done", "failed", "cancelled"].includes(progress?.status);
  const logs = useProcessingLogs(job.id, !isTerminal);
  const jobId = job.id;
  const progressKey = job.progressKey;

  useEffect(() => {
    if (!isTerminal) return;
    onComplete?.();
    if (progress?.status !== "done") return;
    const timer = setTimeout(() => onDone?.({ id: jobId, progressKey }), 800);
    return () => clearTimeout(timer);
  }, [isTerminal, progress?.status, onComplete, onDone, jobId, progressKey]);

  if (!progress) return null;
  const canCancel = canCancelTrackedJob(job, progress);
  return (
    <ProgressBlock
      title={progressTitle(job, progress)}
      progress={progress}
      color={job.kind === "translation" ? "var(--positive)" : "var(--accent)"}
      error={progress.error}
      action={canCancel ? (
        <button
          className="btn btn-danger progress-cancel-button"
          disabled={cancelling}
          onClick={() => onCancel(job)}
        >
          {cancelling ? "Đang hủy..." : "Hủy"}
        </button>
      ) : null}
    >
      {job.id && <ProcessingLogList logs={logs} />}
    </ProgressBlock>
  );
}

function LlmAgentSlotForm({ slot, llmConfig, saving, error, onSave }) {
  const [form, setForm] = useState(() => defaultSlotState(slot, llmConfig));

  useEffect(() => {
    setForm(defaultSlotState(slot, llmConfig));
  }, [slot, llmConfig]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    onSave(slot, {
      enabled: form.enabled,
      provider: form.provider,
      endpoint_url: form.endpoint_url,
      model: form.model,
      ...(form.api_key.trim() ? { api_key: form.api_key.trim() } : {}),
    });
  };

  return (
    <form className="llm-config-slot" onSubmit={submit}>
      <div className="llm-config-slot-head">
        <div>
          <h4>{slotLabels[slot]}</h4>
          <small>Default: {form.fallback_provider || "worker"} · {form.fallback_model || "—"}</small>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => update("enabled", event.target.checked)}
          />
          <span>Bật override</span>
        </label>
      </div>

      <div className="llm-config-grid">
        <label>
          <span>Provider</span>
          <select value={form.provider} onChange={(event) => update("provider", event.target.value)}>
            {providerOptions.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Model</span>
          <input value={form.model} onChange={(event) => update("model", event.target.value)} placeholder="model-name" />
        </label>
        <label>
          <span>Endpoint</span>
          <input
            value={form.endpoint_url}
            onChange={(event) => update("endpoint_url", event.target.value)}
            placeholder={form.provider === "custom" ? "https://host/v1" : "Mặc định provider"}
          />
        </label>
        <label>
          <span>API key</span>
          <input
            type="password"
            value={form.api_key}
            onChange={(event) => update("api_key", event.target.value)}
            placeholder={form.api_key_masked || "Giữ trống để không đổi"}
            autoComplete="off"
          />
        </label>
      </div>

      {error && <div className="error-banner">{error}</div>}
      <div className="llm-config-actions">
        <span>{form.has_api_key ? `Đã lưu key ${form.api_key_masked}` : "Chưa có key riêng"}</span>
        <button className="btn btn-secondary" disabled={saving} type="submit">
          {saving ? "Đang lưu..." : `Lưu ${slotLabels[slot]}`}
        </button>
      </div>
    </form>
  );
}

function LlmAgentConfigDialog({ open, llmConfig, loading, savingSlot, error, onClose, onSave }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel llm-config-dialog" role="dialog" aria-modal="true" aria-label="Cấu hình LLM Agent">
        <div className="modal-header">
          <div>
            <h3>Cấu hình LLM Agent</h3>
            <p>Phân tích dùng Suy luận; dịch zh-CN dùng Đơn giản.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={onClose}>Đóng</button>
        </div>
        {loading ? (
          <div className="empty-state">Đang tải cấu hình...</div>
        ) : (
          <div className="llm-config-stack">
            <LlmAgentSlotForm
              slot="reasoning"
              llmConfig={llmConfig}
              saving={savingSlot === "reasoning"}
              error={error?.slot === "reasoning" ? error.message : null}
              onSave={onSave}
            />
            <LlmAgentSlotForm
              slot="simple"
              llmConfig={llmConfig}
              saving={savingSlot === "simple"}
              error={error?.slot === "simple" ? error.message : null}
              onSave={onSave}
            />
          </div>
        )}
      </div>
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
  const [trackedJobs, setTrackedJobs] = useState([]);
  const [cancellingJobIds, setCancellingJobIds] = useState(new Set());
  const [processingError, setProcessingError] = useState(null);

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
  const [llmConfigOpen, setLlmConfigOpen] = useState(false);
  const [llmConfig, setLlmConfig] = useState(null);
  const [llmConfigLoading, setLlmConfigLoading] = useState(false);
  const [llmSavingSlot, setLlmSavingSlot] = useState(null);
  const [llmConfigError, setLlmConfigError] = useState(null);

  const loadRuns = useCallback(() => {
    listRuns({ limit: 20 }).then(setRuns).catch(() => {});
  }, []);

  const loadIngestStatus = useCallback(() => {
    getIngestStatus().then(setIngestStatus).catch(() => {});
  }, []);

  const loadLlmConfig = useCallback(() => {
    setLlmConfigLoading(true);
    getLlmAgentConfig()
      .then(setLlmConfig)
      .catch((e) => setLlmConfigError({ slot: "global", message: e?.response?.data?.detail || e.message }))
      .finally(() => setLlmConfigLoading(false));
  }, []);

  const loadTrackedJobs = useCallback(() => {
    listProcessingJobs({ limit: 20 })
      .then((jobs) => {
        enqueueTrackedJobs(jobs.map((job) => ({
          id: job.id,
          kind: job.job_type === "translation" ? "translation" : "analysis",
          progressKey: job.progress_key,
          status: job.status,
          run: job.run || { id: job.run_id },
        })));
      })
      .catch(() => {});
  }, []);

  const refreshAfterProcessing = useCallback(() => {
    loadRuns();
    loadIngestStatus();
  }, [loadRuns, loadIngestStatus]);

  useEffect(() => {
    loadRuns();
    loadTrackedJobs();
    getHealth().then(setHealth).catch(() => {});
    loadIngestStatus();
    loadLlmConfig();
  }, [loadRuns, loadTrackedJobs, loadIngestStatus, loadLlmConfig]);

  function openLlmConfig() {
    setLlmConfigError(null);
    setLlmConfigOpen(true);
    loadLlmConfig();
  }

  function saveLlmConfigSlot(slot, payload) {
    setLlmSavingSlot(slot);
    setLlmConfigError(null);
    saveLlmAgentConfig(slot, payload)
      .then(() => loadLlmConfig())
      .catch((e) => setLlmConfigError({ slot, message: e?.response?.data?.detail || e.message }))
      .finally(() => setLlmSavingSlot(null));
  }

  function enqueueTrackedJobs(jobs) {
    setTrackedJobs((current) => {
      const byKey = new Map(current.map((job) => [job.progressKey, job]));
      for (const job of jobs) byKey.set(job.progressKey, { ...byKey.get(job.progressKey), ...job });
      return [...byKey.values()].slice(-12);
    });
  }

  function cancelTrackedJob(job) {
    if (!job.id) return;
    const answer = window.confirm(`Hủy task ${jobLabel(job.kind)} cho ${runTitle(job.run)}?`);
    if (!answer) return;
    setProcessingError(null);
    setCancellingJobIds((current) => new Set(current).add(job.id));
    cancelProcessingJob(job.id)
      .then(() => {
        setTrackedJobs((current) => current.filter((item) => item.id !== job.id && item.progressKey !== job.progressKey));
        loadTrackedJobs();
        refreshAfterProcessing();
      })
      .catch((e) => setProcessingError(e?.response?.data?.detail || e.message))
      .finally(() => {
        setCancellingJobIds((current) => {
          const next = new Set(current);
          next.delete(job.id);
          return next;
        });
      });
  }

  function hideCompletedTrackedJob(job) {
    setTrackedJobs((current) => (
      current.filter((item) => item.id !== job.id && item.progressKey !== job.progressKey)
    ));
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
        loadTrackedJobs();
        loadRuns();
        loadIngestStatus();
      })
      .catch((e) => setUploadError(e?.response?.data?.detail || e.message))
      .finally(() => setUploading(false));
  };

  const resolveRun = (run) => (typeof run === "object" ? run : runs.find((item) => item.id === run) || { id: run });

  const startAnalyze = (run) => {
    const target = resolveRun(run);
    runAnalyze({ run_id: target.id, only_unanalyzed: true })
      .then((r) => {
        enqueueTrackedJobs([{ kind: "analysis", progressKey: r.progress_key, run: target }]);
        loadTrackedJobs();
      });
  };

  const startTranslate = (run) => {
    const target = resolveRun(run);
    runTranslate({ run_id: target.id, locale: "zh-CN" })
      .then((r) => {
        enqueueTrackedJobs([{ kind: "translation", progressKey: r.progress_key, run: target }]);
        loadTrackedJobs();
      });
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
        loadIngestStatus();
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
        loadTrackedJobs();
        loadRuns();
        loadIngestStatus();
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
        loadTrackedJobs();
        loadRuns();
        loadIngestStatus();
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
      <SourceStatusStrip ingestStatus={ingestStatus} />

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
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Post Published Date</th>
                    <th>Post Message</th>
                    <th>Created Date</th>
                    <th>Comment Message</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, index) => (
                    <tr key={index}>
                      <td>{row.source}</td>
                      <td>{row.post_published_date}</td>
                      <td className="msg-preview">{row.post_message}</td>
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
              {processingError && <div className="error-banner">{processingError}</div>}
              {trackedJobs.map((job) => (
                <TrackedProgressJob
                  key={job.progressKey}
                  job={job}
                  onComplete={refreshAfterProcessing}
                  onDone={hideCompletedTrackedJob}
                  onCancel={cancelTrackedJob}
                  cancelling={job.id ? cancellingJobIds.has(job.id) : false}
                />
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
          <div className="system-actions">
            <button className="btn btn-secondary" type="button" onClick={openLlmConfig}>
              Cấu hình LLM Agent
            </button>
          </div>
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
                          <button className="btn btn-secondary run-action-button" onClick={() => startAnalyze(run)}>{analysisRunActionLabel(run)}</button>
                          <button className="btn btn-secondary run-action-button" onClick={() => startTranslate(run)}>{translationRunActionLabel(run)}</button>
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
      <LlmAgentConfigDialog
        open={llmConfigOpen}
        llmConfig={llmConfig}
        loading={llmConfigLoading}
        savingSlot={llmSavingSlot}
        error={llmConfigError}
        onClose={() => setLlmConfigOpen(false)}
        onSave={saveLlmConfigSlot}
      />
    </>
  );
}
