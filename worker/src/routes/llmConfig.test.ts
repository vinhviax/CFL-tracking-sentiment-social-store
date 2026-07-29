import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listLlmAgentConfigs: vi.fn(),
  saveLlmAgentConfig: vi.fn(),
  llmConfigPayloadDefaults: vi.fn(),
  llmCatalogPayload: vi.fn(),
}));

vi.mock("../services/llmAgentConfig", () => ({
  listLlmAgentConfigs: mocks.listLlmAgentConfigs,
  saveLlmAgentConfig: mocks.saveLlmAgentConfig,
  llmConfigPayloadDefaults: mocks.llmConfigPayloadDefaults,
  llmCatalogPayload: mocks.llmCatalogPayload,
  isLlmAgentSlot: (value: string) => value === "reasoning" || value === "simple",
}));

import { llmConfigRoute } from "./llmConfig";

describe("llmConfigRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.llmCatalogPayload.mockReturnValue([
      { id: "openai_viax", label: "OpenAI by Viax", byo: false, needs_endpoint: false, needs_api_key: false, models: ["gpt-5.6-terra"], model_options: [] },
      { id: "custom", label: "Custom", byo: true, needs_endpoint: true, needs_api_key: true, models: [], model_options: [] },
    ]);
    mocks.llmConfigPayloadDefaults.mockReturnValue({
      reasoning: { slot: "reasoning", provider: "openai_viax", provider_label: "OpenAI by Viax", model: "gpt-5.6-terra", model_label: "gpt-5.6-terra" },
      simple: { slot: "simple", provider: "gemini_viax", provider_label: "Gemini by Viax", model: "ag/gemini-3-flash-agent", model_label: "gemini-3-flash-agent" },
    });
    mocks.listLlmAgentConfigs.mockResolvedValue([
      { slot: "reasoning", provider: "openai_viax", provider_label: "OpenAI by Viax", model: "gpt-5.6-terra", model_label: "gpt-5.6-terra", is_default: true },
    ]);
    mocks.saveLlmAgentConfig.mockResolvedValue({
      slot: "simple", provider: "openai_viax", provider_label: "OpenAI by Viax", model: "gpt-5.6-luna", model_label: "gpt-5.6-luna", is_default: false,
    });
  });

  test("returns the catalog, the defaults and the current selection", async () => {
    const env = { DB: {} } as any;

    const res = await llmConfigRoute.request("/", {}, env);
    const body = await res.json() as any;

    expect(body.providers.map((p: any) => p.id)).toEqual(["openai_viax", "custom"]);
    expect(body.defaults.reasoning).toMatchObject({ provider: "openai_viax", model_label: "gpt-5.6-terra" });
    expect(body.configs[0]).toMatchObject({ slot: "reasoning", provider_label: "OpenAI by Viax", model_label: "gpt-5.6-terra" });
  });

  test("never exposes an endpoint or an API key", async () => {
    const res = await llmConfigRoute.request("/", {}, { DB: {} } as any);
    const raw = JSON.stringify(await res.json());

    // Match the JSON key itself, so the needs_api_key/needs_endpoint capability
    // flags — which are fine to expose — do not trip this.
    expect(raw).not.toContain('"api_key":');
    expect(raw).not.toContain('"endpoint_url":');
    expect(raw).not.toContain('"endpoint":');
    expect(raw).not.toContain("https://");
  });

  test("saves only provider and model, ignoring any credential fields sent along", async () => {
    const env = { DB: {} } as any;

    const res = await llmConfigRoute.request("/simple", {
      method: "PUT",
      body: JSON.stringify({
        provider: "openai_viax",
        model: "gpt-5.6-luna",
        // A client should not be sending these; the route must not forward them.
        api_key: "key-secret-zzzz",
        endpoint_url: "https://gateway.example/v1",
        enabled: true,
      }),
    }, env);

    expect(res.status).toBe(200);
    expect(mocks.saveLlmAgentConfig).toHaveBeenCalledWith(env, "simple", {
      provider: "openai_viax",
      model: "gpt-5.6-luna",
    });
  });

  test("surfaces the reason a selection was refused", async () => {
    mocks.saveLlmAgentConfig.mockRejectedValue(new Error("Custom dùng API key riêng của bạn nên không lưu được"));

    const res = await llmConfigRoute.request("/reasoning", {
      method: "PUT",
      body: JSON.stringify({ provider: "custom", model: "whatever" }),
    }, { DB: {} } as any);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ detail: expect.stringContaining("không lưu được") });
  });

  test("rejects unknown slots", async () => {
    const res = await llmConfigRoute.request("/other", { method: "PUT", body: "{}" }, { DB: {} } as any);
    expect(res.status).toBe(400);
  });
});
