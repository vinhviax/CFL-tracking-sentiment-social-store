import { describe, expect, test } from "vitest";
import { buildPostContext } from "./analysis";

describe("analysis post context", () => {
  test("builds classifier context with source, date, permalink, and post content", () => {
    const context = buildPostContext({
      source_type: "fb_page",
      published_at: "2026-07-06T08:00:00Z",
      permalink: "https://facebook.com/post/123",
      message: "Thông báo bảo trì cập nhật chế độ mới.",
    });

    expect(context).toContain("Nguồn post: fb_page");
    expect(context).toContain("Ngày đăng post: 2026-07-06T08:00:00Z");
    expect(context).toContain("Link post: https://facebook.com/post/123");
    expect(context).toContain("Nội dung post: Thông báo bảo trì cập nhật chế độ mới.");
  });
});
