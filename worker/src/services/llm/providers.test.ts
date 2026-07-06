import { describe, expect, test } from "vitest";
import { parseOpenAIChatContent } from "./providers";

describe("parseOpenAIChatContent", () => {
  test("extracts message content from an SSE-style chat response", () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"{\\"results\\":["}}]}',
      'data: {"choices":[{"delta":{"content":"{\\"id\\":1,\\"message_zh\\":\\"你好\\",\\"summary_zh\\":\\"\\"}]"}}]}',
      'data: {"choices":[{"delta":{"content":"}"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");

    expect(parseOpenAIChatContent(raw)).toBe('{"results":[{"id":1,"message_zh":"你好","summary_zh":""}]}');
  });
});
