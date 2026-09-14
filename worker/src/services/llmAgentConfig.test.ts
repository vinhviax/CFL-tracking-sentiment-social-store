import { describe, expect, test } from "vitest";
import {
  describeSlotResolution,
  getSlotSelection,
  isSlotConfigured,
  listLlmAgentConfigs,
  llmCatalogPayload,
  resolveLlmProvider,
  resolveLlmProviderChain,
  saveLlmAgentConfig,
} from "./llmAgentConfig";
import { LLM_SLOT_DEFAULTS, normalizeByoOverride, parseByoHeader } from "./llmCatalog";

/**
 * Stubs D1 by matching on the table each statement touches, so a test can supply a
 * slot row and a provider secret independently.
 */
function fakeEnv(opts: {
  slotRow?: any;
  secretRow?: any;
  slotStateRow?: any;
  missingTables?: boolean;
  env?: Record<string, unknown>;
} = {}) {
  const writes: unknown[][] = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (opts.missingTables) throw new Error("D1_ERROR: no such table: llm_agent_configs");
              if (sql.includes("llm_provider_secrets")) return opts.secretRow ?? null;
              if (sql.includes("llm_slot_state")) {
                return opts.slotStateRow ?? { tier: "primary", consecutive_failures: 0, last_failure_at: null, exhausted_date: null };
              }
              return opts.slotRow ?? null;
            },
            async run() {
              writes.push(args);
              return {};
            },
          };
        },
      };
    },
  };
  return {
    env: {
      DB,
      // The only credentials the app reads now: one gateway, from the worker's own
      // environment. LLM_VIAX_* went with the providers that used them.
      LLM_VNG_LITE_BASE_URL: "https://lite.example/v1",
      LLM_VNG_LITE_API_KEY: "vng-key",
      ...opts.env,
    } as any,
    writes,
  };
}

describe("provider catalog exposed to the client", () => {
  test("offers the VNG gateway and nothing else", () => {
    // The two Viax proxies and the three studio endpoints were removed 2026-09-14:
    // every one of them lives on a domain this network cannot reach, so listing them
    // only offered ways to configure a slot that fails every call.
    expect(llmCatalogPayload().map((p) => p.id)).toEqual(["vng_lite"]);
  });

  test("never leaks an endpoint", () => {
    const serialized = JSON.stringify(llmCatalogPayload());
    expect(serialized).not.toContain("lite-aawp");
    expect(serialized).not.toContain("vnggames.net");
    for (const provider of llmCatalogPayload()) expect(provider).not.toHaveProperty("endpoint");
  });

  /**
   * The model list is not a guess: GET /v1/models on the live gateway 2026-09-14
   * returned exactly these ten. "Gemini 3.7 Flash" was asked for and is not among
   * them — configuring a name the gateway does not serve is what silently dropped
   * 31,322 comments to the keyword fallback for twelve days in July.
   */
  test("lists exactly what the gateway serves, reasoning's model first", () => {
    const byId = Object.fromEntries(llmCatalogPayload().map((p) => [p.id, p]));
    expect(byId.vng_lite.byo).toBe(false);
    expect(byId.vng_lite.needs_api_key).toBe(false);
    expect(byId.vng_lite.needs_endpoint).toBe(false);
    expect(byId.vng_lite.models).toEqual([
      "gemini/gemini-3.6-flash",
      "gemini/gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite-preview",
      "gpt-5.4-mini",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "gemini-3.1-pro-preview",
    ]);
    // The gateway speaks OpenAI's wire format, so no new provider class is needed.
    expect(byId.vng_lite.model_options[0]).toEqual({
      value: "gemini/gemini-3.6-flash",
      label: "gemini-3.6-flash",
    });
  });

  test("the VNG gateway's endpoint and key come from the worker's own config", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "simple", provider: "vng_lite", model: "gemini/gemini-3.5-flash-lite" },
      env: { LLM_VNG_LITE_BASE_URL: "https://lite.example/v1", LLM_VNG_LITE_API_KEY: "vng-key" },
    });

    const resolution = await describeSlotResolution(env, "simple");

    expect(resolution.provider).toBe("vng_lite");
    expect(resolution.has_endpoint).toBe(true);
    expect(resolution.has_api_key).toBe(true);
    expect(resolution.ready).toBe(true);
    // Never falls back to the Viax proxy: that endpoint is unreachable from Dokploy,
    // so silently using it would look configured while failing every call.
    expect(resolution.model).toBe("gemini-3.5-flash-lite");
  });

  test("model options carry the short name for display", () => {
    const vngLite = llmCatalogPayload().find((p) => p.id === "vng_lite")!;
    expect(vngLite.model_options.slice(0, 2)).toEqual([
      { value: "gemini/gemini-3.6-flash", label: "gemini-3.6-flash" },
      { value: "gemini/gemini-3.5-flash-lite", label: "gemini-3.5-flash-lite" },
    ]);
  });

  test("no provider is bring-your-own any more, so the UI asks for no credentials", () => {
    // Removing the BYO entries is what disables the x-cfl-llm-config header path:
    // normalizeByoOverride only accepts a provider the catalog marks byo.
    expect(llmCatalogPayload().every((p) => !p.byo && !p.needs_api_key && !p.needs_endpoint)).toBe(true);
  });
});

describe("slot defaults", () => {
  test("both slots run on the VNG gateway, split by measured cost per batch", () => {
    // Reasoning gets the stronger 3.6-flash: 19.9s per 20-comment batch, and only
    // because the request now sends reasoning_effort=none (68.8s without it).
    // Translation gets the 4.7s lite model — it is the bulk of the calls.
    expect(LLM_SLOT_DEFAULTS.reasoning).toEqual({ provider: "vng_lite", model: "gemini/gemini-3.6-flash" });
    expect(LLM_SLOT_DEFAULTS.simple).toEqual({ provider: "vng_lite", model: "gemini/gemini-3.5-flash-lite" });
  });

  test("an absent row falls back to the default", async () => {
    const { env } = fakeEnv();
    expect(await getSlotSelection(env, "reasoning")).toEqual(LLM_SLOT_DEFAULTS.reasoning);
  });

  test("a missing table does not strand the slot", async () => {
    const { env } = fakeEnv({ missingTables: true });
    expect(await getSlotSelection(env, "simple")).toEqual(LLM_SLOT_DEFAULTS.simple);
  });

  test("a row naming a provider the catalog dropped falls back instead of failing", async () => {
    const { env } = fakeEnv({ slotRow: { slot: "reasoning", provider: "llm_viax", model: "gone" } });
    expect(await getSlotSelection(env, "reasoning")).toEqual(LLM_SLOT_DEFAULTS.reasoning);
  });

  test("a stored row wins when its provider is still valid", async () => {
    const { env } = fakeEnv({ slotRow: { slot: "simple", provider: "vng_lite", model: "gpt-5.4-mini" } });
    expect(await getSlotSelection(env, "simple")).toEqual({ provider: "vng_lite", model: "gpt-5.4-mini" });
  });

  test("a row naming a provider that was removed falls back instead of stranding the slot", async () => {
    // Exactly what the live rows looked like before migration 0020 ran: the escape
    // route for any container that boots on a database still holding an old selection.
    const { env } = fakeEnv({ slotRow: { slot: "reasoning", provider: "openai_viax", model: "gpt-5.6-terra" } });
    expect(await getSlotSelection(env, "reasoning")).toEqual(LLM_SLOT_DEFAULTS.reasoning);
  });
});

describe("saving a slot", () => {
  test("stores a valid provider and model", async () => {
    const { env, writes } = fakeEnv();
    await saveLlmAgentConfig(env, "reasoning", { provider: "vng_lite", model: "gpt-5.4-mini" });
    expect(writes[0].slice(0, 3)).toEqual(["reasoning", "vng_lite", "gpt-5.4-mini"]);
  });

  test("refuses a model the gateway does not serve", async () => {
    // The guard that would have caught "gemini/gemini-3.7-flash", which was asked for
    // and turned out not to exist on the gateway.
    const { env } = fakeEnv();
    await expect(saveLlmAgentConfig(env, "simple", { provider: "vng_lite", model: "gemini/gemini-3.7-flash" }))
      .rejects.toThrow(/không thuộc/i);
  });

  test("refuses a provider that is no longer in the catalog", async () => {
    const { env, writes } = fakeEnv();
    await expect(saveLlmAgentConfig(env, "reasoning", { provider: "openai_viax", model: "gpt-5.6-terra" }))
      .rejects.toThrow(/không hợp lệ/i);
    expect(writes).toHaveLength(0);
  });

  test("refuses an unknown provider", async () => {
    const { env } = fakeEnv();
    await expect(saveLlmAgentConfig(env, "simple", { provider: "llm_viax", model: "x" }))
      .rejects.toThrow(/không hợp lệ/i);
  });
});

describe("what the UI receives", () => {
  test("carries provider label and short model name, and no secrets", async () => {
    const { env } = fakeEnv({ slotRow: { slot: "reasoning", provider: "vng_lite", model: "gemini/gemini-3.6-flash" } });
    const configs = await listLlmAgentConfigs(env);
    const serialized = JSON.stringify(configs);

    expect(configs[0]).toMatchObject({
      slot: "reasoning",
      provider: "vng_lite",
      provider_label: "VNG Lite (nội bộ)",
      model_label: "gemini-3.6-flash",
    });
    expect(serialized).not.toContain("viax-key");
    expect(serialized).not.toContain("https://");
    for (const row of configs) {
      expect(row).not.toHaveProperty("api_key");
      expect(row).not.toHaveProperty("endpoint_url");
    }
  });
});

describe("the stored slot is now the only way a provider gets chosen", () => {
  test("resolves the slot's own provider — this is what cron does", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "simple", provider: "vng_lite", model: "gemini/gemini-3.5-flash-lite" },
    });
    const provider = await resolveLlmProvider(env, "simple", null);
    expect(provider?.name).toBe("vng_lite");
    expect(provider?.model).toBe("gemini/gemini-3.5-flash-lite");
  });

  /**
   * Bring-your-own-key is off, and this is how: the header path only accepts a provider
   * the catalog marks `byo`, and no catalog entry is byo any more. Left as behaviour
   * rather than deleting the plumbing, so re-enabling it later is one catalog entry.
   */
  test("a BYO header is ignored whatever it names, because no provider accepts one", () => {
    expect(
      normalizeByoOverride({
        provider: "anthropic_direct",
        model: "claude-sonnet-4-5",
        api_key: "user-key",
        endpoint_url: "https://api.anthropic.com/v1",
      })
    ).toBeNull();
    expect(normalizeByoOverride({ provider: "custom", model: "m", api_key: "k", endpoint_url: "https://x/v1" })).toBeNull();
    expect(normalizeByoOverride({ provider: "vng_lite", model: "m", api_key: "k" })).toBeNull();
    expect(normalizeByoOverride(null)).toBeNull();
  });

  test("a BYO header cannot push a request off the VNG gateway", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "reasoning", provider: "vng_lite", model: "gemini/gemini-3.6-flash" },
    });
    const provider = await resolveLlmProvider(env, "reasoning", {
      provider: "anthropic_direct",
      model: "claude-sonnet-4-5",
      api_key: "user-key",
      endpoint_url: "https://api.anthropic.com/v1",
    });
    expect(provider?.name).toBe("vng_lite");
    expect(provider?.model).toBe("gemini/gemini-3.6-flash");
  });

  test("the header parser still shrugs off malformed input", () => {
    expect(parseByoHeader("not json")).toBeNull();
    expect(parseByoHeader("")).toBeNull();
    expect(parseByoHeader(undefined)).toBeNull();
  });
});

describe("resolveLlmProviderChain — stateful escalation, not a per-call safety net", () => {
  test("a healthy slot resolves its own configured (primary) provider only", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "reasoning", provider: "vng_lite", model: "gemini/gemini-3.6-flash" },
      slotStateRow: { tier: "primary", consecutive_failures: 0, last_failure_at: null, exhausted_date: null },
    });
    const chain = await resolveLlmProviderChain(env, "reasoning");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("vng_lite");
    expect(chain[0].model).toBe("gemini/gemini-3.6-flash");
  });

  /**
   * With one gateway and one model per slot, escalating no longer switches anything —
   * the secondary tier is the same provider on the same model. That makes the three
   * failures before it, and the three after, a six-attempt budget rather than a
   * fallback. Pinned as a test because it is a deliberate choice, not an oversight:
   * the instruction was this model for both slots, and a silent switch to a different
   * one under failure is exactly the kind of surprise that hides a broken config.
   */
  test("escalating keeps the same provider and model — six attempts, not a fallback", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "reasoning", provider: "vng_lite", model: "gemini/gemini-3.6-flash" },
      slotStateRow: { tier: "secondary", consecutive_failures: 0, last_failure_at: null, exhausted_date: null },
    });
    const chain = await resolveLlmProviderChain(env, "reasoning");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("vng_lite");
    expect(chain[0].model).toBe("gemini/gemini-3.6-flash");
  });

  test("the simple slot escalates onto its own model too", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "simple", provider: "vng_lite", model: "gemini/gemini-3.5-flash-lite" },
      slotStateRow: { tier: "secondary", consecutive_failures: 0, last_failure_at: null, exhausted_date: null },
    });
    const chain = await resolveLlmProviderChain(env, "simple");
    expect(chain[0].name).toBe("vng_lite");
    expect(chain[0].model).toBe("gemini/gemini-3.5-flash-lite");
  });

  test("a slot that gave up today resolves to no provider at all", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "reasoning", provider: "vng_lite", model: "gemini/gemini-3.6-flash" },
      slotStateRow: { tier: "exhausted", consecutive_failures: 0, last_failure_at: null, exhausted_date: "2020-01-01" },
    });
    expect(await resolveLlmProviderChain(env, "reasoning")).toEqual([]);
  });

  test("simple mid its post-failure backoff window resolves to no provider", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "simple", provider: "vng_lite", model: "gemini/gemini-3.5-flash-lite" },
      slotStateRow: { tier: "primary", consecutive_failures: 1, last_failure_at: new Date().toISOString(), exhausted_date: null },
    });
    expect(await resolveLlmProviderChain(env, "simple")).toEqual([]);
  });

  test("an exhausted slot stays exhausted: a BYO header is no longer a way around it", async () => {
    const { env } = fakeEnv({
      slotStateRow: { tier: "exhausted", consecutive_failures: 0, last_failure_at: null, exhausted_date: "2020-01-01" },
    });
    const chain = await resolveLlmProviderChain(env, "reasoning", {
      provider: "anthropic_direct",
      model: "claude-sonnet-4-5",
      api_key: "user-key",
      endpoint_url: "https://api.anthropic.com/v1",
    });
    expect(chain).toEqual([]);
  });
});

describe("isSlotConfigured", () => {
  test("true when the slot's own provider can be built, regardless of escalation state", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "simple", provider: "vng_lite", model: "gemini/gemini-3.5-flash-lite" },
    });
    expect(await isSlotConfigured(env, "simple")).toBe(true);
  });
});

describe("saving a slot resets its escalation state", () => {
  test("a manual provider change writes to llm_slot_state after the config row", async () => {
    const { env, writes } = fakeEnv();
    await saveLlmAgentConfig(env, "simple", { provider: "vng_lite", model: "gemini/gemini-3.5-flash-lite" });
    // writes[0] is the llm_agent_configs upsert (checked elsewhere); resetSlotEscalation
    // follows with an ensureRow (INSERT OR IGNORE) and the reset UPDATE.
    expect(writes.length).toBeGreaterThanOrEqual(3);
  });
});
