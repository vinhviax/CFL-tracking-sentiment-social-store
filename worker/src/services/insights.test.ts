import { describe, expect, test } from "vitest";
import { DEFAULT_INSIGHT_SYSTEM_PROMPT, buildInsightMessages } from "./insights";

describe("buildInsightMessages", () => {
  test("default prompt asks the LLM to return styled markdown for the web UI", () => {
    expect(DEFAULT_INSIGHT_SYSTEM_PROMPT).toContain("Markdown");
    expect(DEFAULT_INSIGHT_SYSTEM_PROMPT).toContain("##");
    expect(DEFAULT_INSIGHT_SYSTEM_PROMPT).toContain("**");
    expect(DEFAULT_INSIGHT_SYSTEM_PROMPT).toContain("icon");
  });

  test("uses the editable system prompt and includes sentiment-specific samples", () => {
    const [system, user] = buildInsightMessages(
      "Custom insight prompt",
      {
        total_comments: 12,
        analyzed: 10,
        negative_pct: 40,
        top_topics: [{ label: "Lag", count: 4 }],
        top_subtopics: [{ label: "Drop FPS khi combat", parent_label: "Hiệu năng/Lag/Crash", count: 3 }],
        hot_issues: [],
      },
      {
        negative: ["Lag sau update"],
        neutral: ["Hỏi lịch event"],
        positive: ["Game vui"],
      }
    );

    expect(system).toContain("Custom insight prompt");
    expect(system).toContain("Markdown");
    expect(user).toContain("Bình luận tiêu cực tiêu biểu");
    expect(user).toContain("Lag sau update");
    expect(user).toContain("Bình luận trung lập tiêu biểu");
    expect(user).toContain("Hỏi lịch event");
    expect(user).toContain("Bình luận tích cực tiêu biểu");
    expect(user).toContain("Game vui");
    expect(user).toContain("Top chủ đề con");
    expect(user).toContain("Drop FPS khi combat");
  });

  test("adds a Simplified Chinese instruction when the insight is generated for zh-CN reports", () => {
    const [system, user] = buildInsightMessages(
      "Custom insight prompt",
      {
        total_comments: 4,
        analyzed: 4,
        negative_pct: 25,
        top_topics: [],
        top_subtopics: [],
        hot_issues: [],
      },
      { negative: ["lag"], neutral: [], positive: ["hay"] },
      "zh-CN"
    );

    expect(system).toContain("Simplified Chinese");
    expect(user).toContain("Simplified Chinese");
  });
});
