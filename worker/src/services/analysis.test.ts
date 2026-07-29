import { describe, expect, test } from "vitest";
import { buildPostContext, getAnalysisBatchSize, getLlmBatchConcurrency, loadHumanCorrectionExamples, runAnalysis } from "./analysis";
import { PROMPT_VERSION } from "../taxonomy";

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

describe("forced re-analysis", () => {
  /** Captures the SQL/params pendingComments builds, which is where force takes effect. */
  function captureEnv(rows: any[] = []) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const env = {
      CLASSIFY_BATCH_SIZE: "50",
      DB: {
        prepare(sql: string) {
          return {
            bind(...params: unknown[]) {
              calls.push({ sql, params });
              return {
                async all() { return { results: rows }; },
                async first() { return null; },
                async run() { return {}; },
              };
            },
            async all() { calls.push({ sql, params: [] }); return { results: rows }; },
            async first() { return null; },
          };
        },
        async batch() { return []; },
      },
    } as any;
    return { env, calls };
  }

  test("without force, only comments missing an analysis at this prompt version", async () => {
    const { env, calls } = captureEnv();
    await runAnalysis(env, { progressKey: "run-53", runId: 53 });
    const select = calls.find((c) => c.sql.includes("FROM comments c"))!;
    expect(select.sql).toContain("a.prompt_version != ?");
    expect(select.params).toEqual([PROMPT_VERSION, 53]);
  });

  test("with force, the prompt-version filter is dropped so already-analysed comments qualify", async () => {
    // This is the bug the button had: a keyword-fallback analysis is recorded at the
    // current prompt version, so without force it looked done and nothing ran.
    const { env, calls } = captureEnv();
    await runAnalysis(env, { progressKey: "run-53", runId: 53, force: true, forceSince: "2026-07-29T12:00:00.000Z" });
    const select = calls.find((c) => c.sql.includes("FROM comments c"))!;
    expect(select.sql).not.toContain("a.prompt_version != ?");
    expect(select.sql).toContain("a.analyzed_at < ?");
    expect(select.params).toEqual(["2026-07-29T12:00:00.000Z", 53]);
  });

  test("a forced run without a cutoff still selects everything rather than failing", async () => {
    const { env, calls } = captureEnv();
    await runAnalysis(env, { progressKey: "run-53", runId: 53, force: true });
    const select = calls.find((c) => c.sql.includes("FROM comments c"))!;
    expect(select.sql).not.toContain("analyzed_at");
    expect(select.params).toEqual([53]);
  });
});
