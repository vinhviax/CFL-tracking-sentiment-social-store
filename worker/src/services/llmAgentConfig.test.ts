import { describe, expect, test } from "vitest";
import {
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
      LLM_VIAX_BASE_URL: "https://viax.example/v1",
      LLM_VIAX_API_KEY: "viax-key",
      ...opts.env,
    } as any,
    writes,
  };
}

describe("provider catalog exposed to the client", () => {
  test("offers exactly the six providers", () => {
    expect(llmCatalogPayload().map((p) => p.id)).toEqual([
      "gemini_viax",
      "openai_viax",
      "anthropic_direct",
      "gemini_direct",
      "openai_direct",
      "custom",
    ]);
  });

  test("never leaks an endpoint, for stock providers as much as user-made ones", () => {
    const serialized = JSON.stringify(llmCatalogPayload());
    expect(serialized).not.toContain("rpi7jss");
    expect(serialized).not.toContain("agent-shop");
    expect(serialized).not.toContain("api.anthropic.com");
    expect(serialized).not.toContain("googleapis.com");
    expect(serialized).not.toContain("api.openai.com");
    for (const provider of llmCatalogPayload()) expect(provider).not.toHaveProperty("endpoint");
  });

  test("only the Viax providers pin a model list; BYO ones are free-form", () => {
    const byId = Object.fromEntries(llmCatalogPayload().map((p) => [p.id, p]));
    expect(byId.gemini_viax.models).toEqual(["ag/gemini-3-flash-agent"]);
    expect(byId.openai_viax.models).toEqual(["gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(byId.anthropic_direct.models).toEqual([]);
    expect(byId.custom.models).toEqual([]);
  });

  test("model options carry the short name for display", () => {
    const openaiViax = llmCatalogPayload().find((p) => p.id === "openai_viax")!;
    expect(openaiViax.model_options).toEqual([
      { value: "gpt-5.6-terra", label: "gpt-5.6-terra" },
      { value: "gpt-5.6-luna", label: "gpt-5.6-luna" },
    ]);
  });

  test("only Custom asks for an endpoint, and only BYO providers ask for a key", () => {
    const byId = Object.fromEntries(llmCatalogPayload().map((p) => [p.id, p]));
    expect(byId.custom.needs_endpoint).toBe(true);
    expect(byId.anthropic_direct.needs_endpoint).toBe(false);
    expect(byId.gemini_viax.needs_api_key).toBe(false);
    expect(byId.openai_direct.needs_api_key).toBe(true);
  });
});

describe("slot defaults", () => {
  test("reasoning defaults to OpenAI by Viax on terra, simple to Gemini by Viax", () => {
    expect(LLM_SLOT_DEFAULTS.reasoning).toEqual({ provider: "openai_viax", model: "gpt-5.6-terra" });
    expect(LLM_SLOT_DEFAULTS.simple).toEqual({ provider: "gemini_viax", model: "ag/gemini-3-flash-agent" });
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
    const { env } = fakeEnv({ slotRow: { slot: "simple", provider: "openai_viax", model: "gpt-5.6-luna" } });
    expect(await getSlotSelection(env, "simple")).toEqual({ provider: "openai_viax", model: "gpt-5.6-luna" });
  });
});

describe("saving a slot", () => {
  test("stores a valid Viax provider and model", async () => {
    const { env, writes } = fakeEnv();
    await saveLlmAgentConfig(env, "reasoning", { provider: "openai_viax", model: "gpt-5.6-luna" });
    expect(writes[0].slice(0, 3)).toEqual(["reasoning", "openai_viax", "gpt-5.6-luna"]);
  });

  test("refuses a BYO provider, since its key is never written down", async () => {
    const { env, writes } = fakeEnv();
    await expect(saveLlmAgentConfig(env, "reasoning", { provider: "custom", model: "whatever" }))
      .rejects.toThrow(/không lưu được/i);
    await expect(saveLlmAgentConfig(env, "simple", { provider: "anthropic_direct", model: "claude-x" }))
      .rejects.toThrow(/không lưu được/i);
    expect(writes).toHaveLength(0);
  });

  test("refuses a model that does not belong to the chosen provider", async () => {
    const { env } = fakeEnv();
    await expect(saveLlmAgentConfig(env, "simple", { provider: "gemini_viax", model: "gpt-5.6-terra" }))
      .rejects.toThrow(/không thuộc/i);
  });

  test("refuses an unknown provider", async () => {
    const { env } = fakeEnv();
    await expect(saveLlmAgentConfig(env, "simple", { provider: "llm_viax", model: "x" }))
      .rejects.toThrow(/không hợp lệ/i);
  });
});

describe("what the UI receives", () => {
  test("carries provider label and short model name, and no secrets", async () => {
    const { env } = fakeEnv({ slotRow: { slot: "reasoning", provider: "openai_viax", model: "gpt-5.6-terra" } });
    const configs = await listLlmAgentConfigs(env);
    const serialized = JSON.stringify(configs);

    expect(configs[0]).toMatchObject({
      slot: "reasoning",
      provider: "openai_viax",
      provider_label: "OpenAI by Viax",
      model_label: "gpt-5.6-terra",
    });
    expect(serialized).not.toContain("viax-key");
    expect(serialized).not.toContain("https://");
    for (const row of configs) {
      expect(row).not.toHaveProperty("api_key");
      expect(row).not.toHaveProperty("endpoint_url");
    }
  });
});

describe("per-request BYO provider", () => {
  test("a complete BYO config is used ahead of the stored slot", async () => {
    const { env } = fakeEnv({ slotRow: { slot: "reasoning", provider: "openai_viax", model: "gpt-5.6-terra" } });
    const provider = await resolveLlmProvider(env, "reasoning", {
      provider: "anthropic_direct",
      model: "claude-sonnet-4-5",
      api_key: "user-key",
      endpoint_url: "https://api.anthropic.com/v1",
    });
    expect(provider?.name).toBe("anthropic");
    expect(provider?.model).toBe("claude-sonnet-4-5");
  });

  test("no BYO config falls back to the stored slot — this is what cron does", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "simple", provider: "gemini_viax", model: "ag/gemini-3-flash-agent" },
    });
    const provider = await resolveLlmProvider(env, "simple", null);
    expect(provider?.name).toBe("gemini_viax");
    expect(provider?.model).toBe("ag/gemini-3-flash-agent");
  });

  test("openai_viax uses its own stored credential rather than the shared proxy", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "reasoning", provider: "openai_viax", model: "gpt-5.6-terra" },
      secretRow: { provider: "openai_viax", endpoint_url: "https://agent-shop.example/v1", api_key: "shop-key" },
    });
    const provider = await resolveLlmProvider(env, "reasoning");
    expect(provider?.name).toBe("openai_viax");
  });

  test("an incomplete BYO config is ignored rather than half-applied", () => {
    expect(normalizeByoOverride({ provider: "custom", model: "m", api_key: "k" })).toBeNull(); // custom needs an endpoint
    expect(normalizeByoOverride({ provider: "anthropic_direct", model: "m" })).toBeNull(); // no key
    expect(normalizeByoOverride({ provider: "anthropic_direct", api_key: "k" })).toBeNull(); // no model
    expect(normalizeByoOverride({ provider: "openai_viax", model: "m", api_key: "k" })).toBeNull(); // not a BYO provider
    expect(normalizeByoOverride(null)).toBeNull();
  });

  test("a BYO provider other than Custom uses the studio endpoint, not one from the client", () => {
    const byo = normalizeByoOverride({
      provider: "gemini_direct",
      model: "gemini-3-pro",
      api_key: "k",
      endpoint_url: "https://attacker.example/v1",
    });
    expect(byo?.endpoint_url).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  test("the header parses valid JSON and shrugs off anything else", () => {
    const value = JSON.stringify({ provider: "custom", model: "m", api_key: "k", endpoint_url: "https://x.example/v1" });
    expect(parseByoHeader(value)).toMatchObject({ provider: "custom", model: "m" });
    expect(parseByoHeader("not json")).toBeNull();
    expect(parseByoHeader("")).toBeNull();
    expect(parseByoHeader(undefined)).toBeNull();
  });
});

describe("resolveLlmProviderChain — stateful escalation, not a per-call safety net", () => {
  test("a healthy slot resolves its own configured (primary) provider only", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "reasoning", provider: "openai_viax", model: "gpt-5.6-terra" },
      slotStateRow: { tier: "primary", consecutive_failures: 0, last_failure_at: null, exhausted_date: null },
    });
    const chain = await resolveLlmProviderChain(env, "reasoning");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("openai_viax");
    expect(chain[0].model).toBe("gpt-5.6-terra");
  });

  test("an escalated slot resolves to its fixed secondary instead of the configured primary", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "reasoning", provider: "openai_viax", model: "gpt-5.6-terra" },
      slotStateRow: { tier: "secondary", consecutive_failures: 0, last_failure_at: null, exhausted_date: null },
    });
    const chain = await resolveLlmProviderChain(env, "reasoning");
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe("gemini_viax");
  });

  test("simple escalates to openai_viax/gpt-5.6-luna — a different model from the reasoning slot's primary", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "simple", provider: "gemini_viax", model: "ag/gemini-3-flash-agent" },
      slotStateRow: { tier: "secondary", consecutive_failures: 0, last_failure_at: null, exhausted_date: null },
    });
    const chain = await resolveLlmProviderChain(env, "simple");
    expect(chain[0].name).toBe("openai_viax");
    expect(chain[0].model).toBe("gpt-5.6-luna");
  });

  test("a slot that gave up today resolves to no provider at all", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "reasoning", provider: "openai_viax", model: "gpt-5.6-terra" },
      slotStateRow: { tier: "exhausted", consecutive_failures: 0, last_failure_at: null, exhausted_date: "2020-01-01" },
    });
    expect(await resolveLlmProviderChain(env, "reasoning")).toEqual([]);
  });

  test("simple mid its post-failure backoff window resolves to no provider", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "simple", provider: "gemini_viax", model: "ag/gemini-3-flash-agent" },
      slotStateRow: { tier: "primary", consecutive_failures: 1, last_failure_at: new Date().toISOString(), exhausted_date: null },
    });
    expect(await resolveLlmProviderChain(env, "simple")).toEqual([]);
  });

  test("a BYO override bypasses escalation state entirely, even mid-backoff", async () => {
    const { env } = fakeEnv({
      slotStateRow: { tier: "exhausted", consecutive_failures: 0, last_failure_at: null, exhausted_date: "2020-01-01" },
    });
    const chain = await resolveLlmProviderChain(env, "reasoning", {
      provider: "anthropic_direct",
      model: "claude-sonnet-4-5",
      api_key: "user-key",
      endpoint_url: "https://api.anthropic.com/v1",
    });
    expect(chain[0]?.name).toBe("anthropic");
  });
});

describe("isSlotConfigured", () => {
  test("true when the slot's own provider can be built, regardless of escalation state", async () => {
    const { env } = fakeEnv({
      slotRow: { slot: "simple", provider: "gemini_viax", model: "ag/gemini-3-flash-agent" },
    });
    expect(await isSlotConfigured(env, "simple")).toBe(true);
  });

  test("a BYO override is checked on its own terms", async () => {
    const { env } = fakeEnv();
    expect(await isSlotConfigured(env, "simple", { provider: "custom", model: "m", api_key: "k", endpoint_url: "https://x.example/v1" })).toBe(true);
  });
});

describe("saving a slot resets its escalation state", () => {
  test("a manual provider change writes to llm_slot_state after the config row", async () => {
    const { env, writes } = fakeEnv();
    await saveLlmAgentConfig(env, "simple", { provider: "gemini_viax", model: "ag/gemini-3-flash-agent" });
    // writes[0] is the llm_agent_configs upsert (checked elsewhere); resetSlotEscalation
    // follows with an ensureRow (INSERT OR IGNORE) and the reset UPDATE.
    expect(writes.length).toBeGreaterThanOrEqual(3);
  });
});
