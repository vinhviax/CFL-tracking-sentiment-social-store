import { describe, expect, test, vi } from "vitest";
import { drainProcessingQueue, listProcessingJobs, type ProcessingQueueJob } from "./processingQueue";

describe("processing queue", () => {
  test("drains queued jobs one at a time in FIFO order", async () => {
    const calls: string[] = [];
    const jobs: ProcessingQueueJob[] = [
      { id: 1, job_type: "analysis", run_id: 15, progress_key: "ingest-store-analyze-15" },
      { id: 2, job_type: "translation", run_id: 15, progress_key: "ingest-store-translate-15", locale: "zh-CN" },
    ];
    const store = {
      claimNext: vi.fn(async () => jobs.shift() || null),
      markDone: vi.fn(async (_env, id) => {
        calls.push(`done:${id}`);
      }),
      markFailed: vi.fn(),
      enqueueJobs: vi.fn(),
    };
    const deps = {
      runAnalysis: vi.fn(async () => {
        calls.push("analysis");
        return { analyzed: 2, total: 2, provider: "test" };
      }),
      discoverAndStoreRunMemory: vi.fn(async () => {
        calls.push("memory");
        return { run_id: 15, comments: 2, subtopics: 0, evidence: 0, provider: "test", model: "test" };
      }),
      runTranslation: vi.fn(async () => {
        calls.push("translation");
        return { translated: 2, total: 2, provider: "test" };
      }),
    };
    const env = {} as any;

    await drainProcessingQueue(env, deps, store);

    expect(calls).toEqual(["analysis", "memory", "done:1", "translation", "done:2"]);
    expect(deps.runAnalysis).toHaveBeenCalledWith(env, {
      runId: 15,
      commentIds: undefined,
      progressKey: "ingest-store-analyze-15",
    });
    expect(deps.runTranslation).toHaveBeenCalledWith(env, {
      runId: 15,
      commentIds: undefined,
      progressKey: "ingest-store-translate-15",
      locale: "zh-CN",
      force: undefined,
      limit: undefined,
    });
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  test("lists active queue jobs with progress and run metadata", async () => {
    const calls: { sql: string; args: any[] }[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: any[]) {
              calls.push({ sql, args });
              return this;
            },
            async all() {
              return {
                results: [
                  {
                    id: 5,
                    job_type: "translation",
                    run_id: 42,
                    progress_key: "ingest-store-translate-42",
                    status: "queued",
                    locale: "zh-CN",
                    force: 0,
                    limit_count: 300,
                    error: null,
                    created_at: "2026-07-06T18:00:00Z",
                    updated_at: "2026-07-06T18:01:00Z",
                    started_at: null,
                    finished_at: null,
                    progress_status: "queued",
                    done: 0,
                    total: 0,
                    provider: null,
                    progress_error: null,
                    source_type: "store",
                    run_status: "done",
                    rows_new: 8,
                    rows_fetched: 20,
                    data_start_date: "2026-07-01",
                    data_end_date: "2026-07-06",
                  },
                ],
              };
            },
          };
        },
      },
    } as any;

    await expect(listProcessingJobs(env, { limit: 10 })).resolves.toEqual([
      expect.objectContaining({
        id: 5,
        job_type: "translation",
        run_id: 42,
        progress_key: "ingest-store-translate-42",
        status: "queued",
        progress: { status: "queued", done: 0, total: 0, provider: null, error: null },
        run: expect.objectContaining({ id: 42, source_type: "store" }),
      }),
    ]);
    expect(calls[0].sql).toContain("FROM processing_queue q");
    expect(calls[0].sql).toContain("LEFT JOIN analyze_jobs p");
    expect(calls[0].args).toEqual([10]);
  });
});
