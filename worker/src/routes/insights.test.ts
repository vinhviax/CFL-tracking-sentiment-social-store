import { describe, expect, test } from "vitest";
import { insightsRoute } from "./insights";

function fakeDb(savedRow: any) {
  const calls: { op: string; sql: string; args: any[] }[] = [];
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
          if (sql.includes("FROM saved_insights") && sql.includes("WHERE id = ?")) return savedRow;
          return null;
        },
        async run() {
          calls.push({ op: "run", sql, args: stmt.args });
          return { meta: { changes: savedRow ? 1 : 0 } };
        },
      };
      return stmt;
    },
  };
  return db as any;
}

describe("insightsRoute saved insight delete", () => {
  test("deletes a saved insight", async () => {
    const db = fakeDb({ id: 7 });

    const res = await insightsRoute.request("/saved/7", { method: "DELETE" }, { DB: db } as any);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: 7, deleted: true });
    expect(db.calls.map((call: any) => call.sql.replace(/\s+/g, " ").trim())).toEqual([
      "SELECT id FROM saved_insights WHERE id = ?",
      "DELETE FROM saved_insights WHERE id = ?",
    ]);
  });

  test("returns 404 when a saved insight does not exist", async () => {
    const db = fakeDb(null);

    const res = await insightsRoute.request("/saved/404", { method: "DELETE" }, { DB: db } as any);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ detail: "Saved insight not found" });
  });
});
