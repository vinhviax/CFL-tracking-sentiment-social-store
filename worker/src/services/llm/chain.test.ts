import { describe, expect, test } from "vitest";
import type { LLMProvider } from "./base";
import { AllProvidersFailedError, completeJsonWithFallback, completeTextWithFallback } from "./chain";

function provider(name: string, model: string, behaviour: "ok" | "throw", content = "{}"): LLMProvider {
  const call = async () => {
    if (behaviour === "throw") throw new Error(`${name} exploded`);
    return { content, usage: { input_tokens: 10, output_tokens: 2 } };
  };
  return { name, model, completeJson: call, completeText: call };
}

describe("provider chain", () => {
  test("uses the first provider and records no failures when it answers", async () => {
    const outcome = await completeJsonWithFallback(
      [provider("openai_viax", "gpt-5.6-terra", "ok", '{"a":1}'), provider("gemini_viax", "g", "ok")],
      "s",
      "u"
    );
    expect(outcome.content).toBe('{"a":1}');
    expect(outcome.provider.name).toBe("openai_viax");
    expect(outcome.failures).toEqual([]);
  });

  test("retries through the next provider when the first errors", async () => {
    // This is the case that silently degraded 31,322 comments: the first provider
    // returned 403 on every batch and nothing picked up the slack.
    const outcome = await completeJsonWithFallback(
      [provider("openai_viax", "gpt-5.6-terra", "throw"), provider("gemini_viax", "ag/gemini-3-flash-agent", "ok", '{"b":2}')],
      "s",
      "u"
    );
    expect(outcome.content).toBe('{"b":2}');
    expect(outcome.provider.name).toBe("gemini_viax");
    expect(outcome.failures).toEqual([
      { provider: "openai_viax", model: "gpt-5.6-terra", error: "openai_viax exploded" },
    ]);
  });

  test("carries the usage of whichever provider answered", async () => {
    const outcome = await completeJsonWithFallback(
      [provider("openai_viax", "m", "throw"), provider("gemini_viax", "g", "ok")],
      "s",
      "u"
    );
    expect(outcome.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
  });

  test("throws with every failure attached once the whole chain is exhausted", async () => {
    const promise = completeJsonWithFallback(
      [provider("openai_viax", "m1", "throw"), provider("gemini_viax", "m2", "throw")],
      "s",
      "u"
    );
    await expect(promise).rejects.toBeInstanceOf(AllProvidersFailedError);
    await promise.catch((e: AllProvidersFailedError) => {
      expect(e.failures.map((f) => f.provider)).toEqual(["openai_viax", "gemini_viax"]);
      // The message names both, so a log line is enough to diagnose.
      expect(e.message).toContain("m1");
      expect(e.message).toContain("m2");
    });
  });

  test("an empty chain fails immediately rather than pretending to succeed", async () => {
    await expect(completeJsonWithFallback([], "s", "u")).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  test("does not call later providers once one has answered", async () => {
    let secondCalled = false;
    const second: LLMProvider = {
      name: "gemini_viax",
      model: "g",
      completeJson: async () => {
        secondCalled = true;
        return { content: "{}" };
      },
      completeText: async () => ({ content: "" }),
    };
    await completeJsonWithFallback([provider("openai_viax", "m", "ok"), second], "s", "u");
    expect(secondCalled).toBe(false);
  });

  test("the text variant behaves the same", async () => {
    const outcome = await completeTextWithFallback(
      [provider("openai_viax", "m", "throw"), provider("gemini_viax", "g", "ok", "hello")],
      "s",
      "u"
    );
    expect(outcome.content).toBe("hello");
    expect(outcome.provider.name).toBe("gemini_viax");
  });
});
