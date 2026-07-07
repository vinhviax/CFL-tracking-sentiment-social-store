CREATE TABLE IF NOT EXISTS analysis_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  previous_topic_main TEXT,
  previous_topics_sub TEXT,
  new_topic_main TEXT NOT NULL,
  new_topics_sub TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  corrected_by TEXT NOT NULL DEFAULT 'human',
  corrected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_corrections_comment_id
  ON analysis_corrections(comment_id);

CREATE INDEX IF NOT EXISTS idx_analysis_corrections_corrected_at
  ON analysis_corrections(corrected_at);
