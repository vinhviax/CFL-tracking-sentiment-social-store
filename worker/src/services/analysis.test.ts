import { describe, expect, test } from "vitest";
import { buildPostContext, getAnalysisBatchSize, getLlmBatchConcurrency, loadHumanCorrectionExamples } from "./analysis";

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

  test("reads analysis batch and LLM concurrency from bounded config", () => {
    expect(getAnalysisBatchSize({ ANALYSIS_BATCH_SIZE: "50", CLASSIFY_BATCH_SIZE: "30" } as any)).toBe(50);
    expect(getAnalysisBatchSize({ CLASSIFY_BATCH_SIZE: "500" } as any)).toBe(100);
    expect(getLlmBatchConcurrency({ LLM_BATCH_CONCURRENCY: "3" } as any)).toBe(3);
    expect(getLlmBatchConcurrency({ LLM_BATCH_CONCURRENCY: "30" } as any)).toBe(5);
  });

  test("loads recent human correction notes as classifier examples", async () => {
    const env = {
      DB: {
        prepare(sql: string) {
          expect(sql).toContain("analysis_corrections");
          return {
            bind(limit: number) {
              expect(limit).toBe(12);
              return this;
            },
            async all() {
              return {
                results: [
                  {
                    comment: "VNG nay chiều qe thế quen =))",
                    topic_main: "positive_feedback",
                    note: "Human hiểu đây là lời khen/đùa thân thiện.",
                  },
                ],
              };
            },
          };
        },
      },
    } as any;

    await expect(loadHumanCorrectionExamples(env)).resolves.toEqual([
      {
        comment: "VNG nay chiều qe thế quen =))",
        topic_main: "positive_feedback",
        note: "Human hiểu đây là lời khen/đùa thân thiện.",
      },
    ]);
  });
});
