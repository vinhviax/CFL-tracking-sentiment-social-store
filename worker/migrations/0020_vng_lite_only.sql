-- Point both slots at VNG's internal gateway and nothing else.
--
-- The catalog default in llmCatalog.ts is only consulted when a slot has no row, and
-- 0012 seeded one for each slot — so changing the code alone would leave a deployed
-- container still calling the Viax proxies. Same shape as 0013 and 0016, for the same
-- reason.
--
-- Unscoped, unlike those two: this is not a model rename within one provider but the
-- removal of every provider except vng_lite, so any row still naming a retired one has
-- to move regardless of which model it holds. (A row naming a provider the catalog no
-- longer has does fall back to the default at read time — getSlotSelection checks —
-- but leaving the rows behind would keep showing the dead provider in the UI.)
--
-- Models verified against GET /v1/models on the live gateway 2026-09-14. "Gemini 3.7
-- Flash" was asked for and is not served there; naming a model the gateway does not
-- have is what silently dropped 31,322 comments to the keyword fallback for twelve
-- days in July, so these two names are the verified ones:
--   reasoning -> gemini/gemini-3.6-flash       19.9s per 20-comment batch
--   simple    -> gemini/gemini-3.5-flash-lite   4.7s per 20-comment batch
-- The reasoning figure holds only because the request now sends reasoning_effort=none
-- (68.8s without it) — see OpenAIProvider in services/llm/providers.ts.
UPDATE llm_agent_configs
SET provider = 'vng_lite',
    model = 'gemini/gemini-3.6-flash',
    updated_at = datetime('now')
WHERE slot = 'reasoning';

UPDATE llm_agent_configs
SET provider = 'vng_lite',
    model = 'gemini/gemini-3.5-flash-lite',
    updated_at = datetime('now')
WHERE slot = 'simple';

-- Clear whatever escalation state the old providers left behind. Without this a slot
-- that had already given up on an unreachable Viax proxy would sit at tier 'exhausted'
-- and keep refusing to call anything until the daily reset cron ran at 07:00 UTC —
-- the new gateway would look broken for up to a day for no reason.
UPDATE llm_slot_state
SET tier = 'primary',
    consecutive_failures = 0,
    exhausted_date = NULL,
    last_error = NULL,
    last_error_category = NULL,
    last_failure_at = NULL,
    updated_at = datetime('now');
