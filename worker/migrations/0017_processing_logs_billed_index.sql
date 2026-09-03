-- Make the token-usage queries read only the batches that actually carry usage.
--
-- Both queries in tokenUsage.ts filter `level = 'success' AND phase = 'llm_batch'`,
-- which matches ~18k of the ~487k rows in processing_logs: the rest are the "batch
-- started" info rows and the error rows, neither of which is ever summed. Without a
-- predicate-matching index SQLite scans the whole table, so a single load of the
-- Ingest page spent ~487k row reads here alone — enough that five page loads
-- exhausted D1's 5,000,000 row/day free-tier read limit and took production down
-- with HTTP 500 on 2026-09-03.
--
-- Partial indexes (WHERE ...) keep these small — they only hold the billed rows.
-- Both carry the aggregated columns so the GROUP BY can be answered from the index
-- without touching the table at all.
--
-- loadRunTokenUsage joins on processing_job_id:
CREATE INDEX IF NOT EXISTS idx_processing_logs_billed_by_job
  ON processing_logs(processing_job_id, job_type, model, input_tokens, output_tokens)
  WHERE level = 'success' AND phase = 'llm_batch';

-- loadTokenUsageByRange filters on a created_at window:
CREATE INDEX IF NOT EXISTS idx_processing_logs_billed_by_date
  ON processing_logs(created_at, job_type, model, input_tokens, output_tokens)
  WHERE level = 'success' AND phase = 'llm_batch';
