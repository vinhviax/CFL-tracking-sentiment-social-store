-- Cache each run's derived counts on the run itself.
--
-- routes/runs.ts used to recompute comment_count, analyzed_count,
-- translated_zh_cn_count and the data date range with five correlated subqueries per
-- run, on every request. The Ingest page asks for 500 runs at a time, so one page load
-- walked every one of the ~87,500 comments five times over plus the joins into analyses
-- and comment_translations: roughly 600,000 row reads, and growing with every comment
-- ever ingested. Together with the token-usage scan that was ~1,000,000 rows per page
-- load, which is why five loads exhausted D1's 5,000,000 row/day free-tier read limit
-- and returned HTTP 500 across the whole app on 2026-09-03.
--
-- These columns hold the last computed snapshot. Runs are recounted only while their
-- work can still move (see services/runCounters.ts): a finished run from July is never
-- rescanned again, so the cost of opening the page stops growing with the dataset.
--
-- Deliberately nullable with no default: NULL means "never counted", which is what makes
-- every existing run recount once on the next request and keeps the cache self-healing.
ALTER TABLE ingest_runs ADD COLUMN comment_count INTEGER;
ALTER TABLE ingest_runs ADD COLUMN analyzed_count INTEGER;
ALTER TABLE ingest_runs ADD COLUMN translated_zh_cn_count INTEGER;
ALTER TABLE ingest_runs ADD COLUMN data_start_date TEXT;
ALTER TABLE ingest_runs ADD COLUMN data_end_date TEXT;
ALTER TABLE ingest_runs ADD COLUMN counts_updated_at TEXT;
