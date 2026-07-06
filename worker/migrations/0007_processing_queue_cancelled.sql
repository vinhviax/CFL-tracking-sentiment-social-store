ALTER TABLE processing_queue RENAME TO processing_queue_old;

CREATE TABLE processing_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK (job_type IN ('analysis', 'translation')),
  run_id INTEGER,
  comment_ids_json TEXT,
  locale TEXT,
  progress_key TEXT NOT NULL UNIQUE,
  force INTEGER NOT NULL DEFAULT 0,
  limit_count INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

INSERT INTO processing_queue (
  id, job_type, run_id, comment_ids_json, locale, progress_key, force, limit_count,
  status, error, created_at, updated_at, started_at, finished_at
)
SELECT
  id, job_type, run_id, comment_ids_json, locale, progress_key, force, limit_count,
  status, error, created_at, updated_at, started_at, finished_at
FROM processing_queue_old;

DROP TABLE processing_queue_old;

CREATE INDEX idx_processing_queue_status_id ON processing_queue(status, id);
