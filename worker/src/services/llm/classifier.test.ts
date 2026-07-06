import { describe, expect, test } from "vitest";
import { buildClassifierUserPrompt } from "./classifier";

describe("classifier prompt", () => {
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
