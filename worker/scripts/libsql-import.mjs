// Loads a directory produced by d1-export.mjs into a libSQL database.
//
//     node scripts/libsql-import.mjs ./d1-dump file:/data/cfl-feedback.db
//
// Files apply in filename order, which is why the exporter numbers them: 000-schema.sql
// creates the tables, the rest fill them. Statements stream through the same splitter the
// unit tests cover (src/node/sqlDumpImport.ts) - the dump is far too large to read whole.
//
// The target must be EMPTY, and the app must then run with RUN_MIGRATIONS=false: the dump
// brings both the schema and the d1_migrations rows recording what was already applied.
// Letting the migration runner loose on top would re-run migrations over live tables.
import { createClient } from "@libsql/client";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertNoForeignKeyViolations, importSqlDump } from "../dist/sqlDumpImport.js";

const DUMP_DIR = process.argv[2];
const TARGET = process.argv[3];
if (!DUMP_DIR || !TARGET) {
  console.error("usage: node scripts/libsql-import.mjs <dump-dir> <libsql-url>");
  console.error("build the importer first: npm run build:import");
  process.exit(1);
}

const client = createClient({ url: TARGET, authToken: process.env.LIBSQL_AUTH_TOKEN });

const existing = await client.execute(
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
);
if (Number(existing.rows[0].n) > 0 && process.env.ALLOW_NONEMPTY !== "true") {
  console.error(
    `Target already has ${existing.rows[0].n} table(s). Point at a fresh database, or set ALLOW_NONEMPTY=true if you mean it.`
  );
  process.exit(1);
}

const files = readdirSync(DUMP_DIR).filter((f) => f.endsWith(".sql")).sort();
console.log(`importing ${files.length} file(s) into ${TARGET}`);

let statements = 0;
for (const file of files) {
  const path = join(DUMP_DIR, file);
  const mb = (statSync(path).size / 1024 / 1024).toFixed(1);
  process.stdout.write(`  ${file} (${mb} MB) ... `);
  const started = Date.now();
  const result = await importSqlDump(client, createReadStream(path, { encoding: "utf8" }), {
    batchSize: 500,
    // One file per table, so a child table lands before its parent; the integrity check
    // has to wait until every file is in.
    checkForeignKeys: false,
  });
  statements += result.statements;
  console.log(`${result.statements} statements in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// Now that every file is in, enforce what was switched off during the replay. A dump
// that copied only half its rows would otherwise import "successfully".
await assertNoForeignKeyViolations(client);
console.log("foreign keys: no violations");

// Report row counts so they can be compared with the exporter's manifest - an import that
// silently applied half the rows looks fine until someone opens the UI.
const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
);
console.log(`\n${statements} statements applied. Row counts:`);
for (const row of tables.rows) {
  const count = await client.execute(`SELECT COUNT(*) AS n FROM "${row.name}"`);
  console.log(`  ${row.name}: ${count.rows[0].n}`);
}
client.close();
