-- Mirrors backend/app/models.py (SQLAlchemy) for the FastAPI implementation.
-- Dates stored as ISO8601 TEXT (SQLite/D1 convention).

CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,           -- store | fb_page | fb_group_csv
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running', -- running | done | failed
  rows_fetched INTEGER NOT NULL DEFAULT 0,
  rows_new INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  error TEXT
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  external_id TEXT,
  published_at TEXT,
  message TEXT,
  permalink TEXT,
  UNIQUE (source_type, external_id)
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER REFERENCES posts(id),
  source_type TEXT NOT NULL,
  external_id TEXT,
  created_at TEXT,
  author_hint TEXT,
  message TEXT NOT NULL,
  rating INTEGER,
  country TEXT,
  store TEXT,               -- gp | ios
  legacy_topic TEXT,
  dedupe_hash TEXT NOT NULL UNIQUE,
  skipped_analysis INTEGER NOT NULL DEFAULT 0,
  ingest_run_id INTEGER REFERENCES ingest_runs(id)
);

CREATE INDEX idx_comments_source_type ON comments(source_type);
CREATE INDEX idx_comments_created_at ON comments(created_at);
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_ingest_run_id ON comments(ingest_run_id);

CREATE TABLE analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL UNIQUE REFERENCES comments(id),
  topic_main TEXT NOT NULL,
  topics_sub TEXT NOT NULL DEFAULT '[]',  -- JSON array as text
  sentiment TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'none',
  summary TEXT,
  other_suggested TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  analyzed_at TEXT NOT NULL
);

CREATE INDEX idx_analyses_topic_main ON analyses(topic_main);
CREATE INDEX idx_analyses_sentiment ON analyses(sentiment);
CREATE INDEX idx_analyses_urgency ON analyses(urgency);
