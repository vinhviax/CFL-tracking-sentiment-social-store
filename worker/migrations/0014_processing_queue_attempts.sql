-- Bounded retries for processing jobs.
--
-- A job used to be marked 'failed' the first time anything threw — one 502 from the
-- LLM proxy ended the whole run and left the remaining comments unprocessed. The work
-- is idempotent (each attempt re-selects only comments still missing an analysis), so
-- retrying is safe; this column is what stops it retrying forever.
ALTER TABLE processing_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

-- Stale detection reads the newest batch log for a job, so it can use a short window
-- without cutting off a job that is still making progress.
CREATE INDEX IF NOT EXISTS idx_processing_logs_job_created
  ON processing_logs(processing_job_id, created_at DESC);
