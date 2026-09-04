import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildNodeEnv, createLibsqlDatabase, NODE_VAR_DEFAULTS, resolvePort } from "./nodeEnv";

const fakeDb = { prepare: () => ({}) } as any;

/**
 * On Workers these values came from wrangler.jsonc "vars". A container has no
 * wrangler.jsonc, so the entrypoint is now the only thing standing between the app and
 * an undefined batch size — hence the defaults, and hence the drift test below.
 */
describe("buildNodeEnv", () => {
  test("binds the database under the name every query uses", () => {
    expect(buildNodeEnv({}, fakeDb).DB).toBe(fakeDb);
  });

  test("supplies the same var defaults wrangler.jsonc used to inject", () => {
    const env = buildNodeEnv({}, fakeDb);
    expect(env.CLASSIFY_BATCH_SIZE).toBe("20");
    expect(env.ANALYSIS_BATCH_SIZE).toBe("20");
    expect(env.TRANSLATION_BATCH_SIZE).toBe("20");
    expect(env.LLM_BATCH_CONCURRENCY).toBe("2");
    expect(env.PROCESSING_JOB_MAX_BATCHES).toBe("5");
    expect(env.PROCESSING_QUEUE_CONCURRENCY).toBe("3");
    expect(env.LLM_VNG_LITE_BASE_URL).toBe("https://lite-aawp.vnggames.net/v1");
  });

  test("the defaults match wrangler.jsonc, so the two runtimes cannot drift apart", () => {
    const config = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    for (const [name, value] of Object.entries(NODE_VAR_DEFAULTS)) {
      expect(config, `${name} differs from wrangler.jsonc`).toContain(`"${name}": "${value}"`);
    }
  });

  test("process env wins over the defaults", () => {
    const env = buildNodeEnv({ CLASSIFY_BATCH_SIZE: "5", PROCESSING_QUEUE_CONCURRENCY: "1" }, fakeDb);
    expect(env.CLASSIFY_BATCH_SIZE).toBe("5");
    expect(env.PROCESSING_QUEUE_CONCURRENCY).toBe("1");
  });

  test("passes secrets straight through and leaves unset ones undefined", () => {
    const env = buildNodeEnv(
      { ADMIN_PASSWORD: "pw", LLM_VNG_LITE_API_KEY: "key", FB_PAGE_ID: "123" },
      fakeDb
    );
    expect(env.ADMIN_PASSWORD).toBe("pw");
    expect(env.LLM_VNG_LITE_API_KEY).toBe("key");
    expect(env.FB_PAGE_ID).toBe("123");
    expect(env.SENSORTOWER_API_KEY).toBeUndefined();
    expect(env.FB_ACCESS_TOKEN).toBeUndefined();
  });

  test("does not default the Viax proxy endpoint, which this network cannot reach", () => {
    // A default here would advertise a provider that fails on every single call from
    // inside the VNG network. Set it explicitly if some other host ever needs it.
    expect(buildNodeEnv({}, fakeDb).LLM_VIAX_BASE_URL).toBeUndefined();
    expect(buildNodeEnv({ LLM_VIAX_BASE_URL: "https://x/v1" }, fakeDb).LLM_VIAX_BASE_URL).toBe(
      "https://x/v1"
    );
  });
});

describe("resolvePort", () => {
  test("defaults to 8787 and accepts PORT", () => {
    expect(resolvePort({})).toBe(8787);
    expect(resolvePort({ PORT: "3000" })).toBe(3000);
  });

  test("refuses a PORT that is not a port, instead of listening somewhere surprising", () => {
    expect(() => resolvePort({ PORT: "not-a-number" })).toThrow(/PORT/);
    expect(() => resolvePort({ PORT: "70000" })).toThrow(/PORT/);
  });
});

describe("createLibsqlDatabase", () => {
  test("opens the URL it is given and speaks D1's shape", async () => {
    const { db, close } = createLibsqlDatabase({ LIBSQL_URL: ":memory:" });
    try {
      const row = await db.prepare("SELECT 1 AS one").bind().first<{ one: number }>();
      expect(row).toEqual({ one: 1 });
    } finally {
      close();
    }
  });

  test("refuses to start without LIBSQL_URL rather than inventing an empty database", () => {
    // Defaulting to a local file would boot a server that answers every request with
    // "no data" and look exactly like data loss.
    expect(() => createLibsqlDatabase({})).toThrow(/LIBSQL_URL/);
  });
});
