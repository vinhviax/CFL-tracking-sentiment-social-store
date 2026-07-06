import { describe, expect, test, vi } from "vitest";
import { GeminiProvider, parseOpenAIChatContent } from "./providers";

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

describe("GeminiProvider", () => {
  test("calls generateContent and extracts text response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: "{\"results\":[]}" }],
          },
        },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("gemini-2.5-flash", "gemini-key", "https://generativelanguage.googleapis.com/v1beta");
    await expect(provider.completeJson("system", "user")).resolves.toBe("{\"results\":[]}");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-key",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
      })
    );
  });
});
