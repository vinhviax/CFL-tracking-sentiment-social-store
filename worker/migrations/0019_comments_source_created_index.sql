-- Let /api/ingest/status find each source's newest comment date by index seek.
--
-- The query grouped by source_type and took MAX(SUBSTR(created_at, 1, 10)). Wrapping
-- the column in SUBSTR() makes it unindexable, so every load of the Ingest page scanned
-- all ~87,500 comments just to fill in three dates. Paired with rewriting the query to
-- MAX(created_at) (ISO-8601 sorts lexicographically, so the date prefix is the same),
-- this index answers it with one seek per source_type.
CREATE INDEX IF NOT EXISTS idx_comments_source_created ON comments(source_type, created_at);
