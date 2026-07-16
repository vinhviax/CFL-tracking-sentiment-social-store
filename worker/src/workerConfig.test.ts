import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function workerConfig() {
  return readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
}

describe("Worker LLM model defaults", () => {
  test("uses the approved GPT-5.6 Terra insight model without changing Gemini defaults", () => {
    expect(workerConfig()).toContain('"LLM_CLASSIFY_MODEL": "ag/gemini-3-flash-agent"');
    expect(workerConfig()).toContain('"LLM_INSIGHT_MODEL": "codex-lb/gpt-5.6-terra"');
    expect(workerConfig()).toContain('"LLM_TRANSLATE_MODEL": "ag/gemini-3-flash-agent"');
  });
});
