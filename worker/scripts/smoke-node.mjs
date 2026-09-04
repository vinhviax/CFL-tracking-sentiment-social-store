// End-to-end smoke test of the Node build: the whole app, over real HTTP, on a real
// libSQL file — the same path the container takes.
//
// Run it after `npm run build:node`:
//     npm run smoke:node
//
// It boots dist/server.js against a throwaway database, uploads a Facebook CSV through
// the real multipart route, reads the data back out through the API, restarts the process
// to prove the migrations are idempotent and the file survives, then cleans up.
//
// The LLM leg is deliberately not asserted: no key is configured, so the queue logs
// "slot ... không có provider khả dụng" and leaves the comments unanalysed. What is
// asserted is that this does not take the process down — a container has to stay up when
// the gateway is unreachable. To exercise the real LLM, export LLM_VNG_LITE_API_KEY and
// point both slots at vng_lite first (POST /api/llm-config), then re-run.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = Number(process.env.SMOKE_PORT || 8790);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "smoke-password";

if (!existsSync(join(WORKER_DIR, "dist", "server.js"))) {
  console.error("dist/server.js is missing — run `npm run build:node` first.");
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "cfl-smoke-"));
const dbFile = join(workDir, "cfl-feedback.db");
const csvFile = join(workDir, "sample.csv");

// Tab-delimited, five columns, with a Store row that must be skipped. Generated rather
// than committed because .gitignore excludes *.csv (data never belongs in the repo).
writeFileSync(
  csvFile,
  [
    ["Source", "Post Published Date", "Post Message", "Created Date", "Comment Message"],
    ["Fanpage", "2026-09-01", "Ban cap nhat moi da len", "2026-09-01 10:00:00", "Game lag qua tro khong noi"],
    ["Group", "2026-09-02", "Hoi dap ve su kien", "2026-09-02 11:30:00", "Su kien nay tang qua ok lam"],
    ["Store", "2026-09-02", "bo qua dong nay", "2026-09-02 12:00:00", "dong Store phai bi bo qua"],
  ]
    .map((row) => row.join("\t"))
    .join("\n") + "\n"
);

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function startServer(extraEnv) {
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: WORKER_DIR,
    env: { ...process.env, LIBSQL_URL: `file:${dbFile}`, PORT: String(PORT), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (d) => {
      output += d;
      process.stdout.write(`[server] ${d}`);
    });
  }
  return {
    child,
    log: () => output,
    async ready() {
      for (let i = 0; i < 80; i += 1) {
        if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
        try {
          if ((await fetch(`${BASE}/api/meta`)).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("server never became reachable");
    },
    async stop() {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 800));
    },
  };
}

const get = async (path) => (await fetch(`${BASE}${path}`)).json();
const listOf = (body) => body.items ?? body;

let server = startServer({ ADMIN_PASSWORD, CRON_ENABLED: "true" });
try {
  await server.ready();
  const migrationLine = server.log().match(/migrations: .*/)?.[0] || "";
  check("migrations run at boot, before the first request", /19 applied/.test(migrationLine), migrationLine);
  check("the three cron schedules start in UTC", /cron schedules started \(UTC\)/.test(server.log()));

  const health = await get("/api/health");
  check("GET /api/health", health.status === "ok", `prompt ${health.prompt_version}`);

  const denied = await fetch(`${BASE}/api/ingest/upload-csv`, { method: "POST" });
  check("the admin lock still refuses an unauthenticated write", denied.status === 401);

  const form = new FormData();
  form.set("file", new Blob([readFileSync(csvFile)], { type: "text/csv" }), "sample.csv");
  const uploadRes = await fetch(`${BASE}/api/ingest/upload-csv`, {
    method: "POST",
    headers: { "X-CFL-Admin-Key": ADMIN_PASSWORD },
    body: form,
  });
  const upload = await uploadRes.json();
  check("POST /api/ingest/upload-csv imports the two Facebook rows", uploadRes.ok && upload.rows_new === 2, `rows_new=${upload.rows_new}`);
  check("the Store row is skipped", JSON.parse(upload.note || "{}").skipped_non_facebook === 1);
  check("analysis and translation get queued automatically", Boolean(upload.auto_processing?.queued));

  const comments = listOf(await get("/api/comments?limit=10"));
  check("GET /api/comments returns what was ingested", comments.length === 2, `${comments.length} comment(s)`);
  const sources = new Set(comments.map((c) => c.source_type));
  check("Fanpage and Group land under the right source_type", sources.has("fb_page") && sources.has("fb_group_csv"), [...sources].join(","));

  check("GET /api/runs lists the ingest run", listOf(await get("/api/runs?limit=5")).length >= 1);
  // This route drains the queue via c.executionCtx.waitUntil: without the shim in
  // src/node/nodeServer.ts it 500s instead.
  check("GET /api/processing/jobs works", Array.isArray(await get("/api/processing/jobs")));
  check("GET /api/ingest/status works", Boolean(await get("/api/ingest/status")));
  check("GET /api/stats/overview works", Boolean(await get("/api/stats/overview")));

  const drain = await fetch(`${BASE}/api/processing/drain`, {
    method: "POST",
    headers: { "X-CFL-Admin-Key": ADMIN_PASSWORD },
  });
  check("POST /api/processing/drain answers with no LLM key configured", drain.ok);
  check("the process is still serving after a batch that could not run", (await fetch(`${BASE}/api/meta`)).ok);
} finally {
  await server.stop();
}

// Restart against the same file: this is the container coming back up on its volume.
server = startServer({ CRON_ENABLED: "false" });
try {
  await server.ready();
  const migrationLine = server.log().match(/migrations: .*/)?.[0] || "";
  check("a restart applies no migrations a second time", /0 applied, 19 already present/.test(migrationLine), migrationLine);
  check("CRON_ENABLED=false starts no schedules", /cron schedules disabled/.test(server.log()));
  check("the data is still there after the restart", listOf(await get("/api/comments?limit=10")).length === 2);
} finally {
  await server.stop();
  rmSync(workDir, { recursive: true, force: true });
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
