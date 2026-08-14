import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { LLM_SLOT_DEFAULTS } from "./services/llmCatalog";

function workerConfig() {
  return readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
}

describe("Worker LLM configuration", () => {
  test("model choice lives in the provider catalog, not in wrangler vars", () => {
    // The old LLM_PROVIDER/LLM_*_MODEL vars are gone: which model each slot uses is
    // the catalog's job now, and leaving them behind would give two answers.
    const config = workerConfig();
    expect(config).not.toContain("LLM_PROVIDER");
    expect(config).not.toContain("LLM_CLASSIFY_MODEL");
    expect(config).not.toContain("LLM_INSIGHT_MODEL");
    expect(config).not.toContain("LLM_TRANSLATE_MODEL");
    expect(config).not.toContain("LLM_BASE_URL");
  });

  test("keeps the Viax proxy endpoint, which the catalog's Gemini by Viax entry needs", () => {
    expect(workerConfig()).toContain('"LLM_VIAX_BASE_URL"');
  });

  test("the documented slot defaults are the ones the code ships", () => {
    expect(LLM_SLOT_DEFAULTS.reasoning).toEqual({ provider: "openai_viax", model: "gpt-5.6-terra" });
    expect(LLM_SLOT_DEFAULTS.simple).toEqual({ provider: "gemini_viax", model: "ag/gemini-3.6-flash-high" });
  });
});
