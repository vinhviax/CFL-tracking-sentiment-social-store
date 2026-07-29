import { describe, expect, test, vi } from "vitest";
import { GeminiProvider, OpenAIProvider, parseOpenAIChatContent, parseOpenAIChatResult } from "./providers";
import { addUsage } from "./base";

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

describe("parseOpenAIChatResult usage", () => {
  test("reads usage from a plain JSON chat response", () => {
    const raw = JSON.stringify({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1200, completion_tokens: 340 },
    });

    expect(parseOpenAIChatResult(raw).usage).toEqual({ input_tokens: 1200, output_tokens: 340 });
  });

  test("reads usage from the trailing chunk of a streamed response", () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}',
      "data: [DONE]",
    ].join("\n");

    const result = parseOpenAIChatResult(raw);
    expect(result.content).toBe("hi");
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
  });

  test("leaves usage undefined when the response omits it, rather than reporting zero", () => {
    const streamed = 'data: {"choices":[{"delta":{"content":"hi"}}]}\ndata: [DONE]';
    expect(parseOpenAIChatResult(streamed).usage).toBeUndefined();
    expect(parseOpenAIChatResult(JSON.stringify({ choices: [{ message: { content: "x" } }] })).usage).toBeUndefined();
  });

  test("ignores a partial usage object missing one of the two counts", () => {
    const raw = JSON.stringify({ choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 5 } });
    expect(parseOpenAIChatResult(raw).usage).toBeUndefined();
  });
});

describe("addUsage", () => {
  test("sums both sides", () => {
    expect(addUsage({ input_tokens: 3, output_tokens: 4 }, { input_tokens: 10, output_tokens: 1 }))
      .toEqual({ input_tokens: 13, output_tokens: 5 });
  });

  test("treats a missing side as nothing to add, and two missing sides as unknown", () => {
    const one = { input_tokens: 3, output_tokens: 4 };
    expect(addUsage(undefined, one)).toEqual(one);
    expect(addUsage(one, undefined)).toEqual(one);
    expect(addUsage(undefined, undefined)).toBeUndefined();
  });
});

describe("OpenAIProvider", () => {
  test("does not send stream_options, which is only legal alongside stream:true", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 7, completion_tokens: 8 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIProvider("gpt-x", "key", "https://example.test/v1", "llm_viax");
    await expect(provider.completeJson("system", "user")).resolves.toEqual({
      content: "{}",
      usage: { input_tokens: 7, output_tokens: 8 },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.stream_options).toBeUndefined();
    expect(body.stream).toBeUndefined();
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
      usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 9 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("gemini-2.5-flash", "gemini-key", "https://generativelanguage.googleapis.com/v1beta");
    await expect(provider.completeJson("system", "user")).resolves.toEqual({
      content: "{\"results\":[]}",
      usage: { input_tokens: 42, output_tokens: 9 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-key",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
      })
    );
  });
});
