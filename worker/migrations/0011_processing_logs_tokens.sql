-- Record LLM token spend per batch, alongside the provider/model already logged.
-- NULL means the upstream response carried no usage (e.g. an OpenAI-compatible
-- proxy streaming without stream_options.include_usage), which must stay
-- distinguishable from a genuine 0 — so no DEFAULT here.
ALTER TABLE processing_logs ADD COLUMN input_tokens INTEGER;
ALTER TABLE processing_logs ADD COLUMN output_tokens INTEGER;

-- Token totals are read by date range and grouped by model.
CREATE INDEX idx_processing_logs_created_at ON processing_logs(created_at);
