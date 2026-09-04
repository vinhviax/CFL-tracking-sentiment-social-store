// Rehearsal of the D1 -> libSQL data move, run entirely without D1.
//
//     npm run build:node && npm run build:import && npm run smoke:import
//
// Worth keeping: the first run of this found two real defects that would have surfaced
// only against the 310MB production dump - a per-table dump applies `comments` before
// `posts` (alphabetical order), which fails on libSQL's foreign keys, and the integrity
// check that replaces them has to run after the last file rather than after each one.
//
// A: boot on a fresh db and ingest a CSV, so the data and schema are the real ones.
// B: dump that db the way `wrangler d1 export` does (schema file + per-table INSERTs).
// C: import it into an empty db with scripts/libsql-import.mjs.
// D: boot on the imported db with RUN_MIGRATIONS=false and read it back through the API.

import { createClient } from "@libsql/client";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORK = process.argv[2] || join(tmpdir(), "cfl-smoke-import");
const ADMIN = "rehearsal-pw";
rmSync(WORK, { recursive: true, force: true });
mkdirSync(join(WORK, "dump"), { recursive: true });

const dbA = join(WORK, "source.db");
const dbB = join(WORK, "imported.db");
const csv = join(WORK, "sample.csv");
writeFileSync(
  csv,
  [
    ["Source", "Post Published Date", "Post Message", "Created Date", "Comment Message"],
    ["Fanpage", "2026-09-01", "Ban cap nhat moi", "2026-09-01 10:00:00", "lag qua; choi khong noi, sua giup"],
    ["Group", "2026-09-02", "Hoi dap su kien", "2026-09-02 11:30:00", "Cập nhật xong vẫn 'lag'; mong fix"],
  ].map((r) => r.join("\t")).join("\n") + "\n",
  "utf8"
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
};

async function withServer(env, port, fn) {
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const s of [child.stdout, child.stderr]) s.on("data", (d) => (log += d));
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/meta`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    return await fn(`http://127.0.0.1:${port}`, () => log);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 700));
  }
}

// A ---------------------------------------------------------------------------
await withServer({ LIBSQL_URL: `file:${dbA}`, ADMIN_PASSWORD: ADMIN, CRON_ENABLED: "false" }, 8796, async (base) => {
  const form = new FormData();
  form.set("file", new Blob([readFileSync(csv)], { type: "text/csv" }), "sample.csv");
  const res = await fetch(`${base}/api/ingest/upload-csv`, {
    method: "POST", headers: { "X-CFL-Admin-Key": ADMIN }, body: form,
  });
  const body = await res.json();
  check("A: source database populated by a real ingest", res.ok && body.rows_new === 2, `rows_new=${body.rows_new}`);
});

// B --------------------------------------------------------------------------- 
const src = createClient({ url: `file:${dbA}` });
const objects = await src.execute(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name"
);
const schemaLines = ["PRAGMA defer_foreign_keys=TRUE;"];
for (const row of objects.rows) schemaLines.push(`${row.sql};`);
writeFileSync(join(WORK, "dump", "000-schema.sql"), schemaLines.join("\n") + "\n", "utf8");

const lit = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
};
const tables = (await src.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
)).rows.map((r) => r.name);
let sourceRows = 0;
let index = 1;
for (const table of tables) {
  const rows = await src.execute(`SELECT * FROM "${table}"`);
  if (!rows.rows.length) { index++; continue; }
  const cols = rows.columns;
  const lines = rows.rows.map(
    (row) => `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => lit(row[c])).join(", ")});`
  );
  sourceRows += rows.rows.length;
  writeFileSync(join(WORK, "dump", `${String(index).padStart(3, "0")}-${table}.sql`), lines.join("\n") + "\n", "utf8");
  index++;
}
src.close();
check("B: dump written (schema + per-table INSERTs)", sourceRows > 0, `${sourceRows} data row(s) across ${tables.length} tables`);

// C ---------------------------------------------------------------------------
const out = execFileSync(process.execPath, ["scripts/libsql-import.mjs", join(WORK, "dump"), `file:${dbB}`], { encoding: "utf8" });
console.log(out.split("\n").filter((l) => l.includes("statements") || l.includes("comments:") || l.includes("ingest_runs:")).join("\n"));
check("C: import ran with no error", /statements applied/.test(out));

// The guard: a second import into the same file must refuse.
let refused = false;
try { execFileSync(process.execPath, ["scripts/libsql-import.mjs", join(WORK, "dump"), `file:${dbB}`], { encoding: "utf8", stdio: "pipe" }); }
catch { refused = true; }
check("C: importing into a non-empty database is refused", refused);

// D ---------------------------------------------------------------------------
await withServer({ LIBSQL_URL: `file:${dbB}`, RUN_MIGRATIONS: "false", CRON_ENABLED: "false" }, 8797, async (base, log) => {
  check("D: booted without running migrations", !/migrations: \d+ applied/.test(log()));
  const comments = await (await fetch(`${base}/api/comments?limit=10`)).json();
  const items = comments.items ?? comments;
  check("D: the imported comments read back through the API", items.length === 2, `${items.length} comment(s)`);
  const messages = items.map((c) => c.message).sort();
  check(
    "D: text with semicolons, apostrophes and Vietnamese survived the round trip",
    messages.some((m) => m.includes("lag qua; choi khong noi")) &&
      messages.some((m) => m.includes("Cập nhật xong vẫn 'lag'; mong fix")),
    messages.join(" | ")
  );
  const runs = await (await fetch(`${base}/api/runs?limit=5`)).json();
  check("D: the ingest run came across too", (runs.items ?? runs).length >= 1);
  check("D: queue endpoint works on the imported database", Array.isArray(await (await fetch(`${base}/api/processing/jobs`)).json()));
  const stats = await (await fetch(`${base}/api/stats/overview`)).json();
  check("D: stats endpoint works on the imported database", Boolean(stats));
});

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
