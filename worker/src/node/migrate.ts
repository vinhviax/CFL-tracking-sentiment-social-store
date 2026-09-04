// Applies the migrations in migrations/ to a libSQL database.
//
// `wrangler d1 migrations apply` does not exist outside Cloudflare, so this is what
// creates the schema in a container. The 19 files run unchanged — that is the property
// libSQL was chosen for (see db/libsqlAdapter.ts).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProcessEnv } from "./nodeEnv";

/**
 * Deliberately the same table wrangler uses.
 *
 * The data comes over as a dump exported from D1, and that dump carries its own
 * d1_migrations rows. Sharing the name means a restored dump already tells this runner
 * which migrations are applied; a different name would re-run all 19 over live tables.
 */
export const MIGRATIONS_TABLE = "d1_migrations";

/** The slice of the libSQL client this needs. `executeMultiple` runs a whole file. */
export interface MigrationClient {
  execute(stmt: string | { sql: string; args: unknown[] }): Promise<{ rows: unknown[] }>;
  executeMultiple(sql: string): Promise<unknown>;
}

export function resolveMigrationsDir(source: ProcessEnv, cwd = process.cwd()): string {
  const configured = source.MIGRATIONS_DIR;
  if (configured) return configured;
  return resolve(cwd, "migrations");
}

export interface MigrationOutcome {
  applied: string[];
  skipped: string[];
}

export async function applyMigrations(
  client: MigrationClient,
  dir: string
): Promise<MigrationOutcome> {
  await client.executeMultiple(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT UNIQUE,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`
  );

  const done = new Set(
    (await client.execute(`SELECT name FROM ${MIGRATIONS_TABLE}`)).rows.map(
      (row: any) => String(row.name)
    )
  );
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (done.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf8");
    try {
      await client.executeMultiple(sql);
    } catch (e: any) {
      // Name the file. Without it the error is a bare SQL message with no way to tell
      // which of 19 files produced it.
      throw new Error(`Migration ${file} failed: ${e?.message || e}`);
    }
    await client.execute({
      sql: `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`,
      args: [file],
    });
    applied.push(file);
  }
  return { applied, skipped };
}
