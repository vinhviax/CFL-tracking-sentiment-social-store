import { describe, expect, test } from "vitest";
import { CLASSIFIER_SYSTEM_PROMPT, buildClassifierUserPrompt } from "./classifier";

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
});
