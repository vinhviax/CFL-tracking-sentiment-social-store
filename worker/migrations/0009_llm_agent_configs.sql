CREATE TABLE IF NOT EXISTS llm_agent_configs (
  slot TEXT PRIMARY KEY CHECK (slot IN ('reasoning', 'simple')),
  enabled INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  endpoint_url TEXT,
  api_key TEXT,
  model TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
