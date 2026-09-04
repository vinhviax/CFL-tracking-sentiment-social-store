// Runs the real migrations and the real service code against a real libSQL database.
//
// libsqlAdapter.test.ts proves the adapter has D1's *shape*; this proves the app's
// actual SQL runs on libSQL. That is the question the Dokploy migration turns on, and
// the only way to answer it is to execute the migrations and the queries for real —
// mocks would happily accept SQL that SQLite rejects.
//
// Uses an in-memory database, so it needs no server and leaves nothing behind.
import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { createLibsqlD1, type D1Like } from "./libsqlAdapter";
import { loadQueueActivity, needsRecount, refreshRunCounts } from "../services/runCounters";
import { loadTokenUsageByRange } from "../services/tokenUsage";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

let db: D1Like;
let env: any;

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });

  // Apply every migration in filename order, exactly as wrangler does.
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  expect(files.length).toBeGreaterThanOrEqual(19);
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.executeMultiple(sql);
    } catch (e: any) {
      throw new Error(`Migration ${file} failed on libSQL: ${e?.message || e}`);
    }
  }

  db = createLibsqlD1(client as any);
  env = { DB: db };
});

describe("the migrations themselves run on libSQL", () => {
  test("every table the app queries exists after migrating", async () => {
    const res = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .bind()
      .all<{ name: string }>();
    const tables = res.results.map((r) => r.name);

    for (const expected of [
      "analyses",
      "analysis_corrections",
      "analyze_jobs",
      "comment_subtopics",
      "comment_translations",
      "comments",
      "feedback_memories",
      "ingest_cursors",
      "ingest_runs",
      "llm_agent_configs",
      "llm_provider_secrets",
      "llm_slot_state",
      "posts",
      "processing_logs",
      "processing_queue",
      "saved_insights",
      "taxonomy_subtopics",
    ]) {
      expect(tables, `missing table ${expected}`).toContain(expected);
    }
  });

  test("the counter columns and partial indexes from the D1 incident exist", async () => {
    const cols = await db.prepare("PRAGMA table_info(ingest_runs)").bind().all<{ name: string }>();
    const names = cols.results.map((c) => c.name);
    for (const col of [
      "comment_count",
      "analyzed_count",
      "translated_zh_cn_count",
      "data_start_date",
      "data_end_date",
      "counts_updated_at",
    ]) {
      expect(names, `missing column ${col}`).toContain(col);
    }

    // Partial indexes are the fix that made token usage cheap; SQLite supports them,
    // but a syntax slip would only show up here.
    const idx = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_processing_logs_billed%'")
      .bind()
      .all<{ name: string }>();
    expect(idx.results.map((i) => i.name).sort()).toEqual([
      "idx_processing_logs_billed_by_date",
      "idx_processing_logs_billed_by_job",
    ]);
  });
});

describe("real service code works through the adapter", () => {
  test("loadQueueActivity groups the queue without any per-run query", async () => {
    await db
      .prepare(
        `INSERT INTO processing_queue (job_type, run_id, progress_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind("analysis", 1, "run-1-analyze", "running", "2026-09-04T00:00:00.000Z", "2026-09-04T01:00:00.000Z")
      .run();
    await db
      .prepare(
        `INSERT INTO processing_queue (job_type, run_id, progress_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind("translation", 1, "run-1-translate", "done", "2026-09-04T00:00:00.000Z", "2026-09-04T00:30:00.000Z")
      .run();

    const activity = await loadQueueActivity(env);

    expect(activity.get(1)).toEqual({ active: true, last_touched_at: "2026-09-04T01:00:00.000Z" });
    // And the staleness rule reads it correctly.
    expect(needsRecount({ id: 1, counts_updated_at: "2026-09-04T00:45:00.000Z" }, activity.get(1))).toBe(true);
  });

  test("refreshRunCounts counts a run and writes the snapshot back", async () => {
    const run = await db
      .prepare(
        `INSERT INTO ingest_runs (source_type, started_at, status, rows_fetched, rows_new)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind("fb_group_csv", "2026-09-04T00:00:00.000Z", "done", 3, 3)
      .run();
    const runId = run.meta.last_row_id;
    expect(runId).toBeGreaterThan(0);

    for (const [i, created] of [["a", "2026-08-01T00:00:00.000Z"], ["b", "2026-08-05T00:00:00.000Z"], ["c", "2026-08-09T00:00:00.000Z"]].entries()) {
      const [message, createdAt] = created as [string, string];
      const inserted = await db
        .prepare(
          `INSERT INTO comments (source_type, created_at, message, dedupe_hash, ingest_run_id, skipped_analysis)
           VALUES (?, ?, ?, ?, ?, 0)`
        )
        .bind("fb_group_csv", createdAt, message, `hash-${runId}-${i}`, runId)
        .run();
      // Analyse only the first of the three, so analyzed_count must come back as 1.
      if (i === 0) {
        await db
          .prepare(
            `INSERT INTO analyses (comment_id, topic_main, sentiment, summary, confidence, provider, model, prompt_version, status, analyzed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(inserted.meta.last_row_id, "lag_fps", "negative", "s", 0.9, "vng_lite", "gemini/gemini-3.5-flash-lite", "v4", "ok", "2026-09-04T00:00:00.000Z")
          .run();
      }
    }

    const snapshots = await refreshRunCounts(env, [runId]);
    const snapshot = snapshots.get(runId)!;

    expect(snapshot.comment_count).toBe(3);
    expect(snapshot.analyzed_count).toBe(1);
    expect(snapshot.translated_zh_cn_count).toBe(0);
    // SUBSTR-based date range still behaves the same on libSQL.
    expect(snapshot.data_start_date).toBe("2026-08-01");
    expect(snapshot.data_end_date).toBe("2026-08-09");

    // And it persisted, which is what makes the next page load cheap.
    const stored = await db
      .prepare("SELECT comment_count, analyzed_count, counts_updated_at FROM ingest_runs WHERE id = ?")
      .bind(runId)
      .first<{ comment_count: number; analyzed_count: number; counts_updated_at: string }>();
    expect(stored!.comment_count).toBe(3);
    expect(stored!.analyzed_count).toBe(1);
    expect(stored!.counts_updated_at).toBeTruthy();
  });

  test("token usage aggregation runs, including its timezone-bucketed date filter", async () => {
    await db
      .prepare(
        `INSERT INTO processing_logs (processing_job_id, progress_key, job_type, level, phase, message, model, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(1, "run-1-analyze", "analysis", "success", "llm_batch", "done", "gemini/gemini-3.5-flash-lite", 888, 1821, "2026-09-04T03:00:00.000Z")
      .run();

    const usage = await loadTokenUsageByRange(env, { from: "2026-09-04", to: "2026-09-04" });

    expect(usage.total.input_tokens).toBe(888);
    expect(usage.total.output_tokens).toBe(1821);
    expect(usage.by_model[0].model).toBe("gemini-3.5-flash-lite");
  });

  test("DB.batch inserts several rows in one round trip and returns each row id", async () => {
    const stmts = [1, 2, 3].map((n) =>
      db
        .prepare(
          `INSERT INTO posts (source_type, external_id, message, published_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind("fb_page", `batch-post-${n}`, `m${n}`, "2026-09-04T00:00:00.000Z")
    );

    const results = await db.batch(stmts);

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.meta.changes).toBe(1);
      expect(r.meta.last_row_id).toBeGreaterThan(0);
    }
    // Ids must be distinct — csvIngest links comments to posts using exactly these.
    const ids = results.map((r) => r.meta.last_row_id);
    expect(new Set(ids).size).toBe(3);
  });
});
