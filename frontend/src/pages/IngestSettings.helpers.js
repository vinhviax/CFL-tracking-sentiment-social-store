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
