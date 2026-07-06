CREATE TABLE ingest_cursors (
  key TEXT PRIMARY KEY,
  cursor_date TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_id INTEGER REFERENCES ingest_runs(id)
);

CREATE TABLE comment_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  locale TEXT NOT NULL,
  message_translated TEXT NOT NULL,
  summary_translated TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  translated_at TEXT NOT NULL,
  UNIQUE (comment_id, locale)
);

CREATE INDEX idx_comment_translations_locale ON comment_translations(locale);
CREATE INDEX idx_comment_translations_comment_id ON comment_translations(comment_id);
