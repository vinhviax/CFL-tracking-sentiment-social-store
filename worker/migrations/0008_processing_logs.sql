CREATE TABLE processing_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  processing_job_id INTEGER NOT NULL,
  progress_key TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('analysis', 'translation')),
  level TEXT NOT NULL CHECK (level IN ('info', 'success', 'error')),
  phase TEXT NOT NULL,
  message TEXT NOT NULL,
  batch_index INTEGER,
  batch_total INTEGER,
  item_count INTEGER,
  provider TEXT,
  model TEXT,
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_processing_logs_job_id ON processing_logs(processing_job_id, id DESC);
CREATE INDEX idx_processing_logs_progress_key ON processing_logs(progress_key, id DESC);
