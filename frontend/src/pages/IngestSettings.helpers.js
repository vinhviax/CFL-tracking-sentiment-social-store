const tokenFormatter = new Intl.NumberFormat("vi-VN");

export function formatTokens(value) {
  return tokenFormatter.format(Number(value) || 0);
}

/** Strip the provider/path prefix so "codex-lb/gpt-5.6-terra" reads as "gpt-5.6-terra". */
export function shortModelName(model) {
  if (!model) return "—";
  const parts = String(model).split("/");
  return parts[parts.length - 1] || String(model);
}

/**
 * Decide how to present a token figure.
 *
 * The three-way split matters because a run can be in genuinely different states
 * that all look like "no tokens":
 *  - "none": no LLM batch was ever logged for it (a Store run with 0 reviews).
 *  - "missing": batches ran but reported no usage — every batch from before token
 *    capture shipped. Showing 0 here would read as "this run was free".
 *  - "partial": some batches reported usage and some did not, so any total shown
 *    understates real spend and has to be labelled.
 */
export function tokenUsageState(usage) {
  const batches = Number(usage?.batches) || 0;
  const withUsage = Number(usage?.batches_with_usage) || 0;
  if (!usage || batches === 0) return "none";
  if (withUsage === 0) return "missing";
  return withUsage < batches ? "partial" : "full";
}

/** Total tokens for a usage record, for the "x tổng" figure. */
export function totalTokens(usage) {
  return (Number(usage?.input_tokens) || 0) + (Number(usage?.output_tokens) || 0);
}

/** Comma-joined short model names, for the per-run note. */
export function usageModelLabel(usage) {
  return (usage?.by_model || []).map((m) => shortModelName(m.model)).join(", ");
}

/** Matches STALE_RUNNING_MS in the worker: past this with no new log, recovery reclaims the job. */
export const STALE_LOG_MS = 3 * 60 * 1000;

/**
 * Which state a queued/running processing job is actually in.
 *
 * The queue runs a few jobs at a time, so most jobs spend a long time waiting their
 * turn. Those used to render exactly like a job that was working ("0/0 comment", no
 * logs) and like one whose batch had died, so a healthy queue read as broken:
 *  - "waiting": in the queue, never claimed. There is no total yet because nothing
 *    has counted its comments.
 *  - "paused": claimed, did some work, then put itself back in the queue to continue
 *    within the next invocation's budget. done/total are real.
 *  - "stalled": claimed but no log for longer than the worker's stale window, so
 *    stale recovery is about to take it back.
 */
export function processingJobPhase(progress, logs) {
  const status = progress?.status;
  if (["done", "failed", "cancelled"].includes(status)) return status;
  const queued = progress?.queue_status ? progress.queue_status === "queued" : status === "queued";
  if (queued) return progress?.queue_started_at ? "paused" : "waiting";
  // Logs arrive newest first.
  const newest = Date.parse(logs?.[0]?.created_at ?? "");
  if (Number.isFinite(newest) && Date.now() - newest > STALE_LOG_MS) return "stalled";
  return "running";
}

/** The count line under a job title. A waiting job has no counts to show yet. */
export function processingJobCaption(progress, phase) {
  if (phase === "waiting") {
    const ahead = progress?.queue_ahead;
    if (ahead == null) return "Chưa bắt đầu · đang chờ trong hàng đợi";
    return ahead > 0
      ? `Chưa bắt đầu · còn ${ahead} task phía trước`
      : "Chưa bắt đầu · sắp tới lượt";
  }
  const counts = `${progress?.done ?? 0}/${progress?.total ?? 0} comment`;
  return progress?.provider ? `${counts} · Provider: ${progress.provider}` : counts;
}

/** Extra line explaining the states that look like a failure but are not. */
export function processingJobNote(phase) {
  if (phase === "paused") {
    return "Đã xong một phần, task tự quay lại hàng đợi để chạy tiếp phần còn lại.";
  }
  if (phase === "stalled") {
    return "Không có log mới trong hơn 3 phút — hệ thống sẽ tự thu hồi và chạy lại task này.";
  }
  return null;
}
