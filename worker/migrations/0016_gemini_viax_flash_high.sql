-- Move the "Gemini by Viax" slot selection to ag/gemini-3.6-flash-high.
--
-- The catalog default in llmCatalog.ts is only consulted when a slot has no row, and
-- 0012 seeded one for 'simple' — so changing the code alone would leave production
-- still calling ag/gemini-3-flash-agent. Same shape as 0013, for the same reason.
--
-- Scoped to the retired model name so a slot someone has since pointed elsewhere by
-- hand is left alone.
UPDATE llm_agent_configs
SET model = 'ag/gemini-3.6-flash-high',
    updated_at = datetime('now')
WHERE provider = 'gemini_viax' AND model = 'ag/gemini-3-flash-agent';
