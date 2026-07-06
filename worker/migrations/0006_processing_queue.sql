CREATE TABLE processing_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK (job_type IN ('analysis', 'translation')),
  run_id INTEGER,
  comment_ids_json TEXT,
  locale TEXT,
  progress_key TEXT NOT NULL UNIQUE,
  force INTEGER NOT NULL DEFAULT 0,
  limit_count INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX idx_processing_queue_status_id ON processing_queue(status, id);
