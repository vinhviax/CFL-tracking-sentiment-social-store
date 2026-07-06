CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE saved_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  filters TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'vi',
  source_group TEXT,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_saved_insights_created_at ON saved_insights(created_at);
CREATE INDEX idx_saved_insights_source_group ON saved_insights(source_group);
