// Runs the real Hono app under the Node adapter, against a real libSQL database.
//
// The question this answers is the one the Dokploy migration turns on for the runtime
// half: does the app still work when nothing supplies Workers' `fetch`/`ExecutionContext`
// contract? Mocks cannot answer it — `c.executionCtx` throws unless something real hands
// the request an execution context, and only an actual request through the adapter shows
// whether it does.
import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createLibsqlD1 } from "../db/libsqlAdapter";
import type { Env } from "../types";
import { buildNodeEnv } from "./nodeEnv";
import { createNodeExecutionContext, createNodeFetchHandler, startNodeServer } from "./nodeServer";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

let env: Env;
let closeDb: () => void;

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await client.executeMultiple(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  closeDb = () => client.close();
  env = buildNodeEnv({}, createLibsqlD1(client as any));
});

afterAll(() => closeDb?.());

describe("the waitUntil shim", () => {
  test("runs the background work the routes hand it", async () => {
    const ctx = createNodeExecutionContext();
    let ran = false;
    ctx.waitUntil(
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        ran = true;
      })()
    );

    expect(ran).toBe(false); // handed off, not awaited — same as Workers
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ran).toBe(true);
  });

  test("logs a failed background task instead of killing the process", async () => {
    // An unhandled rejection takes a Node process down. On Workers a rejected waitUntil
    // only ends that invocation, so every route was written assuming that blast radius.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ctx = createNodeExecutionContext();
      ctx.waitUntil(Promise.reject(new Error("background boom")));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("passThroughOnException is callable, because Hono's context exposes it", () => {
    expect(() => createNodeExecutionContext().passThroughOnException()).not.toThrow();
  });
});

describe("the Node fetch handler serves the real app", () => {
  test("answers a route that needs neither database nor context", async () => {
    const handler = createNodeFetchHandler(env);
    const res = await handler(new Request("http://localhost/api/meta"));

    expect(res.status).toBe(200);
    expect((await res.json<any>()).topics).toBeTruthy();
  });

  test("answers a route that reads the database", async () => {
    const handler = createNodeFetchHandler(env);
    const res = await handler(new Request("http://localhost/api/health"));

    expect(res.status).toBe(200);
    expect((await res.json<any>()).status).toBe("ok");
  });

  test("answers a route that drains the queue through executionCtx.waitUntil", async () => {
    // GET /api/processing/jobs is the shape that broke first without a shim: Hono throws
    // "This context has no ExecutionContext" and the route 500s.
    const handler = createNodeFetchHandler(env);
    const res = await handler(new Request("http://localhost/api/processing/jobs"));

    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test("still enforces the admin lock when a password is set", async () => {
    const handler = createNodeFetchHandler({ ...env, ADMIN_PASSWORD: "secret" });
    const res = await handler(new Request("http://localhost/api/processing/drain", { method: "POST" }));

    expect(res.status).toBe(401);
  });
});

describe("startNodeServer", () => {
  test("listens on a real socket and answers over HTTP", async () => {
    const server = await startNodeServer({ env, port: 0 });
    try {
      expect(server.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${server.port}/api/meta`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).prompt_version).toBeTruthy();
    } finally {
      await server.close();
    }
  });
});
