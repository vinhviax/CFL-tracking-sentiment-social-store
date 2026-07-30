import type { Env } from "../types";
import type { LlmAgentSlot } from "./llmCatalog";
import type { LLMProvider } from "./llm/base";
import { type ChainOutcome, completeJsonWithFallback, completeTextWithFallback } from "./llm/chain";

export type SlotTier = "primary" | "secondary" | "exhausted";

/** Consecutive failures on the active tier before escalating (or giving up, from secondary). */
const CONSECUTIVE_FAILURES_TO_ESCALATE = 3;

/**
 * Minimum gap between retries after a failure, for the 'simple' slot only. This
 * gates RETRIES after an error, not calls in general — healthy operation is not
 * throttled. See claimSlotAttempt.
 */
const SIMPLE_RETRY_BACKOFF_MS = 120_000;

interface SlotStateRow {
  tier: SlotTier;
  consecutive_failures: number;
  last_failure_at: string | null;
  exhausted_date: string | null;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ensureRow(env: Env, slot: LlmAgentSlot): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO llm_slot_state (slot, tier, consecutive_failures, updated_at)
     VALUES (?, 'primary', 0, ?)`
  ).bind(slot, new Date().toISOString()).run();
}

/**
 * Whether a call against this slot's active tier should be attempted right now.
 *
 * A pure read — no write. Returns null when the slot should not be attempted:
 *  - it has given up (tier='exhausted') — stays blocked regardless of how many
 *    days pass; only the daily reset cron or a manual provider change clears
 *    this, deliberately, so there is exactly one way out of 'exhausted'
 *  - it's the 'simple' slot, mid a failure streak, and less than 120s have
 *    passed since the last failure (retry backoff)
 * Otherwise returns the tier to build a provider for.
 */
export async function claimSlotAttempt(env: Env, slot: LlmAgentSlot): Promise<{ tier: SlotTier } | null> {
  await ensureRow(env, slot);
  const row = await env.DB.prepare(
    `SELECT tier, consecutive_failures, last_failure_at, exhausted_date FROM llm_slot_state WHERE slot = ?`
  ).bind(slot).first<SlotStateRow>();
  if (!row) return { tier: "primary" };

  if (row.tier === "exhausted") return null;

  if (slot === "simple" && row.consecutive_failures > 0 && row.last_failure_at) {
    const elapsed = Date.now() - new Date(row.last_failure_at).getTime();
    if (elapsed < SIMPLE_RETRY_BACKOFF_MS) return null;
  }

  return { tier: row.tier };
}

/** Record a successful call: resets the failure streak, clears the backoff clock. */
export async function recordSlotSuccess(env: Env, slot: LlmAgentSlot): Promise<void> {
  const now = new Date().toISOString();
  await ensureRow(env, slot);
  await env.DB.prepare(
    `UPDATE llm_slot_state
     SET consecutive_failures = 0, last_failure_at = NULL, last_error = NULL,
         last_error_category = NULL, last_success_at = ?, updated_at = ?
     WHERE slot = ?`
  ).bind(now, now, slot).run();
}

/**
 * Record a failed call. One UPDATE whose CASE branches read the pre-update row —
 * SQLite serialises writes to the same row, so concurrent failures/successes are
 * ordered by commit order rather than racing in application code, the same
 * property processingQueue.ts's failAttempt() relies on.
 */
export async function recordSlotFailure(env: Env, slot: LlmAgentSlot, error: string): Promise<void> {
  await ensureRow(env, slot);
  const now = new Date().toISOString();
  const today = todayUtc();
  const category = classifyLlmError(error);
  await env.DB.prepare(
    `UPDATE llm_slot_state
     SET tier = CASE
           WHEN tier = 'primary' AND consecutive_failures + 1 >= ? THEN 'secondary'
           WHEN tier = 'secondary' AND consecutive_failures + 1 >= ? THEN 'exhausted'
           ELSE tier
         END,
         consecutive_failures = CASE
           WHEN tier IN ('primary', 'secondary') AND consecutive_failures + 1 >= ? THEN 0
           ELSE consecutive_failures + 1
         END,
         exhausted_date = CASE
           WHEN tier = 'secondary' AND consecutive_failures + 1 >= ? THEN ?
           ELSE exhausted_date
         END,
         last_failure_at = ?, last_error = ?, last_error_category = ?, updated_at = ?
     WHERE slot = ?`
  ).bind(
    CONSECUTIVE_FAILURES_TO_ESCALATE, CONSECUTIVE_FAILURES_TO_ESCALATE, CONSECUTIVE_FAILURES_TO_ESCALATE,
    CONSECUTIVE_FAILURES_TO_ESCALATE, today,
    now, error.slice(0, 500), category, now, slot
  ).run();
}

/** Daily reset: both slots back to primary with a clean slate. Called by the daily cron. */
export async function resetAllSlotsForNewDay(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE llm_slot_state
     SET tier = 'primary', consecutive_failures = 0, exhausted_date = NULL,
         last_failure_at = NULL, last_error = NULL, last_error_category = NULL, updated_at = ?`
  ).bind(now).run();
}

/** A manual provider change is a deliberate intervention — give the slot a clean slate. */
export async function resetSlotEscalation(env: Env, slot: LlmAgentSlot): Promise<void> {
  await ensureRow(env, slot);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE llm_slot_state
     SET tier = 'primary', consecutive_failures = 0, exhausted_date = NULL,
         last_failure_at = NULL, last_error = NULL, last_error_category = NULL, updated_at = ?
     WHERE slot = ?`
  ).bind(now, slot).run();
}

export async function getSlotState(env: Env, slot: LlmAgentSlot): Promise<SlotStateRow | null> {
  await ensureRow(env, slot);
  const row = await env.DB.prepare(
    `SELECT tier, consecutive_failures, last_failure_at, exhausted_date FROM llm_slot_state WHERE slot = ?`
  ).bind(slot).first<SlotStateRow>();
  return row || null;
}

/** Logging/visibility categorisation only — never gates the escalation decision. */
export function classifyLlmError(message: string): "quota_exhausted" | "unidentified" {
  const m = String(message || "").toLowerCase();
  if (
    /\b403\b/.test(m) || /\b429\b/.test(m) || /reset after/.test(m) ||
    /no_accounts/.test(m) || /degraded mode/.test(m) || /quota/.test(m) || /rate limit/.test(m)
  ) {
    return "quota_exhausted";
  }
  return "unidentified";
}

/**
 * Wrap a single-provider-chain JSON call and record the outcome against the
 * slot's escalation state. `recordable: false` (a BYO override is in play)
 * skips recording entirely — a per-request BYO choice must not pollute the
 * shared house providers' failure counters.
 */
export async function completeJsonForSlot(
  env: Env, slot: LlmAgentSlot, chain: LLMProvider[], system: string, user: string, opts: { recordable: boolean }
): Promise<ChainOutcome> {
  try {
    const outcome = await completeJsonWithFallback(chain, system, user);
    if (opts.recordable) await recordSlotSuccess(env, slot).catch(() => {});
    return outcome;
  } catch (e: any) {
    if (opts.recordable) await recordSlotFailure(env, slot, e?.message || String(e)).catch(() => {});
    throw e;
  }
}

export async function completeTextForSlot(
  env: Env, slot: LlmAgentSlot, chain: LLMProvider[], system: string, user: string, opts: { recordable: boolean }
): Promise<ChainOutcome> {
  try {
    const outcome = await completeTextWithFallback(chain, system, user);
    if (opts.recordable) await recordSlotSuccess(env, slot).catch(() => {});
    return outcome;
  } catch (e: any) {
    if (opts.recordable) await recordSlotFailure(env, slot, e?.message || String(e)).catch(() => {});
    throw e;
  }
}
