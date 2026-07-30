-- Per-slot LLM escalation state.
--
-- Replaces the old "always try primary then gemini_viax as a safety net on every
-- single call" behaviour with a stateful escalation: a slot sits on one tier
-- (primary/secondary/exhausted), moves to the next after 3 consecutive failures,
-- and stops attempting entirely for the rest of the day once secondary is also
-- exhausted. One row per slot, seeded here so callers never have to special-case
-- a missing row.
CREATE TABLE IF NOT EXISTS llm_slot_state (
  slot TEXT PRIMARY KEY CHECK (slot IN ('reasoning', 'simple')),
  tier TEXT NOT NULL DEFAULT 'primary' CHECK (tier IN ('primary', 'secondary', 'exhausted')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  -- Only the 'simple' slot gates on this (120s backoff between retries after a
  -- failure); 'reasoning' has no time gate, so this is write-only/observational
  -- for that slot. See llmSlotState.ts claimSlotAttempt.
  last_failure_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  -- Logging/visibility only ('quota_exhausted' | 'unidentified') — never gates
  -- the escalation decision, which is purely the 3-consecutive-failures count.
  last_error_category TEXT,
  -- UTC calendar day (YYYY-MM-DD) this slot gave up for. NULL unless tier =
  -- 'exhausted'. The daily reset cron clears this and tier back to 'primary'.
  exhausted_date TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO llm_slot_state (slot, tier, consecutive_failures, updated_at) VALUES
  ('reasoning', 'primary', 0, datetime('now')),
  ('simple', 'primary', 0, datetime('now'));
