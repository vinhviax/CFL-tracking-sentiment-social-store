-- Drop the "codex-lb/" prefix from the OpenAI by Viax model names.
--
-- That prefix is how the rpi7jss proxy routes; the agent-shop endpoint this provider
-- uses rejects it with 403 model_not_allowed. 0012 seeded the prefixed name, and the
-- override it replaced carried the same mistake — which is why every analysis between
-- 2026-07-17 and 2026-07-29 silently fell back to keyword classification while the
-- analyses table still recorded the configured model.
--
-- Probed against production: gpt-5.6-terra and gpt-5.6-luna succeed, the prefixed
-- forms 403.
UPDATE llm_agent_configs
SET model = REPLACE(model, 'codex-lb/', ''),
    updated_at = datetime('now')
WHERE provider = 'openai_viax' AND model LIKE 'codex-lb/%';
