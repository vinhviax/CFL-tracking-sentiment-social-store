-- Tracks analyze-run progress in D1 instead of in-memory state, since Workers
-- module-level variables are not reliably shared across requests/isolates.
CREATE TABLE analyze_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  progress_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  done INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
