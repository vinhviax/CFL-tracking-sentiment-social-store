import { describe, expect, test } from "vitest";
import {
  TRANSLATION_SYSTEM_PROMPT,
  buildTranslationLimit,
  buildTranslationUserPrompt,
  getTranslationBatchSize,
  parseTranslationResults,
} from "./translation";

describe("translation prompt", () => {
  test("preserves liveops meaning and version/game terms for Chinese operators", () => {
    expect(TRANSLATION_SYSTEM_PROMPT).toContain("liveops");
    expect(TRANSLATION_SYSTEM_PROMPT).toContain("Simplified Chinese");
    expect(TRANSLATION_SYSTEM_PROMPT).toContain("CFL");
    expect(TRANSLATION_SYSTEM_PROMPT).toContain("CFM");
    expect(TRANSLATION_SYSTEM_PROMPT).toContain("SEA");
    expect(TRANSLATION_SYSTEM_PROMPT).toContain("technical meaning");
  });

  test("asks the model to return only the translation JSON contract", () => {
    const prompt = buildTranslationUserPrompt([{ id: 1, message: "CFM SEA mượt hơn bản Việt", summary: "Người chơi so sánh bản SEA." }]);

    expect(prompt).toContain("Return only JSON");
    expect(prompt).toContain("message_zh");
    expect(prompt).toContain("summary_zh");
    expect(prompt).toContain("CFM SEA");
  });
});

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

  test("returns empty results instead of throwing on malformed LLM JSON", () => {
    const raw = '{"results":[{"id":4076,"message_zh":"你好","summary_zh":"摘要"';

    expect(parseTranslationResults(raw)).toEqual([]);
  });

  test("salvages complete translation records from malformed JSON arrays", () => {
    const raw = '{"results":[{"id":1,"message_zh":"一","summary_zh":"甲"}{"id":2,"message_zh":"二","summary_zh":"乙"}]}';

    expect(parseTranslationResults(raw)).toEqual([
      { id: 1, message_zh: "一", summary_zh: "甲" },
      { id: 2, message_zh: "二", summary_zh: "乙" },
    ]);
  });

  /**
   * Fetching more rows than an attempt can process is what made the cost quadratic:
   * a run of N comments translating 100 per attempt read N rows every attempt, so
   * finishing it cost ~N²/100 row reads. That is what exhausted D1's daily read limit
   * on 2026-09-04, hours after the previous fix.
   */
  test("caps a run-specific fetch to what one attempt can actually process", () => {
    expect(buildTranslationLimit({ runId: 42, maxBatches: 5, batchSize: 20 })).toBe(100);
    // An explicit caller limit still wins — that is the "translate up to N" button.
    expect(buildTranslationLimit({ runId: 42, limit: 300, maxBatches: 5, batchSize: 20 })).toBe(300);
    // A forced re-run passes no maxBatches: it deliberately sweeps the whole run.
    expect(buildTranslationLimit({ runId: 42 })).toBeNull();
    expect(buildTranslationLimit({})).toBe(1000);
  });

  test("reads translation batch size from bounded configuration", () => {
    expect(getTranslationBatchSize({ TRANSLATION_BATCH_SIZE: "40" } as any)).toBe(40);
    expect(getTranslationBatchSize({ TRANSLATION_BATCH_SIZE: "500" } as any)).toBe(100);
  });
});
