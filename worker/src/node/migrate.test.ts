// Real libSQL, real migration files. A mock would prove only that the runner calls the
// functions it calls; what matters is that the 19 files actually apply, in order, once.
import { createClient } from "@libsql/client";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { applyMigrations, MIGRATIONS_TABLE, resolveMigrationsDir } from "./migrate";

const REAL_MIGRATIONS = join(__dirname, "..", "..", "migrations");

function memoryClient() {
  return createClient({ url: ":memory:" });
}

describe("applyMigrations", () => {
  test("applies every migration file and leaves the app's schema behind", async () => {
    const client = memoryClient();
    try {
      const result = await applyMigrations(client, REAL_MIGRATIONS);

      expect(result.applied.length).toBeGreaterThanOrEqual(19);
      expect(result.skipped).toEqual([]);
      expect(result.applied).toEqual([...result.applied].sort());
      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('comments', 'processing_queue', 'llm_slot_state')"
      );
      expect(tables.rows).toHaveLength(3);
    } finally {
      client.close();
    }
  });

  test("a second run applies nothing, so booting a container twice is safe", async () => {
    const client = memoryClient();
    try {
      const first = await applyMigrations(client, REAL_MIGRATIONS);
      const second = await applyMigrations(client, REAL_MIGRATIONS);

      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(first.applied);
    } finally {
      client.close();
    }
  });

  test("records applied files in wrangler's own table, so a D1 dump stays consistent", async () => {
    // A dump exported from D1 carries its d1_migrations rows with it. Using the same
    // table name means restoring that dump also tells this runner what is already
    // applied — a different name would re-run all 19 migrations over live tables.
    expect(MIGRATIONS_TABLE).toBe("d1_migrations");
    const client = memoryClient();
    try {
      await applyMigrations(client, REAL_MIGRATIONS);
      const rows = await client.execute(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`);
      expect(rows.rows.map((r: any) => r.name)).toContain("0001_initial_schema.sql");
    } finally {
      client.close();
    }
  });

  test("names the failing file when SQL does not apply", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfl-migrations-"));
    writeFileSync(join(dir, "0001_ok.sql"), "CREATE TABLE a (id INTEGER);");
    writeFileSync(join(dir, "0002_broken.sql"), "CREATE TABLE ;");
    const client = memoryClient();
    try {
      await expect(applyMigrations(client, dir)).rejects.toThrow(/0002_broken\.sql/);
      // The good one before it stays applied and recorded: a rerun resumes from the break.
      const rows = await client.execute(`SELECT name FROM ${MIGRATIONS_TABLE}`);
      expect(rows.rows.map((r: any) => r.name)).toEqual(["0001_ok.sql"]);
    } finally {
      client.close();
    }
  });

  test("ignores non-SQL files in the directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfl-migrations-"));
    writeFileSync(join(dir, "0001_ok.sql"), "CREATE TABLE a (id INTEGER);");
    writeFileSync(join(dir, "README.md"), "not a migration");
    const client = memoryClient();
    try {
      expect((await applyMigrations(client, dir)).applied).toEqual(["0001_ok.sql"]);
    } finally {
      client.close();
    }
  });
});

describe("resolveMigrationsDir", () => {
  test("defaults to ./migrations next to the working directory", () => {
    expect(resolveMigrationsDir({}, "/app")).toBe(resolve("/app", "migrations"));
  });

  test("MIGRATIONS_DIR overrides it", () => {
    expect(resolveMigrationsDir({ MIGRATIONS_DIR: "/elsewhere/sql" }, "/app")).toBe("/elsewhere/sql");
  });
});
