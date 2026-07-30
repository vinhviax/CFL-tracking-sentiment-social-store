import { describe, expect, test } from "vitest";
import { CLASSIFIER_SYSTEM_PROMPT, ClassifierService, buildClassifierUserPrompt } from "./classifier";

describe("classifier prompt", () => {
  test("guides liveops reasoning instead of keyword-only classification", () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain("liveops");
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain("Không phân loại chỉ vì thấy keyword");
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain("CFM/China/SEA");
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain("So Sánh Game");
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain("other_suggested");
  });

  test("places parent post context before the player comment", () => {
    const prompt = buildClassifierUserPrompt([
      {
        id: 7,
        message: "sao chưa vào được",
        context: "Nguồn post: fb_page\nNội dung post: Thông báo bảo trì máy chủ.",
        rating: null,
      },
    ]);

    expect(prompt).toContain("Bối cảnh bài viết/post chứa bình luận:");
    expect(prompt).toContain("Thông báo bảo trì máy chủ.");
    expect(prompt.indexOf("Bối cảnh bài viết/post chứa bình luận")).toBeLessThan(
      prompt.indexOf("sao chưa vào được")
    );
  });

  test("includes recent human correction examples before classifying new comments", () => {
    const prompt = buildClassifierUserPrompt([
      {
        id: 9,
        message: "qe thế quen =))",
        rating: null,
      },
    ], [
      {
        comment: "VNG nay chiều qe thế quen =))",
        topic_main: "positive_feedback",
        note: "Human hiểu đây là lời khen/đùa thân thiện, không phải lỗi game.",
      },
    ]);

    expect(prompt).toContain("Ví dụ human đã sửa để LLM học theo:");
    expect(prompt).toContain("topic_main=positive_feedback");
    expect(prompt).toContain("Human hiểu đây là lời khen/đùa thân thiện");
    expect(prompt.indexOf("Ví dụ human đã sửa")).toBeLessThan(prompt.indexOf("Phân loại các bình luận sau"));
  });
});

/** D1 stub that swallows the slot-state writes ClassifierService makes via completeJsonForSlot. */
function fakeEnv() {
  return {
    CLASSIFY_BATCH_SIZE: "20",
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() { return { tier: "primary", consecutive_failures: 0, last_failure_at: null, exhausted_date: null }; },
              async run() { return {}; },
            };
          },
        };
      },
    },
  } as any;
}

function provider(overrides: Partial<{ name: string; model: string; json: string; fail: Error }> = {}) {
  return {
    name: overrides.name ?? "openai_viax",
    model: overrides.model ?? "gpt-5.6-terra",
    async completeJson() {
      if (overrides.fail) throw overrides.fail;
      return { content: overrides.json ?? '{"results":[]}' };
    },
    async completeText() { return { content: "" }; },
  } as any;
}

const ITEMS = [
  { id: 1, message: "lag kinh khủng", rating: null },
  { id: 2, message: "game hay lắm", rating: null },
];

describe("ClassifierService.classify — no keyword fallback", () => {
  test("a comment the LLM did not classify is omitted, not keyword-guessed", async () => {
    // The keyword fallback used to fill these in and they were written to `analyses`
    // as real rows, which is what hid a 12-day LLM outage. They must now be left out
    // so the next attempt picks them up.
    const oneOfTwo = JSON.stringify({
      results: [
        { id: 1, topic_main: "lag_fps", topics_sub: [], sentiment: "negative", urgency: "medium", summary: "Người chơi báo lag.", other_suggested: null, confidence: 0.9 },
      ],
    });
    const svc = new ClassifierService(fakeEnv(), [provider({ json: oneOfTwo })]);
    const result = await svc.classify(ITEMS);

    expect(result.classifications.map((c) => c.id)).toEqual([1]);
    expect(result.llmClassified).toBe(1);
    expect(result.unclassifiedCount).toBe(1);
  });

  test("a failed LLM call yields no classifications at all", async () => {
    const svc = new ClassifierService(fakeEnv(), [provider({ fail: new Error("HTTP 403 (reset after 30s)") })]);
    const result = await svc.classify(ITEMS);

    expect(result.classifications).toEqual([]);
    expect(result.unclassifiedCount).toBe(2);
    expect(result.error).toContain("403");
  });

  test("an empty chain (slot backing off or given up) attempts nothing", async () => {
    const svc = new ClassifierService(fakeEnv(), []);
    const result = await svc.classify(ITEMS);

    expect(result.classifications).toEqual([]);
    expect(result.unclassifiedCount).toBe(2);
    expect(result.error).toBeNull();
    expect(svc.providerName).toBe("unavailable");
  });

  test("reports the provider that actually answered", async () => {
    const json = JSON.stringify({
      results: ITEMS.map((it) => ({
        id: it.id, topic_main: "other", topics_sub: [], sentiment: "neutral",
        urgency: "none", summary: "x", other_suggested: null, confidence: 0.5,
      })),
    });
    const svc = new ClassifierService(fakeEnv(), [provider({ name: "gemini_viax", model: "ag/gemini-3-flash-agent", json })]);
    const result = await svc.classify(ITEMS);

    expect(result.unclassifiedCount).toBe(0);
    expect(result.servedBy).toEqual({ provider: "gemini_viax", model: "ag/gemini-3-flash-agent" });
  });
});
