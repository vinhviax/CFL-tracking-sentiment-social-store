import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listLlmAgentConfigs: vi.fn(),
  upsertLlmAgentConfig: vi.fn(),
  buildDefaultLlmAgentConfig: vi.fn(),
}));

vi.mock("../services/llmAgentConfig", () => ({
  listLlmAgentConfigs: mocks.listLlmAgentConfigs,
  upsertLlmAgentConfig: mocks.upsertLlmAgentConfig,
  buildDefaultLlmAgentConfig: mocks.buildDefaultLlmAgentConfig,
  isLlmAgentSlot: (value: string) => value === "reasoning" || value === "simple",
}));

import { llmConfigRoute } from "./llmConfig";

describe("llmConfigRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildDefaultLlmAgentConfig.mockReturnValue({
      reasoning: { slot: "reasoning", provider: "llm_viax", model: "advanced-worker" },
      simple: { slot: "simple", provider: "llm_viax", model: "cheap-worker" },
    });
    mocks.listLlmAgentConfigs.mockResolvedValue([
      {
        slot: "reasoning",
        enabled: true,
        provider: "openai",
        endpoint_url: null,
        model: "gpt-5.1",
        has_api_key: true,
        api_key_masked: "sk-r...xxxx",
      },
    ]);
    mocks.upsertLlmAgentConfig.mockResolvedValue({
      slot: "simple",
      enabled: true,
      provider: "custom",
      endpoint_url: "https://gateway.example/v1",
      model: "fast-model",
      has_api_key: true,
      api_key_masked: "key-...zzzz",
    });
  });

  test("lists defaults and saved masked configs", async () => {
    const env = { DB: {} } as any;

    const res = await llmConfigRoute.request("/", {}, env);

    await expect(res.json()).resolves.toEqual({
      defaults: {
        reasoning: { slot: "reasoning", provider: "llm_viax", model: "advanced-worker" },
        simple: { slot: "simple", provider: "llm_viax", model: "cheap-worker" },
      },
      configs: [
        expect.objectContaining({
          slot: "reasoning",
          provider: "openai",
          has_api_key: true,
          api_key_masked: "sk-r...xxxx",
        }),
      ],
    });
  });

  test("saves a simple slot config without echoing the raw API key", async () => {
    const env = { DB: {} } as any;

    const res = await llmConfigRoute.request("/simple", {
      method: "PUT",
      body: JSON.stringify({
        enabled: true,
        provider: "custom",
        endpoint_url: "https://gateway.example/v1",
        model: "fast-model",
        api_key: "key-secret-zzzz",
      }),
    }, env);

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      slot: "simple",
      provider: "custom",
      has_api_key: true,
      api_key_masked: "key-...zzzz",
    }));
    expect(mocks.upsertLlmAgentConfig).toHaveBeenCalledWith(env, "simple", expect.objectContaining({
      provider: "custom",
      api_key: "key-secret-zzzz",
    }));
  });

  test("rejects unknown slots", async () => {
    const res = await llmConfigRoute.request("/other", { method: "PUT", body: "{}" }, { DB: {} } as any);
    expect(res.status).toBe(400);
  });
});
