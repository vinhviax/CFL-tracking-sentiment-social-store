-- Rework LLM provider configuration around a fixed catalog and drop the override flag.
--
-- Two shapes replace the old one:
--   llm_provider_secrets  server-side credentials for the "by Viax" providers
--   llm_agent_configs     which catalog provider + model each slot uses
--
-- BYO providers (anthropic/gemini/openai chính chủ, custom) are absent from both by
-- design: the user's key arrives per request and is never written down.

CREATE TABLE IF NOT EXISTS llm_provider_secrets (
  provider TEXT PRIMARY KEY,
  endpoint_url TEXT,
  api_key TEXT,
  updated_at TEXT NOT NULL
);

-- Carry the agent-shop endpoint and key over from the old reasoning row. Done as
-- SQL inside the database so the credential is never read out and typed back in.
-- openai_viax becomes the reasoning default, so it needs a working credential.
INSERT OR REPLACE INTO llm_provider_secrets (provider, endpoint_url, api_key, updated_at)
SELECT 'openai_viax', endpoint_url, api_key, COALESCE(updated_at, datetime('now'))
FROM llm_agent_configs
WHERE endpoint_url LIKE '%agent-shop%' AND api_key IS NOT NULL
ORDER BY CASE slot WHEN 'reasoning' THEN 1 ELSE 2 END
LIMIT 1;

-- Rebuild llm_agent_configs without enabled/endpoint_url/api_key. Recreated rather
-- than ALTER ... DROP COLUMN so the CHECK constraint and defaults are explicit.
CREATE TABLE llm_agent_configs_new (
  slot TEXT PRIMARY KEY CHECK (slot IN ('reasoning', 'simple')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed the documented defaults. Old rows are not carried across: they stored
-- provider ids ('custom') and an enabled flag that no longer mean anything, and the
-- previous simple row pointed at a model that was never actually in use because the
-- override was switched off.
-- The openai_viax model carries no "codex-lb/" prefix; see 0013 for why.
INSERT INTO llm_agent_configs_new (slot, provider, model, updated_at) VALUES
  ('reasoning', 'openai_viax', 'gpt-5.6-terra', datetime('now')),
  ('simple', 'gemini_viax', 'ag/gemini-3-flash-agent', datetime('now'));

DROP TABLE llm_agent_configs;
ALTER TABLE llm_agent_configs_new RENAME TO llm_agent_configs;
