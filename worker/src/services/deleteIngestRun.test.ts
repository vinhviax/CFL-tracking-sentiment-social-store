import { describe, expect, test } from "vitest";
import { deleteIngestRun } from "./deleteIngestRun";

function fakeDb(runRow: any = { id: 13, source_type: "fb_group_csv", status: "done", rows_fetched: 10, rows_new: 8 }) {
  const calls: { op: string; sql: string; args: any[] }[] = [];
  const counts = [8, 7, 6, 5, 4, 3, 2, 1];
  const db = {
    calls,
    prepare(sql: string) {
      const stmt = {
        args: [] as any[],
        bind(...args: any[]) {
          stmt.args = args;
          return stmt;
        },
        async first() {
          calls.push({ op: "first", sql, args: stmt.args });
          if (sql.includes("FROM ingest_runs") && sql.includes("WHERE id = ?")) return runRow;
          if (sql.includes("COUNT(*)")) return { n: counts.shift() ?? 0 };
          return null;
        },
        async run() {
          calls.push({ op: "run", sql, args: stmt.args });
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return db as any;
}

describe("deleteIngestRun", () => {
  test("returns null when the run does not exist", async () => {
    const db = fakeDb(null);

    await expect(deleteIngestRun(db, 404)).resolves.toBeNull();

    expect(db.calls.filter((call: any) => call.op === "run")).toHaveLength(0);
  });

  test("deletes dependent ingest data before deleting comments and the run", async () => {
    const db = fakeDb();

    const result = await deleteIngestRun(db, 13);

    expect(result).toMatchObject({
      id: 13,
      source_type: "fb_group_csv",
      deleted: {
        comments: 8,
        analyses: 7,
        translations: 6,
        comment_subtopics: 5,
        feedback_memories: 3,
        processing_logs: 1,
      },
    });

    const runSqls = db.calls
      .filter((call: any) => call.op === "run")
      .map((call: any) => call.sql.replace(/\s+/g, " ").trim());

    expect(runSqls[0]).toContain("DELETE FROM processing_logs");
    expect(runSqls[1]).toContain("DELETE FROM analyze_jobs");
    expect(runSqls[2]).toContain("DELETE FROM processing_queue");
    expect(runSqls).toEqual(expect.arrayContaining([
      expect.stringContaining("UPDATE ingest_cursors"),
      expect.stringContaining("DELETE FROM memory_evidence WHERE memory_id IN"),
      expect.stringContaining("DELETE FROM memory_evidence WHERE comment_id IN"),
      expect.stringContaining("DELETE FROM feedback_memories WHERE run_id = ?"),
      expect.stringContaining("DELETE FROM comment_subtopics WHERE comment_id IN"),
      expect.stringContaining("DELETE FROM comment_translations WHERE comment_id IN"),
      expect.stringContaining("DELETE FROM analyses WHERE comment_id IN"),
      expect.stringContaining("DELETE FROM comments WHERE ingest_run_id = ?"),
      expect.stringContaining("DELETE FROM posts WHERE id IN"),
      expect.stringContaining("DELETE FROM ingest_runs WHERE id = ?"),
    ]));
    expect(runSqls.at(-1)).toContain("DELETE FROM ingest_runs WHERE id = ?");
  });
});
