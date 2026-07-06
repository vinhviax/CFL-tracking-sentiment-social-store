import { describe, expect, test } from "vitest";
import { buildTranslationLimit, getTranslationBatchSize, getTranslationModel, parseTranslationResults } from "./translation";

describe("parseTranslationResults", () => {
  test("accepts direct data-line translation records", () => {
    const raw = [
      'data: {"id":4076,"message_zh":"我刚问了，他们说由 TikTok 决定。","summary_zh":"玩家质疑第三方平台的决定权。"}',
      "data: [DONE]",
    ].join("\n");

    expect(parseTranslationResults(raw)).toEqual([
      {
        id: 4076,
        message_zh: "我刚问了，他们说由 TikTok 决定。",
        summary_zh: "玩家质疑第三方平台的决定权。",
      },
    ]);
  });

  test("uses a dedicated translation model when configured", () => {
    expect(getTranslationModel({ LLM_TRANSLATE_MODEL: "ag/gemini-3-flash-agent", LLM_INSIGHT_MODEL: "codex-lb/gpt-5.4" } as any))
      .toBe("ag/gemini-3-flash-agent");
    expect(getTranslationModel({ LLM_INSIGHT_MODEL: "codex-lb/gpt-5.4" } as any)).toBe("codex-lb/gpt-5.4");
  });

  test("does not cap run-specific translation when no explicit limit is provided", () => {
    expect(buildTranslationLimit({ runId: 42 })).toBeNull();
    expect(buildTranslationLimit({ runId: 42, limit: 300 })).toBe(300);
    expect(buildTranslationLimit({})).toBe(1000);
  });

  test("reads translation batch size from bounded configuration", () => {
    expect(getTranslationBatchSize({ TRANSLATION_BATCH_SIZE: "40" } as any)).toBe(40);
    expect(getTranslationBatchSize({ TRANSLATION_BATCH_SIZE: "500" } as any)).toBe(100);
  });
});
