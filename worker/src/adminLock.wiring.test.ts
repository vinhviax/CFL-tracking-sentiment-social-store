import { describe, expect, test, vi } from "vitest";

/**
 * The lock is only worth anything if it is mounted on the right paths, so this walks
 * the real app with every route module stubbed out: a 200 means the request reached
 * the handler, a 401 means the middleware stopped it.
 */

async function stubRoute() {
  const { Hono } = await import("hono");
  const route = new Hono();
  route.all("/*", (c) => c.json({ reached: true }));
  return route;
}

vi.mock("./routes/admin", async () => {
  const { adminRoute } = await vi.importActual<typeof import("./routes/admin")>("./routes/admin");
  return { adminRoute };
});
vi.mock("./routes/analyze", async () => ({ analyzeRoute: await stubRoute() }));
vi.mock("./routes/comments", async () => ({ commentsRoute: await stubRoute() }));
vi.mock("./routes/export", async () => ({ exportRoute: await stubRoute() }));
vi.mock("./routes/gameModes", async () => ({ gameModesRoute: await stubRoute() }));
vi.mock("./routes/ingest", async () => ({ ingestRoute: await stubRoute() }));
vi.mock("./routes/insights", async () => ({ insightsRoute: await stubRoute() }));
vi.mock("./routes/llmConfig", async () => ({ llmConfigRoute: await stubRoute() }));
vi.mock("./routes/posts", async () => ({ postsRoute: await stubRoute() }));
vi.mock("./routes/processing", async () => ({ processingRoute: await stubRoute() }));
vi.mock("./routes/report", async () => ({ reportRoute: await stubRoute() }));
vi.mock("./routes/runs", async () => ({ runsRoute: await stubRoute() }));
vi.mock("./routes/stats", async () => ({ statsRoute: await stubRoute() }));
vi.mock("./routes/translate", async () => ({ translateRoute: await stubRoute() }));

import worker from "./index";

const PASSWORD = "khoa-ingest";
const env = { ADMIN_PASSWORD: PASSWORD } as any;

function call(path: string, method: string, key?: string) {
  return worker.fetch(
    new Request(`https://worker.test${path}`, {
      method,
      ...(key ? { headers: { "X-CFL-Admin-Key": key } } : {}),
    }),
    env,
    {} as any
  );
}

const INGEST_WRITES: Array<[string, string]> = [
  ["/api/ingest/upload-csv", "POST"],
  ["/api/ingest/sensortower", "POST"],
  ["/api/ingest/facebook", "POST"],
  ["/api/llm-config/reasoning", "PUT"],
  ["/api/analyze/run", "POST"],
  ["/api/translate/run", "POST"],
  ["/api/runs/7", "DELETE"],
  ["/api/processing/jobs/3/cancel", "POST"],
];

describe("Ingest tab writes", () => {
  test.each(INGEST_WRITES)("%s %s is refused without the password", async (path, method) => {
    expect((await call(path, method)).status).toBe(401);
  });

  test.each(INGEST_WRITES)("%s %s goes through with the password", async (path, method) => {
    expect((await call(path, method, PASSWORD)).status).toBe(200);
  });
});

describe("what a viewer keeps", () => {
  // /api/health is left out: it hits D1 for the slot resolution, and this env is a
  // stub. It carries no middleware of its own, so the lock has nothing to prove there.
  const READS = [
    "/api/meta",
    "/api/ingest/status",
    "/api/runs",
    "/api/llm-config",
    "/api/processing/jobs",
    "/api/analyze/progress/some-key",
    "/api/stats/overview",
    "/api/comments",
  ];

  test.each(READS)("%s is readable with no password", async (path) => {
    expect((await call(path, "GET")).status).toBe(200);
  });

  // Scope is the Ingest tab only: the workspace's own writes were deliberately left open.
  const OPEN_WRITES: Array<[string, string]> = [
    ["/api/comments/41/analysis", "PATCH"],
    ["/api/insights/generate", "POST"],
    ["/api/insights/save", "POST"],
    ["/api/insights/saved/2", "DELETE"],
  ];

  test.each(OPEN_WRITES)("%s %s stays open", async (path, method) => {
    expect((await call(path, method)).status).toBe(200);
  });
});

describe("/api/admin", () => {
  test("status tells an unauthenticated tab it is read-only", async () => {
    const res = await call("/api/admin/status", "GET");
    expect(await res.json()).toEqual({ lock_enabled: true, authorized: false });
  });

  test("unlock is reachable without already being unlocked", async () => {
    const res = await worker.fetch(
      new Request("https://worker.test/api/admin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      }),
      env,
      {} as any
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lock_enabled: true, authorized: true });
  });
});
