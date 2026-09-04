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

/**
 * Reading more rows than an attempt can process is what made the cost quadratic.
 * runAnalysis processes at most `maxBatches * batchSize` comments per attempt, but it
 * used to SELECT every pending comment in the run first and throw the rest away — so a
 * 16,429-comment run cost ~16,429 row reads on each of its ~164 attempts, about 2.7
 * million reads to finish one run. That is what exhausted D1's free-tier daily read
 * limit on 2026-09-04, hours after the page-load fix.
 */
describe("runAnalysis only reads what one attempt can process", () => {
  function fakeEnv(pendingRows: any[], countRow?: { pending: number }) {
    const queries: { sql: string; args: unknown[] }[] = [];
    const env = {
      ANALYSIS_BATCH_SIZE: "20",
      LLM_BATCH_CONCURRENCY: "1",
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: unknown[]) {
              queries.push({ sql, args });
              return {
                async all() {
                  if (/analysis_corrections/.test(sql)) return { results: [] };
                  if (/FROM posts/.test(sql)) return { results: [] };
                  return { results: pendingRows };
                },
                async first() {
                  if (/COUNT\(\*\)/.test(sql)) return countRow ?? { pending: pendingRows.length };
                  return null;
                },
                async run() {
                  return {};
                },
              };
            },
          };
        },
        async batch() {
          return [];
        },
      },
    } as any;
    return { env, queries };
  }

  test("caps the pending SELECT at maxBatches * batchSize", async () => {
    const { env, queries } = fakeEnv([]);

    await runAnalysis(env, { runId: 133, progressKey: "run-133", maxBatches: 5 });

    const pendingQuery = queries.find((q) => /FROM comments c/.test(q.sql) && /LEFT JOIN analyses/.test(q.sql));
    expect(pendingQuery).toBeDefined();
    expect(pendingQuery!.sql).toContain("LIMIT");
    // 5 batches x 20 per batch — not the whole run.
    expect(pendingQuery!.args).toContain(100);
  });

  test("a forced sweep with no maxBatches stays unlimited", async () => {
    const { env, queries } = fakeEnv([]);

    await runAnalysis(env, { runId: 133, progressKey: "run-133" });

    const pendingQuery = queries.find((q) => /FROM comments c/.test(q.sql) && /LEFT JOIN analyses/.test(q.sql));
    expect(pendingQuery!.sql).not.toContain("LIMIT");
  });
});
