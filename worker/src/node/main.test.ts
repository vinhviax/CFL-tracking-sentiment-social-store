import { describe, expect, test, vi } from "vitest";
import { startApp } from "./main";
import type { ScheduleFn } from "./cron";

function fakeScheduler() {
  const registered: string[] = [];
  const stopped: string[] = [];
  const schedule: ScheduleFn = (expression) => {
    registered.push(expression);
    return { stop: () => void stopped.push(expression) };
  };
  return { registered, stopped, schedule };
}

describe("startApp", () => {
  test("boots the whole thing from a process environment and serves requests", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const app = await startApp({ LIBSQL_URL: ":memory:", PORT: "0" });
    try {
      const res = await fetch(`http://127.0.0.1:${app.port}/api/meta`);
      expect(res.status).toBe(200);
    } finally {
      await app.shutdown();
      log.mockRestore();
    }
  });

  test("stops listening after shutdown, and closing twice is harmless", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const app = await startApp({ LIBSQL_URL: ":memory:", PORT: "0" });
    const { port } = app;
    await app.shutdown();
    await app.shutdown();
    log.mockRestore();

    await expect(fetch(`http://127.0.0.1:${port}/api/meta`)).rejects.toThrow();
  });

  test("fails loudly when the database URL is missing instead of serving an empty app", async () => {
    await expect(startApp({ PORT: "0" })).rejects.toThrow(/LIBSQL_URL/);
  });
});

describe("startApp and the cron schedules", () => {
  test("starts the three schedules alongside the server, and stops them on shutdown", async () => {
    // Cloudflare woke the worker for these; in a container nothing else will.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { registered, stopped, schedule } = fakeScheduler();
    const app = await startApp({ LIBSQL_URL: ":memory:", PORT: "0" }, { schedule });

    expect(registered).toHaveLength(3);
    await app.shutdown();
    log.mockRestore();

    expect(stopped).toEqual(registered);
  });

  test("CRON_ENABLED=false serves requests without scheduling anything", async () => {
    // What a second replica behind a load balancer needs: one process owns the
    // schedules, the rest only answer requests, or every job runs twice.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { registered, schedule } = fakeScheduler();
    const app = await startApp(
      { LIBSQL_URL: ":memory:", PORT: "0", CRON_ENABLED: "false" },
      { schedule }
    );
    try {
      expect(registered).toEqual([]);
      expect((await fetch(`http://127.0.0.1:${app.port}/api/meta`)).status).toBe(200);
    } finally {
      await app.shutdown();
      log.mockRestore();
    }
  });
});
