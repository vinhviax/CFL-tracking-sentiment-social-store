import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelProcessingJob,
  deleteIngestRun,
  getAdminStatus,
  getAnalyzeProgress,
  getHealth,
  getIngestStatus,
  getLlmAgentConfig,
  getTokenUsage,
  getTranslateProgress,
  ingestFacebook,
  ingestSensorTower,
  listProcessingJobLogs,
  listProcessingJobs,
  listRuns,
  runAnalyze,
  saveLlmAgentConfig,
  runTranslate,
  unlockAdmin,
  uploadCsv,
} from "../api/client.js";
import DateTextInput from "../components/DateTextInput.jsx";
import { clearAdminKey, setAdminKey } from "../utils/adminSession.js";
import {
  formatTokens,
  processingJobCaption,
  processingJobNote,
  processingJobPhase,
  shortModelName,
  slotEscalationNote,
  tokenUsageState,
  totalTokens,
  usageModelLabel,
} from "./IngestSettings.helpers.js";
import { previewCsvFile } from "../utils/facebookCsv.js";
import { getByoConfig, setByoConfig } from "../utils/llmSession.js";
import { StatusPill } from "../components/Badges.jsx";
import { formatDisplayDate, formatDisplayDateTime } from "../utils/dateFormat.js";

const slotLabels = {
  reasoning: "Suy luận",
  simple: "Đơn giản",
};

/** Tooltip on every control the lock disables, so a viewer knows why it is greyed. */
const READ_ONLY_HINT = "Chế độ chỉ xem — cần mật khẩu quản trị để thao tác.";

/**
 * Read-only vs. unlocked for this tab.
 *
 * The Worker is the authority (it rejects the writes outright), so this only asks it
 * what mode the tab is in. Until the answer arrives the page renders read-only, which
 * is the safe way round: a viewer never sees controls flash as usable.
 */
function useAdminLock() {
  const [status, setStatus] = useState(null);

  const refresh = useCallback(
    () =>
      getAdminStatus()
        .then((next) => {
          // A key that no longer works (password rotated) is dead weight that would
          // keep riding on every request; drop it so the unlock form is the way back.
          if (next.lock_enabled && !next.authorized) clearAdminKey();
          setStatus(next);
          return next;
        })
        .catch(() => {
          // An older Worker has no /api/admin/status. Treat it as no lock rather than
          // locking the owner out of their own workspace over a version skew.
          setStatus({ lock_enabled: false, authorized: true, unknown: true });
          return null;
        }),
    []
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const unlock = useCallback(
    (password) =>
      unlockAdmin(password).then((next) => {
        setAdminKey(password);
        setStatus(next);
        return next;
      }),
    []
  );

  const lock = useCallback(() => {
    clearAdminKey();
    refresh();
  }, [refresh]);

  return {
    status,
    // Unknown state counts as read-only: see above.
    readOnly: !status || (status.lock_enabled && !status.authorized),
    lockEnabled: Boolean(status?.lock_enabled),
    unknown: Boolean(status?.unknown),
    unlock,
    lock,
    refresh,
  };
}

function AdminLockBar({ lock }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    lock
      .unlock(password)
      .then(() => {
        setOpen(false);
        setPassword("");
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message))
      .finally(() => setBusy(false));
  };

  if (!lock.status) return null;

  // No password configured on the Worker: everyone with the link can pull, re-analyse
  // and delete. Said plainly, because the fix is one command and only the owner can run it.
  if (!lock.lockEnabled) {
    return (
      <div className="admin-lock-bar admin-lock-open">
        <span className="admin-lock-pill open">Chưa khóa</span>
        <span className="admin-lock-text">
          {lock.unknown
            ? "Worker chưa có API khóa quản trị — deploy bản mới để bật chế độ chỉ xem."
            : "Chưa đặt mật khẩu quản trị: ai có link cũng kéo dữ liệu, chạy lại LLM và xóa run được."}
          {" "}Đặt bằng <code>npx wrangler secret put ADMIN_PASSWORD</code> trong thư mục <code>worker/</code>.
        </span>
      </div>
    );
  }

  if (!lock.readOnly) {
    return (
      <div className="admin-lock-bar admin-lock-unlocked">
        <span className="admin-lock-pill unlocked">Đang mở khóa</span>
        <span className="admin-lock-text">
          Bạn thao tác được trên trang này. Mật khẩu chỉ nằm trong tab này; đóng tab là mất.
        </span>
        <button type="button" className="btn btn-secondary run-action-button" onClick={lock.lock}>
          Khóa lại
        </button>
      </div>
    );
  }

  return (
    <div className="admin-lock-bar admin-lock-readonly">
      <span className="admin-lock-pill readonly">Chỉ xem</span>
      <span className="admin-lock-text">
        Bạn xem được toàn bộ trạng thái, lịch sử và token. Kéo dữ liệu, chạy lại LLM, đổi cấu
        hình và xóa run cần mật khẩu quản trị.
      </span>
      {open ? (
        <form className="admin-lock-form" onSubmit={submit}>
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            placeholder="Mật khẩu quản trị"
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit" className="btn run-action-button" disabled={busy || !password.trim()}>
            {busy ? "Đang mở..." : "Mở khóa"}
          </button>
          <button
            type="button"
            className="btn btn-secondary run-action-button"
            onClick={() => { setOpen(false); setError(null); }}
          >
            Hủy
          </button>
        </form>
      ) : (
        <button type="button" className="btn btn-secondary run-action-button" onClick={() => setOpen(true)}>
          Mở khóa chỉnh sửa
        </button>
      )}
      {error && <div className="error-banner admin-lock-error">{error}</div>}
    </div>
  );
}

/** What this tab already holds for a BYO provider, so F5 does not wipe the form. */
function sessionDraft(slot, providerId) {
  const stored = getByoConfig(slot);
  if (!stored || stored.provider !== providerId) return { model: "", api_key: "", endpoint_url: "" };
  return {
    model: stored.model || "",
    api_key: stored.api_key || "",
    endpoint_url: stored.endpoint_url || "",
  };
}

/**
 * Opening state for a slot's form.
 *
 * A BYO config from this tab's sessionStorage wins, because it is what requests are
 * currently carrying. Otherwise the saved server-side selection, otherwise the
 * default. Nothing here ever holds a real endpoint for a non-Custom provider — the
 * server does not send one.
 */
function defaultSlotState(slot, llmConfig) {
  const session = getByoConfig(slot);
  if (session?.provider) {
    return {
      provider: session.provider,
      model: session.model || "",
      api_key: session.api_key || "",
      endpoint_url: session.endpoint_url || "",
      provider_label: "",
    };
  }
  const saved = llmConfig?.configs?.find((item) => item.slot === slot);
  const fallback = llmConfig?.defaults?.[slot] || {};
  return {
    provider: saved?.provider || fallback.provider || "openai_viax",
    model: saved?.model || fallback.model || "",
    api_key: "",
    endpoint_url: "",
    provider_label: saved?.provider_label || fallback.provider_label || "",
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
  if (sourceType === "facebook_csv") return "Facebook CSV";
  return sourceType || "Không rõ nguồn";
}

const RUNS_PER_PAGE = 50;

// Bộ lọc lịch sử ingest theo nhóm nguồn. Dữ liệu Group nằm trong lần upload CSV
// (source_type = facebook_csv / fb_group_csv), Fanpage kéo qua Graph API (fb_page).
const RUN_SOURCE_FILTERS = [
  { key: "all", label: "Tất cả", types: null },
  { key: "store", label: "Store", types: ["store"] },
  { key: "fanpage", label: "Fanpage", types: ["fb_page"] },
  { key: "group", label: "Group", types: ["facebook_csv", "fb_group_csv"] },
];

/** Last 7 days inclusive, as the token panel's opening range. */
function defaultTokenRange() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(today) };
}

function runScope(run) {
  if (!run) return "Chưa rõ phạm vi";
  const note = parseRunNote(run.note);
  if ((run.source_type === "fb_page" || run.source_type === "store") && (note.start_date || note.end_date)) {
    return `Yêu cầu kéo: ${formatDate(note.start_date) || "?"} → ${formatDate(note.end_date) || "?"}`;
  }
  if (run.data_start_date || run.data_end_date) {
    return `Dữ liệu: ${formatDate(run.data_start_date) || "?"} → ${formatDate(run.data_end_date) || "?"}`;
  }
  if (note.text) return note.text;
  return `Ngày kéo: ${formatDate(run.started_at) || "—"}`;
}

function runTitle(run) {
  // A job started from an explicit comment list belongs to no run, which used to
  // render as "Run #null · Không rõ nguồn".
  if (!run?.id) return "Task lẻ theo danh sách comment";
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

/**
 * Token spend for one job on one run. See tokenUsageState for why "no batches",
 * "batches but no usage reported" and "partially reported" are three distinct cases.
 *
 * `processed` says whether the job itself finished for this run, which is what
 * separates the two ways of having no batches: never ran, or ran under a job that
 * belongs to no run (an ad-hoc comment_ids job, whose tokens cannot be attributed
 * to any run). Rendering both as an empty cell made a finished translation look
 * like nothing had happened.
 */
function TokenUsageNote({ usage, processed }) {
  const state = tokenUsageState(usage);
  if (state === "none") {
    if (!processed) return null;
    return (
      <span
        className="token-note token-note-missing"
        title="Việc này chạy bởi task theo danh sách comment (không thuộc run nào), nên token của nó chỉ hiện ở bảng Token đã dùng theo khoảng ngày"
      >
        Token: thuộc task lẻ
      </span>
    );
  }
  if (state === "missing") {
    return (
      <span
        className="token-note token-note-missing"
        title={`${usage.batches} batch đã chạy nhưng không batch nào trả về số token`}
      >
        Token: chưa ghi nhận
      </span>
    );
  }
  const partial = state === "partial";
  const models = usageModelLabel(usage);
  return (
    <span
      className="token-note"
      title={`${usage.batches_with_usage}/${usage.batches} batch có số token${partial ? " — tổng hiển thị là chưa đủ" : ""}`}
    >
      ↑{formatTokens(usage.input_tokens)} ↓{formatTokens(usage.output_tokens)} token
      {partial ? " (một phần)" : ""}
      {models && <span className="token-note-model">{models}</span>}
    </span>
  );
}

/**
 * Total token spend over a date range, split by model.
 *
 * Counts every logged batch, including the scheduled catch-up pass that belongs
 * to no ingest run — that spend is real even though no run row shows it.
 */
function TokenUsagePanel({ range, onRangeChange, usage, loading, error, onReload }) {
  const total = usage?.total;
  const models = usage?.by_model || [];
  const state = tokenUsageState(total);
  const recorded = total?.batches_with_usage || 0;
  const batches = total?.batches || 0;

  return (
    <div className="token-panel">
      <div className="token-panel-head">
        <span className="token-panel-title">Token đã dùng</span>
        <DateTextInput value={range.from} onChange={(value) => onRangeChange({ ...range, from: value })} />
        <span className="token-panel-sep">→</span>
        <DateTextInput value={range.to} onChange={(value) => onRangeChange({ ...range, to: value })} />
        <button type="button" className="btn btn-secondary run-action-button" disabled={loading} onClick={onReload}>
          {loading ? "Đang tính..." : "Làm mới"}
        </button>
      </div>

      {error && <div className="error-banner" style={{ marginTop: 8 }}>{error}</div>}

      {!error && !loading && (
        state === "none" ? (
          <div className="token-panel-empty">Không có batch LLM nào trong khoảng này.</div>
        ) : state === "missing" ? (
          <div className="token-panel-empty">
            {formatTokens(batches)} batch trong khoảng này, nhưng chưa batch nào ghi nhận token
            (chỉ các lần chạy sau khi bật đo token mới có số).
          </div>
        ) : (
          <>
            <div className="token-panel-total">
              <span className="token-strong">↑ {formatTokens(total.input_tokens)}</span> input
              <span className="token-panel-dot">·</span>
              <span className="token-strong">↓ {formatTokens(total.output_tokens)}</span> output
              <span className="token-panel-dot">·</span>
              {formatTokens(totalTokens(total))} tổng
            </div>
            {state === "partial" && (
              <div className="token-panel-warn">
                Chỉ {formatTokens(recorded)}/{formatTokens(batches)} batch có số token — tổng trên là chưa đủ.
              </div>
            )}
            <table className="token-panel-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Việc</th>
                  <th>Input</th>
                  <th>Output</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={`${m.job_type}|${m.model}`}>
                    <td title={m.model || ""}>{shortModelName(m.model)}</td>
                    <td>{m.job_type === "translation" ? "Dịch" : "Phân tích"}</td>
                    <td>{formatTokens(m.input_tokens)}</td>
                    <td>{formatTokens(m.output_tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      )}
    </div>
  );
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

function ProgressBlock({ title, progress, color, error, action, caption, note, children }) {
  return (
    <div className="processing-progress">
      <div className="progress-heading">
        <p><b>{title}</b></p>
        {action}
      </div>
      <p className="progress-caption">
        {caption ?? `${progress.done ?? 0}/${progress.total ?? 0} comment${progress.provider ? ` · Provider: ${progress.provider}` : ""}`}
      </p>
      {note && <p className="progress-caption">{note}</p>}
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

function formatConfigModelName(model) {
  if (!model) return "—";
  const parts = String(model).split("/");
  return parts.at(-1) || String(model);
}

function ProcessingLogList({ logs, phase }) {
  if (!logs?.length) {
    return (
      <div className="llm-log-empty">
        {phase === "waiting"
          ? "Chưa chạy nên chưa có log — task đang chờ tới lượt."
          : "Chưa có log LLM cho task này."}
      </div>
    );
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

function sourceStatusDate(row) {
  const note = parseRunNote(row.latest_run?.note);
  if (note.end_date && (!row.latest_data_date || note.end_date > row.latest_data_date)) return note.end_date;
  return row.latest_data_date;
}

function SourceStatusStrip({ ingestStatus }) {
  const rows = ingestStatus?.source_status?.length ? ingestStatus.source_status : DEFAULT_SOURCE_STATUS;
  return (
    <div className="source-status-strip" role="status" aria-label="Trạng thái dữ liệu mới nhất">
      <div className="source-status-title">Dữ liệu mới nhất</div>
      {rows.map((row) => (
        <div className="source-status-item" key={row.key}>
          <span>{row.label}</span>
          <b>{formatDate(sourceStatusDate(row)) || "Chưa có dữ liệu"}</b>
          {row.latest_run?.id && <small>Run #{row.latest_run.id} · {row.latest_run.status}</small>}
        </div>
      ))}
    </div>
  );
}

function jobLabel(kind) {
  return kind === "translation" ? "dịch zh-CN" : "phân tích";
}

function progressTitle(job, phase) {
  const label = jobLabel(job.kind);
  const run = runTitle(job.run);
  if (phase === "waiting") return `Đang xếp hàng, chưa tới lượt ${label}: ${run}`;
  if (phase === "paused") return `Tạm dừng giữa lượt, sẽ tự chạy tiếp ${label}: ${run}`;
  if (phase === "stalled") return `${label[0].toUpperCase()}${label.slice(1)} chưa có tiến triển mới: ${run}`;
  if (phase === "done") return `Đã ${label} xong: ${run}`;
  if (phase === "cancelled") return `Đã hủy ${label}: ${run}`;
  if (phase === "failed") return `${label[0].toUpperCase()}${label.slice(1)} lỗi: ${run}`;
  return `Đang ${label}: ${run}`;
}

function canCancelTrackedJob(job, progress) {
  return Boolean(job?.id && progress && !["done", "cancelled"].includes(progress.status));
}

function TrackedProgressJob({ job, onComplete, onDone, onCancel, cancelling, readOnly }) {
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
  const phase = processingJobPhase(progress, logs);
  return (
    <ProgressBlock
      title={progressTitle(job, phase)}
      progress={progress}
      caption={processingJobCaption(progress, phase)}
      note={processingJobNote(phase)}
      color={job.kind === "translation" ? "var(--positive)" : "var(--accent)"}
      error={progress.error}
      action={canCancel ? (
        <button
          className="btn btn-danger progress-cancel-button"
          disabled={cancelling || readOnly}
          title={readOnly ? READ_ONLY_HINT : undefined}
          onClick={() => onCancel(job)}
        >
          {cancelling ? "Đang hủy..." : "Hủy"}
        </button>
      ) : null}
    >
      {job.id && <ProcessingLogList logs={logs} phase={phase} />}
    </ProgressBlock>
  );
}

function LlmAgentSlotForm({ slot, llmConfig, saving, error, onSave, onSaveSession, readOnly }) {
  const [form, setForm] = useState(() => defaultSlotState(slot, llmConfig));

  useEffect(() => {
    setForm(defaultSlotState(slot, llmConfig));
  }, [slot, llmConfig]);

  const providers = llmConfig?.providers || [];
  const spec = providers.find((p) => p.id === form.provider) || null;
  const fallback = llmConfig?.defaults?.[slot];

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const selectProvider = (providerId) => {
    const next = providers.find((p) => p.id === providerId);
    setForm((current) => ({
      ...current,
      provider: providerId,
      // Move to a model the new provider actually offers rather than carrying over
      // one that belongs to a different provider — the old form's main trap.
      model: next?.models?.length ? next.models[0] : sessionDraft(slot, providerId).model,
      endpoint_url: providerId === "custom" ? sessionDraft(slot, providerId).endpoint_url : "",
      api_key: next?.byo ? sessionDraft(slot, providerId).api_key : "",
    }));
  };

  const submit = (event) => {
    event.preventDefault();
    if (spec?.byo) {
      onSaveSession(slot, {
        provider: form.provider,
        model: form.model.trim(),
        api_key: form.api_key.trim(),
        endpoint_url: form.endpoint_url.trim(),
      });
      return;
    }
    onSave(slot, { provider: form.provider, model: form.model });
  };

  const byoReady = !spec?.byo
    || (form.model.trim() && form.api_key.trim() && (form.provider !== "custom" || form.endpoint_url.trim()));
  const escalationNote = slotEscalationNote(llmConfig?.configs?.find((item) => item.slot === slot));

  return (
    <form className="llm-config-slot" onSubmit={submit}>
      <div className="llm-config-slot-head">
        <div>
          <h4>{slotLabels[slot]}</h4>
          <small>
            Mặc định: {fallback?.provider_label || "—"} · {fallback?.model_label || "—"}
          </small>
          {escalationNote && <small className="llm-escalation-note">{escalationNote}</small>}
        </div>
        {spec?.byo && (
          <span className="llm-session-tag" title="Key của bạn chỉ nằm trong tab này, không lưu lên hệ thống">
            Chỉ trong tab này
          </span>
        )}
      </div>

      {/* A viewer may read which provider and model each slot runs on — no secret is
          ever sent here — but not change either, so the whole grid is disabled rather
          than only the submit. */}
      <fieldset className="llm-config-grid" disabled={readOnly}>
        <label>
          <span>Provider</span>
          <select value={form.provider} onChange={(event) => selectProvider(event.target.value)}>
            {providers.map((option) => (
              <option value={option.id} key={option.id}>{option.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Model</span>
          {spec?.models?.length ? (
            <select value={form.model} onChange={(event) => update("model", event.target.value)}>
              {spec.model_options.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          ) : (
            <input
              value={form.model}
              onChange={(event) => update("model", event.target.value)}
              placeholder="Tên model của bạn"
              autoComplete="off"
            />
          )}
        </label>

        {spec?.needs_endpoint && (
          <label>
            <span>Endpoint</span>
            <input
              value={form.endpoint_url}
              onChange={(event) => update("endpoint_url", event.target.value)}
              placeholder="https://..."
              autoComplete="off"
            />
          </label>
        )}

        {spec?.needs_api_key && (
          <label>
            <span>API key</span>
            <input
              type="password"
              value={form.api_key}
              onChange={(event) => update("api_key", event.target.value)}
              placeholder="Key của bạn, chỉ giữ trong tab này"
              autoComplete="off"
            />
          </label>
        )}
      </fieldset>

      {error && <div className="error-banner">{error}</div>}
      <div className="llm-config-actions">
        <span>
          {readOnly
            ? READ_ONLY_HINT
            : spec?.byo
              ? "Không lưu lên hệ thống. F5 vẫn còn; mở tab mới thì mất."
              : `Đang dùng: ${form.provider_label || spec?.label || "—"} · ${formatConfigModelName(form.model)}`}
        </span>
        <button
          className="btn btn-secondary"
          disabled={saving || !byoReady || readOnly}
          title={readOnly ? READ_ONLY_HINT : undefined}
          type="submit"
        >
          {saving ? "Đang lưu..." : `Áp dụng ${slotLabels[slot]}`}
        </button>
      </div>
    </form>
  );
}

function LlmAgentConfigDialog({ open, llmConfig, loading, savingSlot, error, onClose, onSave, onSaveSession, readOnly }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel llm-config-dialog" role="dialog" aria-modal="true" aria-label="Cấu hình LLM Agent">
        <div className="modal-header">
          <div>
            <h3>Cấu hình LLM Agent</h3>
            <p>
              Phân tích dùng Suy luận; dịch zh-CN dùng Đơn giản. Provider tự nhập key chỉ
              áp dụng cho tab này — việc chạy nền và cron vẫn dùng provider đã lưu.
            </p>
            {readOnly && <p className="admin-lock-text">{READ_ONLY_HINT}</p>}
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
              onSaveSession={onSaveSession}
              readOnly={readOnly}
            />
            <LlmAgentSlotForm
              slot="simple"
              llmConfig={llmConfig}
              saving={savingSlot === "simple"}
              error={error?.slot === "simple" ? error.message : null}
              onSave={onSave}
              onSaveSession={onSaveSession}
              readOnly={readOnly}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function IngestSettings() {
  const adminLock = useAdminLock();
  const readOnly = adminLock.readOnly;
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
  const [runSourceFilter, setRunSourceFilter] = useState("all");
  const [runPage, setRunPage] = useState(0);
  const [tokenRange, setTokenRange] = useState(() => defaultTokenRange());
  const [tokenUsage, setTokenUsage] = useState(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState(null);
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
    listRuns({ limit: 500 }).then(setRuns).catch(() => {});
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
          run: job.run,
        })));
      })
      .catch(() => {});
  }, []);

  const loadTokenUsage = useCallback(() => {
    // Both bounds are required: an open-ended range would silently total every
    // batch ever logged, which is not what the date filter is for.
    if (!tokenRange.from || !tokenRange.to) return;
    setTokenLoading(true);
    setTokenError(null);
    getTokenUsage({ from: tokenRange.from, to: tokenRange.to })
      .then(setTokenUsage)
      .catch((e) => setTokenError(e?.response?.data?.detail || e.message))
      .finally(() => setTokenLoading(false));
  }, [tokenRange.from, tokenRange.to]);

  const refreshAfterProcessing = useCallback(() => {
    loadRuns();
    loadIngestStatus();
    loadTokenUsage();
  }, [loadRuns, loadIngestStatus, loadTokenUsage]);

  useEffect(() => {
    loadRuns();
    loadTrackedJobs();
    getHealth().then(setHealth).catch(() => {});
    loadIngestStatus();
    loadLlmConfig();
  }, [loadRuns, loadTrackedJobs, loadIngestStatus, loadLlmConfig]);

  useEffect(() => {
    loadTokenUsage();
  }, [loadTokenUsage]);

  function openLlmConfig() {
    setLlmConfigError(null);
    setLlmConfigOpen(true);
    loadLlmConfig();
  }

  function saveLlmConfigSlot(slot, payload) {
    setLlmSavingSlot(slot);
    setLlmConfigError(null);
    // Choosing a stored provider clears any BYO config this tab was carrying,
    // otherwise the header would keep overriding the selection just saved.
    setByoConfig(slot, null);
    saveLlmAgentConfig(slot, payload)
      .then(() => loadLlmConfig())
      .catch((e) => setLlmConfigError({ slot, message: e?.response?.data?.detail || e.message }))
      .finally(() => setLlmSavingSlot(null));
  }

  /** Apply a bring-your-own-key provider for this tab only; nothing is sent to the server. */
  function saveLlmSessionSlot(slot, config) {
    setLlmConfigError(null);
    setByoConfig(slot, config);
    loadLlmConfig();
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
    if (readOnly || !selectedFile) return;
    setFile(selectedFile);
    setUploadError(null);
    // Parsed in the browser rather than posted to /api/ingest/preview-csv: the
    // confirm step uploads the same file anyway, and sending a large export twice
    // doubled the wait and the Worker's peak memory for no benefit.
    previewCsvFile(selectedFile)
      .then(setPreview)
      .catch((e) => setUploadError(`Không đọc được file CSV: ${e.message}`));
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
    // force when the run already has analyses: that is what "Phân tích lại" means, and
    // without it the backend treats them as done and the button does nothing.
    runAnalyze({ run_id: target.id, force: target.analysis_status === "done" })
      .then((r) => {
        enqueueTrackedJobs([{ kind: "analysis", progressKey: r.progress_key, run: target }]);
        loadTrackedJobs();
      });
  };

  const startTranslate = (run) => {
    const target = resolveRun(run);
    // Same for translation: a comment that already has a zh-CN row is skipped unless
    // forced, so "Dịch lại" was a no-op. Re-translating also refreshes the Chinese
    // summary, which is stale whenever the analysis was redone.
    runTranslate({ run_id: target.id, locale: "zh-CN", force: target.translation_status === "done" })
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

  const activeRunFilter = RUN_SOURCE_FILTERS.find((f) => f.key === runSourceFilter) || RUN_SOURCE_FILTERS[0];
  const filteredRuns = activeRunFilter.types
    ? runs.filter((run) => activeRunFilter.types.includes(run.source_type))
    : runs;
  const runPageCount = Math.max(1, Math.ceil(filteredRuns.length / RUNS_PER_PAGE));
  const safeRunPage = Math.min(runPage, runPageCount - 1);
  const pagedRuns = filteredRuns.slice(safeRunPage * RUNS_PER_PAGE, safeRunPage * RUNS_PER_PAGE + RUNS_PER_PAGE);

  const selectRunFilter = (key) => {
    setRunSourceFilter(key);
    setRunPage(0);
  };

  const runCountByType = (types) => (types ? runs.filter((run) => types.includes(run.source_type)).length : runs.length);

  return (
    <>
      <h2 className="page-title">Ingest &amp; Cài đặt</h2>
      <p className="page-subtitle">Nạp dữ liệu mới; hệ thống tự xếp hàng phân loại LLM rồi dịch zh-CN.</p>
      <p className="queue-note">
        Sau mỗi lần kéo/upload thành công: Phân loại LLM -&gt; ghi nhớ chủ đề con -&gt; dịch zh-CN. Nút trong lịch sử chỉ dùng để chạy lại khi cần.
      </p>
      <AdminLockBar lock={adminLock} />
      <SourceStatusStrip ingestStatus={ingestStatus} />

      <div className="two-col">
        <div className="panel">
          <h3>Upload CSV (Facebook)</h3>
          <div
            className={`upload-zone${readOnly ? " upload-zone-locked" : ""}`}
            title={readOnly ? READ_ONLY_HINT : undefined}
            onClick={() => { if (!readOnly) fileRef.current?.click(); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFileSelect(e.dataTransfer.files?.[0]); }}
          >
            {readOnly
              ? "Chỉ xem — cần mật khẩu quản trị để nạp file CSV"
              : file ? `Đã chọn: ${file.name}` : "Kéo thả file CSV vào đây, hoặc bấm để chọn file"}
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              disabled={readOnly}
              style={{ display: "none" }}
              onChange={(e) => onFileSelect(e.target.files?.[0])}
            />
          </div>

          {uploadError && <div className="error-banner">{uploadError}</div>}

          {preview && (
            <>
              <p>
                Tổng <b>{preview.total_rows}</b> dòng; sẽ nhập <b>{preview.importable_rows ?? preview.total_rows}</b> dòng Facebook
                (<b>{preview.fanpage_rows ?? 0}</b> Fanpage, <b>{preview.group_rows ?? 0}</b> Group).
              </p>
              {preview.skipped_non_group_rows > 0 && (
                <div className="warning-banner">
                  Bỏ qua {preview.skipped_non_group_rows} dòng không có cột A = Fanpage hoặc Group.
                </div>
              )}
              {preview.importable_rows === 0 && (
                <div className="error-banner">
                  File này không có dòng Fanpage hoặc Group hợp lệ, nên không thể nạp vào Facebook CSV.
                </div>
              )}
              {(preview.data_start_date || preview.data_end_date) && (
                <p className="progress-caption">
                  Khoảng thời gian Facebook trong file: <b>{formatDate(preview.data_start_date) || "?"}</b> → <b>{formatDate(preview.data_end_date) || "?"}</b>
                </p>
              )}
              <p className="progress-caption">Xem trước tối đa 10 dòng Facebook đầu tiên:</p>
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
              <button className="btn" disabled={uploading || readOnly || preview.importable_rows === 0} title={readOnly ? READ_ONLY_HINT : undefined} onClick={confirmUpload} style={{ marginTop: 12 }}>
                {uploading ? "Đang nạp..." : preview.importable_rows === 0 ? "Không có dòng Facebook để nạp" : "Xác nhận nạp dữ liệu Facebook CSV"}
              </button>
            </>
          )}

          {lastRun && (
            <div style={{ marginTop: 14 }}>
              <p>Đã nạp {lastRun.rows_new}/{lastRun.rows_fetched} dòng mới ({runTitle(lastRun)}). Hệ thống đã tự xếp hàng phân loại rồi dịch zh-CN.</p>
              <button
                className="btn btn-secondary"
                disabled={readOnly}
                title={readOnly ? READ_ONLY_HINT : undefined}
                onClick={() => startAnalyze(lastRun)}
              >
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
                  readOnly={readOnly}
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
                disabled={readOnly}
                onChange={(value) => setStRange({ ...stRange, start_date: value })}
              />
              <DateTextInput
                value={stRange.end_date}
                disabled={readOnly}
                onChange={(value) => setStRange({ ...stRange, end_date: value })}
              />
            </div>
            <button className="btn" disabled={stBusy || readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={pullSensorTower}>
              {stBusy ? "Đang kéo..." : "Kéo review Store"}
            </button>
            {stError && <div className="error-banner" style={{ marginTop: 8 }}>{stError}</div>}
          </div>

          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Facebook Fanpage (Graph API)</h4>
            <p className="progress-caption" style={{ marginTop: 0 }}>
              Dùng cùng khoảng ngày đang chọn ở trên.
            </p>
            <button className="btn" disabled={fbBusy || readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={pullFacebook}>
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
        <div className="run-toolbar">
          <div className="segmented">
            {RUN_SOURCE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={f.key === runSourceFilter ? "active" : ""}
                onClick={() => selectRunFilter(f.key)}
              >
                {f.label} ({runCountByType(f.types)})
              </button>
            ))}
          </div>
          <TokenUsagePanel
            range={tokenRange}
            onRangeChange={setTokenRange}
            usage={tokenUsage}
            loading={tokenLoading}
            error={tokenError}
            onReload={loadTokenUsage}
          />
        </div>
        {runs.length === 0 ? (
          <div className="empty-state">Chưa có lần nạp dữ liệu nào.</div>
        ) : filteredRuns.length === 0 ? (
          <div className="empty-state">Không có lần nạp nào cho nguồn “{activeRunFilter.label}”.</div>
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
                {pagedRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{run.id}</td>
                    <td>{sourceName(run.source_type)}</td>
                    <td>{runScope(run)}</td>
                    <td><StatusPill status={run.status} /></td>
                    <td>{formatDateTime(run.started_at)}</td>
                    <td>{run.rows_new}</td>
                    <td>{run.rows_fetched}</td>
                    <td>
                      <div className="run-cell-stack">
                        <ProcessingBadge status={run.analysis_status} progress={run.analysis_progress} kind="analysis" />
                        <TokenUsageNote usage={run.analysis_tokens} processed={run.analysis_status === "done"} />
                      </div>
                    </td>
                    <td>
                      <div className="run-cell-stack">
                        <ProcessingBadge status={run.translation_status} progress={run.translation_progress} kind="translation" />
                        <TokenUsageNote usage={run.translation_tokens} processed={run.translation_status === "done"} />
                      </div>
                    </td>
                    <td style={{ color: "var(--negative)", fontSize: 12 }}>{run.error || ""}</td>
                    <td className="run-actions-cell">
                      {run.status === "done" && run.rows_new > 0 && (
                        <div className="run-action-group">
                          <button className="btn btn-secondary run-action-button" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => startAnalyze(run)}>{analysisRunActionLabel(run)}</button>
                          <button className="btn btn-secondary run-action-button" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => startTranslate(run)}>{translationRunActionLabel(run)}</button>
                          <button className="btn btn-danger run-action-button" disabled={readOnly || deletingRunId === run.id} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => deleteRun(run)}>
                            {deletingRunId === run.id ? "Đang xóa..." : `Xóa #${run.id}`}
                          </button>
                        </div>
                      )}
                      {(run.status !== "done" || run.rows_new <= 0) && (
                        <div className="run-action-group">
                          <button className="btn btn-danger run-action-button" disabled={readOnly || deletingRunId === run.id} title={readOnly ? READ_ONLY_HINT : undefined} onClick={() => deleteRun(run)}>
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
        {filteredRuns.length > RUNS_PER_PAGE && (
          <div className="run-pagination">
            <button
              type="button"
              className="btn btn-secondary run-action-button"
              disabled={safeRunPage <= 0}
              onClick={() => setRunPage((p) => Math.max(0, p - 1))}
            >
              ← Trước
            </button>
            <span className="progress-caption">
              Trang {safeRunPage + 1}/{runPageCount} · {filteredRuns.length} lần nạp
            </span>
            <button
              type="button"
              className="btn btn-secondary run-action-button"
              disabled={safeRunPage >= runPageCount - 1}
              onClick={() => setRunPage((p) => Math.min(runPageCount - 1, p + 1))}
            >
              Sau →
            </button>
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
        onSaveSession={saveLlmSessionSlot}
        readOnly={readOnly}
      />
    </>
  );
}
