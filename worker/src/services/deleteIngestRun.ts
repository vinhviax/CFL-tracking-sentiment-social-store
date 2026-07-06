export interface DeleteIngestRunResult {
  id: number;
  source_type: string;
  status: string;
  rows_fetched: number;
  rows_new: number;
  deleted: {
    comments: number;
    analyses: number;
    translations: number;
    comment_subtopics: number;
    memory_evidence: number;
    feedback_memories: number;
    orphan_posts: number;
    progress_jobs: number;
  };
}

const RUN_COMMENTS = `SELECT id FROM comments WHERE ingest_run_id = ?`;
const RUN_MEMORIES = `SELECT id FROM feedback_memories WHERE run_id = ?`;

async function countFirst(db: D1Database, sql: string, ...args: any[]): Promise<number> {
  const stmt = db.prepare(sql);
  const row = await (args.length ? stmt.bind(...args) : stmt).first<{ n: number }>();
  return Number(row?.n || 0);
}

async function runDelete(db: D1Database, sql: string, ...args: any[]): Promise<number> {
  const stmt = db.prepare(sql);
  const result = await (args.length ? stmt.bind(...args) : stmt).run();
  return Number(result.meta.changes || 0);
}

export async function deleteIngestRun(db: D1Database, runId: number): Promise<DeleteIngestRunResult | null> {
  const run = await db
    .prepare(`SELECT id, source_type, status, rows_fetched, rows_new FROM ingest_runs WHERE id = ?`)
    .bind(runId)
    .first<{ id: number; source_type: string; status: string; rows_fetched: number; rows_new: number }>();
  if (!run) return null;

  const deleted = {
    comments: await countFirst(db, `SELECT COUNT(*) AS n FROM comments WHERE ingest_run_id = ?`, runId),
    analyses: await countFirst(db, `SELECT COUNT(*) AS n FROM analyses WHERE comment_id IN (${RUN_COMMENTS})`, runId),
    translations: await countFirst(db, `SELECT COUNT(*) AS n FROM comment_translations WHERE comment_id IN (${RUN_COMMENTS})`, runId),
    comment_subtopics: await countFirst(db, `SELECT COUNT(*) AS n FROM comment_subtopics WHERE comment_id IN (${RUN_COMMENTS})`, runId),
    memory_evidence: await countFirst(
      db,
      `SELECT COUNT(*) AS n FROM memory_evidence
       WHERE comment_id IN (${RUN_COMMENTS})
          OR memory_id IN (${RUN_MEMORIES})`,
      runId,
      runId
    ),
    feedback_memories: await countFirst(db, `SELECT COUNT(*) AS n FROM feedback_memories WHERE run_id = ?`, runId),
    orphan_posts: 0,
    progress_jobs: 0,
  };

  deleted.progress_jobs = await runDelete(
    db,
    `DELETE FROM analyze_jobs
     WHERE progress_key = ?
        OR progress_key LIKE ?
        OR progress_key LIKE ?
        OR progress_key LIKE ?`,
    `run-${runId}`,
    `translate-run-${runId}-%`,
    `%-analyze-${runId}`,
    `%-translate-${runId}`
  );

  await runDelete(db, `UPDATE ingest_cursors SET last_run_id = NULL WHERE last_run_id = ?`, runId);
  await runDelete(db, `DELETE FROM memory_evidence WHERE memory_id IN (${RUN_MEMORIES})`, runId);
  await runDelete(db, `DELETE FROM memory_evidence WHERE comment_id IN (${RUN_COMMENTS})`, runId);
  await runDelete(db, `DELETE FROM feedback_memories WHERE run_id = ?`, runId);
  await runDelete(db, `DELETE FROM comment_subtopics WHERE comment_id IN (${RUN_COMMENTS})`, runId);
  await runDelete(db, `DELETE FROM comment_translations WHERE comment_id IN (${RUN_COMMENTS})`, runId);
  await runDelete(db, `DELETE FROM analyses WHERE comment_id IN (${RUN_COMMENTS})`, runId);
  await runDelete(db, `DELETE FROM comments WHERE ingest_run_id = ?`, runId);
  deleted.orphan_posts = await runDelete(
    db,
    `DELETE FROM posts
     WHERE id IN (
       SELECT p.id
       FROM posts p
       LEFT JOIN comments c ON c.post_id = p.id
       WHERE c.id IS NULL
     )`
  );
  await runDelete(db, `DELETE FROM ingest_runs WHERE id = ?`, runId);

  return {
    id: run.id,
    source_type: run.source_type,
    status: run.status,
    rows_fetched: Number(run.rows_fetched || 0),
    rows_new: Number(run.rows_new || 0),
    deleted,
  };
}
