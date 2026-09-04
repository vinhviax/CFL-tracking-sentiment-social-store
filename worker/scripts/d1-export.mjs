// Exports the D1 database to a directory of .sql files, ready for libsql-import.mjs.
//
//     node scripts/d1-export.mjs ./d1-dump
//
// Must run inside the daily D1 free-tier window: reads are capped at 5,000,000 rows/day
// and the whole database is roughly 600k rows, so one clean pass fits - a second attempt
// on the same day may not. Quota resets 00:00 UTC (07:00 GMT+7).
//
// Resumable: every table already written to the output directory is skipped, so if the
// quota or the network dies halfway, rerunning tomorrow continues instead of restarting.
//
// Two decisions worth knowing before changing anything here:
//
// 1. processing_logs is NOT exported whole. 433,865 of its ~487k rows carry no token
//    usage and are pure diagnostics; only the 18,235 rows matching
//    `level='success' AND phase='llm_batch'` are the source of truth for LLM cost. They
//    are pulled by query instead of by table dump.
// 2. The obvious alternative - DELETE the useless rows on D1 first, then dump the table -
//    would cost 433,865 writes against a 100,000 writes/day free-tier cap: four days of
//    quota to save one dump. Filtering on the way out costs nothing.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DB_NAME = "cfl-feedback";
const OUT_DIR = process.argv[2] || "./d1-dump";
const LOGS_TABLE = "processing_logs";
const BILLED_LOGS_FILTER = "level = 'success' AND phase = 'llm_batch'";
const LOGS_PAGE = 2000;

// wrangler's own entry script, run directly by node. Going through `npx` needs a shell
// on Windows, and a shell mangles a --command argument containing spaces and quotes:
// wrangler then reports "You must provide either --command or --file".
const WRANGLER_BIN = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

function wrangler(args, { json = false } = {}) {
  const out = execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (!json) return out;
  // wrangler prints progress lines before the JSON payload.
  const start = out.indexOf("[");
  if (start < 0) throw new Error(`No JSON in wrangler output:\n${out.slice(0, 500)}`);
  return JSON.parse(out.slice(start));
}

function query(sql) {
  const parsed = wrangler(["d1", "execute", DB_NAME, "--remote", "--json", "--command", sql], {
    json: true,
  });
  return parsed[0]?.results ?? [];
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function countInserts(file) {
  // The dump can be hundreds of MB, so it is scanned in chunks rather than read whole.
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    const needle = Buffer.from("INSERT INTO");
    let count = 0;
    let carry = Buffer.alloc(0);
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      // Keep the tail of the previous chunk so a match spanning the boundary still counts.
      const haystack = Buffer.concat([carry, buffer.subarray(0, read)]);
      let from = 0;
      for (;;) {
        const at = haystack.indexOf(needle, from);
        if (at < 0) break;
        count += 1;
        from = at + needle.length;
      }
      carry = haystack.subarray(Math.max(0, haystack.length - needle.length + 1));
    }
    return count;
  } finally {
    closeSync(fd);
  }
}

mkdirSync(OUT_DIR, { recursive: true });

// `_cf_KV` is Cloudflare's own internal table. It exists in sqlite_master but any query
// against it is rejected with `not authorized: SQLITE_AUTH [code: 7500]` - the same error
// code as an exhausted quota, which makes it easy to misdiagnose. wrangler's schema
// export leaves it out too, so nothing downstream wants it.
const tables = query(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
)
  .map((r) => r.name)
  .filter((name) => !name.startsWith("_cf_"));
console.log(`tables: ${tables.join(", ")}`);

// Schema first, so the import can run with RUN_MIGRATIONS=false.
const schemaFile = join(OUT_DIR, "000-schema.sql");
if (existsSync(schemaFile)) {
  console.log("skip 000-schema.sql (already exported)");
} else {
  wrangler(["d1", "export", DB_NAME, "--remote", "--no-data", "--output", schemaFile, "-y"]);
  console.log("wrote 000-schema.sql");
}

const manifest = { exported_at: new Date().toISOString(), tables: {} };
let index = 1;
for (const table of tables) {
  const file = join(OUT_DIR, `${String(index).padStart(3, "0")}-${table}.sql`);
  index += 1;
  if (existsSync(file)) {
    console.log(`skip ${table} (already exported)`);
    manifest.tables[table] = { file, skipped: true };
    continue;
  }

  if (table === LOGS_TABLE) {
    // Keyset pagination on the primary key: OFFSET would re-scan everything it skipped.
    const columns = query(`PRAGMA table_info(${LOGS_TABLE})`).map((c) => c.name);
    const lines = [`-- ${LOGS_TABLE}: only rows matching ${BILLED_LOGS_FILTER}`];
    let lastId = 0;
    let total = 0;
    for (;;) {
      const rows = query(
        `SELECT ${columns.join(", ")} FROM ${LOGS_TABLE} WHERE ${BILLED_LOGS_FILTER} AND id > ${lastId} ORDER BY id LIMIT ${LOGS_PAGE}`
      );
      if (!rows.length) break;
      for (const row of rows) {
        const values = columns.map((c) => sqlLiteral(row[c])).join(", ");
        lines.push(`INSERT INTO ${LOGS_TABLE} (${columns.join(", ")}) VALUES (${values});`);
      }
      lastId = rows[rows.length - 1].id;
      total += rows.length;
      console.log(`  ${LOGS_TABLE}: ${total} billed row(s)...`);
      if (rows.length < LOGS_PAGE) break;
    }
    writeFileSync(file, lines.join("\n") + "\n", "utf8");
    manifest.tables[table] = { file, rows: total, filtered: BILLED_LOGS_FILTER };
    console.log(`wrote ${table} (${total} billed rows)`);
    continue;
  }

  wrangler([
    "d1", "export", DB_NAME, "--remote", "--table", table, "--no-schema", "--output", file, "-y",
  ]);
  // Count from the file, never with `SELECT COUNT(*)`. D1 charges for rows *scanned*, so
  // counting a big table costs as much as exporting it - and it was exactly that extra
  // scan that burned the last of the daily quota after `analyses` came across on
  // 2026-09-04, stopping the export half way.
  const rows = countInserts(file);
  manifest.tables[table] = { file, rows };
  console.log(`wrote ${table} (${rows} rows)`);
}

writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(`\ndone - ${join(OUT_DIR, "manifest.json")} written`);
console.log(`next: node scripts/libsql-import.mjs ${OUT_DIR} file:/path/to/cfl-feedback.db`);
