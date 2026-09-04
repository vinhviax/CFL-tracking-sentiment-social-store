import { describe, expect, test, vi } from "vitest";
import { startApp } from "./main";

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
