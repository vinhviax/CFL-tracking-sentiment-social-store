import { describe, expect, test } from "vitest";
import {
  buildDefaultLlmAgentConfig,
  maskApiKey,
  sanitizeLlmAgentConfig,
  resolveLlmProvider,
} from "./llmAgentConfig";

function dbWithRows(rows: any[]) {
  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return this;
        },
        async first() {
          return rows[0] || null;
        },
        async all() {
          return { results: rows };
        },
        async run() {
          return {};
        },
      };
    },
  };
}

describe("llm agent config", () => {
  test("masks API keys before returning config to the UI", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-1...cdef");
    expect(sanitizeLlmAgentConfig({
      slot: "reasoning",
      enabled: 1,
      provider: "openai",
      endpoint_url: null,
      model: "gpt-5.1",
      api_key: "sk-secret-value",
      updated_at: "2026-07-07T00:00:00Z",
    })).toMatchObject({
      slot: "reasoning",
      provider: "openai",
      model: "gpt-5.1",
      has_api_key: true,
      api_key_masked: "sk-s...alue",
    });
  });

  test("builds default slots from Worker env", () => {
    const defaults = buildDefaultLlmAgentConfig({
      LLM_PROVIDER: "llm_viax",
      LLM_CLASSIFY_MODEL: "advanced-model",
      LLM_TRANSLATE_MODEL: "cheap-model",
      LLM_INSIGHT_MODEL: "insight-model",
    } as any);

    expect(defaults.reasoning).toMatchObject({ provider: "llm_viax", model: "advanced-model" });
    expect(defaults.simple).toMatchObject({ provider: "llm_viax", model: "cheap-model" });
  });

  test("resolves enabled custom config before Worker defaults", async () => {
    const env = {
      DB: dbWithRows([
        {
          slot: "simple",
          enabled: 1,
          provider: "custom",
          endpoint_url: "https://gateway.example/v1",
          api_key: "custom-key",
          model: "fast-model",
          updated_at: "2026-07-07T00:00:00Z",
        },
      ]),
      LLM_PROVIDER: "llm_viax",
      LLM_TRANSLATE_MODEL: "worker-fast",
      LLM_INSIGHT_MODEL: "worker-insight",
      LLM_VIAX_BASE_URL: "https://worker.example/v1",
      LLM_VIAX_API_KEY: "worker-key",
    } as any;

    const provider = await resolveLlmProvider(env, "simple");

    expect(provider?.name).toBe("custom");
    expect(provider?.model).toBe("fast-model");
  });

  test("falls back to Worker defaults when the slot is disabled", async () => {
    const env = {
      DB: dbWithRows([{ slot: "reasoning", enabled: 0, provider: "openai", model: "gpt-5.1", api_key: "sk", endpoint_url: null }]),
      LLM_PROVIDER: "llm_viax",
      LLM_CLASSIFY_MODEL: "worker-reasoning",
      LLM_VIAX_BASE_URL: "https://worker.example/v1",
      LLM_VIAX_API_KEY: "worker-key",
    } as any;

    const provider = await resolveLlmProvider(env, "reasoning");

    expect(provider?.name).toBe("llm_viax");
    expect(provider?.model).toBe("worker-reasoning");
  });
});
