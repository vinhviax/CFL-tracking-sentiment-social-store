import { describe, expect, test, vi } from "vitest";
import { createLibsqlD1 } from "./libsqlAdapter";

/**
 * Stands in for @libsql/client. Records what SQL and args it was handed so the tests
 * can assert the adapter passes them through untouched — the whole point of this layer
 * is that not one of the 133 call sites in services/ has to change.
 */
function fakeClient(result: Partial<{ rows: any[]; columns: string[]; rowsAffected: number; lastInsertRowid: bigint | undefined }> = {}) {
  const calls: { sql: string; args: unknown[] }[] = [];
  const batches: { sql: string; args: unknown[] }[][] = [];
  const client = {
    async execute(stmt: { sql: string; args: unknown[] }) {
      calls.push({ sql: stmt.sql, args: stmt.args });
      return {
        rows: result.rows ?? [],
        columns: result.columns ?? [],
        rowsAffected: result.rowsAffected ?? 0,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    async batch(stmts: { sql: string; args: unknown[] }[]) {
      batches.push(stmts.map((s) => ({ sql: s.sql, args: s.args })));
      return stmts.map(() => ({
        rows: result.rows ?? [],
        columns: result.columns ?? [],
        rowsAffected: result.rowsAffected ?? 0,
        lastInsertRowid: result.lastInsertRowid,
      }));
    },
  };
  return { client, calls, batches };
}

describe("libSQL adapter speaks D1's shape", () => {
  test("all() returns rows under a results key, like D1", async () => {
    const { client, calls } = fakeClient({
      columns: ["id", "status"],
      rows: [{ id: 7, status: "done" }],
    });
    const db = createLibsqlD1(client as any);

    const res = await db.prepare("SELECT id, status FROM ingest_runs WHERE id = ?").bind(7).all();

    expect(res.results).toEqual([{ id: 7, status: "done" }]);
    expect(calls).toEqual([{ sql: "SELECT id, status FROM ingest_runs WHERE id = ?", args: [7] }]);
  });

  test("first() returns the single row, or null when there is none", async () => {
    const withRow = createLibsqlD1(fakeClient({ columns: ["n"], rows: [{ n: 3 }] }).client as any);
    expect(await withRow.prepare("SELECT COUNT(*) AS n FROM comments").bind().first()).toEqual({ n: 3 });

    const empty = createLibsqlD1(fakeClient({ rows: [] }).client as any);
    expect(await empty.prepare("SELECT 1").bind().first()).toBeNull();
  });

  test("run() exposes meta.changes and meta.last_row_id", async () => {
    // Nine call sites read these two fields — csvIngest and facebook use last_row_id as
    // the new run's id, deleteIngestRun counts changes. BigInt must become a number or
    // `Number(meta.last_row_id)` silently produces something unusable downstream.
    const { client } = fakeClient({ rowsAffected: 4, lastInsertRowid: 134n });
    const db = createLibsqlD1(client as any);

    const res = await db.prepare("INSERT INTO ingest_runs (source_type) VALUES (?)").bind("store").run();

    expect(res.meta.changes).toBe(4);
    expect(res.meta.last_row_id).toBe(134);
    expect(typeof res.meta.last_row_id).toBe("number");
  });

  test("run() reports last_row_id 0 when the statement inserted nothing", async () => {
    const { client } = fakeClient({ rowsAffected: 0, lastInsertRowid: undefined });
    const db = createLibsqlD1(client as any);
    const res = await db.prepare("UPDATE ingest_runs SET status = 'done'").bind().run();
    expect(res.meta.last_row_id).toBe(0);
    expect(res.meta.changes).toBe(0);
  });

  test("bind() with no arguments works, as D1 allows", async () => {
    const { client, calls } = fakeClient({ rows: [] });
    const db = createLibsqlD1(client as any);
    await db.prepare("SELECT run_id FROM processing_queue GROUP BY run_id").bind().all();
    expect(calls[0].args).toEqual([]);
  });

  test("a statement used without bind() at all still runs", async () => {
    const { client, calls } = fakeClient({ rows: [] });
    const db = createLibsqlD1(client as any);
    await db.prepare("SELECT 1").all();
    expect(calls[0]).toEqual({ sql: "SELECT 1", args: [] });
  });

  test("batch() sends every bound statement in one call, in order", async () => {
    const { client, batches } = fakeClient({ rowsAffected: 1, lastInsertRowid: 9n });
    const db = createLibsqlD1(client as any);

    const res = await db.batch([
      db.prepare("INSERT INTO analyses (comment_id) VALUES (?)").bind(1),
      db.prepare("INSERT INTO analyses (comment_id) VALUES (?)").bind(2),
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      { sql: "INSERT INTO analyses (comment_id) VALUES (?)", args: [1] },
      { sql: "INSERT INTO analyses (comment_id) VALUES (?)", args: [2] },
    ]);
    // Callers index into the returned array and read .meta, same as on D1.
    expect(res[0].meta.last_row_id).toBe(9);
    expect(res[1].meta.changes).toBe(1);
  });

  test("an empty batch does not hit the database", async () => {
    const { client, batches } = fakeClient();
    const db = createLibsqlD1(client as any);
    expect(await db.batch([])).toEqual([]);
    expect(batches).toEqual([]);
  });

  test("a statement can be reused after bind, without leaking args between uses", async () => {
    // services/ builds statements in loops; a shared mutable args array would make the
    // second iteration send the first one's parameters.
    const { client, calls } = fakeClient({ rows: [] });
    const db = createLibsqlD1(client as any);
    const stmt = db.prepare("SELECT * FROM comments WHERE ingest_run_id = ?");

    await stmt.bind(1).all();
    await stmt.bind(2).all();

    expect(calls.map((c) => c.args)).toEqual([[1], [2]]);
  });

  test("undefined binds become null, which SQLite accepts and D1 also does", async () => {
    const { client, calls } = fakeClient({ rows: [] });
    const db = createLibsqlD1(client as any);
    await db.prepare("INSERT INTO ingest_runs (note, error) VALUES (?, ?)").bind(undefined, null).run();
    expect(calls[0].args).toEqual([null, null]);
  });
});
