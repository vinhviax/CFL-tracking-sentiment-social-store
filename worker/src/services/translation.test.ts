import { describe, expect, test } from "vitest";
import { parseTranslationResults } from "./translation";

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
});
