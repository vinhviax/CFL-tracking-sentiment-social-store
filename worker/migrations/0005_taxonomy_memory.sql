CREATE TABLE taxonomy_subtopics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  parent_topic TEXT NOT NULL,
  label_vi TEXT NOT NULL,
  label_zh_cn TEXT,
  description TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  evidence_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'llm_memory',
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_taxonomy_subtopics_parent ON taxonomy_subtopics(parent_topic);
CREATE INDEX idx_taxonomy_subtopics_status ON taxonomy_subtopics(status);

CREATE TABLE comment_subtopics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  subtopic_id INTEGER NOT NULL REFERENCES taxonomy_subtopics(id),
  confidence REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'llm_memory',
  observed_at TEXT NOT NULL,
  UNIQUE(comment_id, subtopic_id)
);

CREATE INDEX idx_comment_subtopics_comment ON comment_subtopics(comment_id);
CREATE INDEX idx_comment_subtopics_subtopic ON comment_subtopics(subtopic_id);

CREATE TABLE feedback_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES ingest_runs(id),
  source_group TEXT,
  period_start TEXT,
  period_end TEXT,
  summary TEXT NOT NULL,
  novel_signals_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_feedback_memories_run ON feedback_memories(run_id);
CREATE INDEX idx_feedback_memories_period ON feedback_memories(period_start, period_end);

CREATE TABLE memory_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL REFERENCES feedback_memories(id),
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  subtopic_id INTEGER REFERENCES taxonomy_subtopics(id),
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(memory_id, comment_id, subtopic_id)
);

CREATE INDEX idx_memory_evidence_memory ON memory_evidence(memory_id);
CREATE INDEX idx_memory_evidence_comment ON memory_evidence(comment_id);
