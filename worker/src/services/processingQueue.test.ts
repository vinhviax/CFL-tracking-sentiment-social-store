import { describe, expect, test, vi } from "vitest";
import {
  cancelProcessingJob,
  drainProcessingQueue,
  listProcessingJobs,
  recoverStaleProcessingJobs,
  type ProcessingQueueJob,
} from "./processingQueue";

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
      requeue: vi.fn(),
      failAttempt: vi.fn(async () => ({ willRetry: false, attempts: 1 })),
      markFailed: vi.fn(),
      markCancelled: vi.fn(),
      isCancelled: vi.fn(async () => false),
      cancelJob: vi.fn(),
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

    await drainProcessingQueue(env, deps, store, { maxConcurrentJobs: 1 });

    expect(calls).toEqual(["analysis", "memory", "done:1", "translation", "done:2"]);
    expect(deps.runAnalysis).toHaveBeenCalledWith(env, expect.objectContaining({
      runId: 15,
      commentIds: undefined,
      progressKey: "ingest-store-analyze-15",
      jobId: 1,
      shouldContinue: expect.any(Function),
    }));
    expect(deps.runTranslation).toHaveBeenCalledWith(env, expect.objectContaining({
      runId: 15,
      commentIds: undefined,
      progressKey: "ingest-store-translate-15",
      jobId: 2,
      locale: "zh-CN",
      force: undefined,
      limit: undefined,
      shouldContinue: expect.any(Function),
    }));
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  test("drains independent jobs in parallel up to the configured cap", async () => {
    const jobs: ProcessingQueueJob[] = [
      { id: 1, job_type: "analysis", run_id: 15, progress_key: "ingest-store-analyze-15" },
      { id: 2, job_type: "analysis", run_id: 16, progress_key: "ingest-store-analyze-16" },
      { id: 3, job_type: "analysis", run_id: 17, progress_key: "ingest-store-analyze-17" },
    ];
    const store = {
      claimNext: vi.fn(async () => jobs.shift() || null),
      markDone: vi.fn(async () => undefined),
      requeue: vi.fn(),
      failAttempt: vi.fn(async () => ({ willRetry: false, attempts: 1 })),
      markFailed: vi.fn(),
      markCancelled: vi.fn(),
      isCancelled: vi.fn(async () => false),
      cancelJob: vi.fn(),
      enqueueJobs: vi.fn(),
    };
    const release: Array<() => void> = [];
    const deps = {
      runAnalysis: vi.fn(async () => {
        await new Promise<void>((resolve) => release.push(resolve));
        return { analyzed: 1, total: 1, provider: "test" };
      }),
      discoverAndStoreRunMemory: vi.fn(async () => ({ run_id: 15, comments: 1, subtopics: 0, evidence: 0, provider: "test", model: "test" })),
      runTranslation: vi.fn(),
    };
    const env = {} as any;

    const drain = drainProcessingQueue(env, deps, store, { maxConcurrentJobs: 2 });

    await vi.waitFor(() => expect(deps.runAnalysis).toHaveBeenCalledTimes(2));
    expect(store.markDone).not.toHaveBeenCalled();

    release.shift()?.();
    release.shift()?.();
    await vi.waitFor(() => expect(deps.runAnalysis).toHaveBeenCalledTimes(3));
    release.shift()?.();

    await drain;
    expect(store.markDone).toHaveBeenCalledTimes(3);
    expect(store.claimNext).toHaveBeenCalledWith(env, { maxRunning: 2 });
  });

  test("marks a running job cancelled instead of done when cancellation is detected", async () => {
    const jobs: ProcessingQueueJob[] = [
      { id: 8, job_type: "analysis", run_id: 22, progress_key: "ingest-group-analyze-22" },
    ];
    const store = {
      claimNext: vi.fn(async () => jobs.shift() || null),
      markDone: vi.fn(),
      requeue: vi.fn(),
      failAttempt: vi.fn(async () => ({ willRetry: false, attempts: 1 })),
      markFailed: vi.fn(),
      markCancelled: vi.fn(),
      isCancelled: vi.fn(async () => true),
      cancelJob: vi.fn(),
      enqueueJobs: vi.fn(),
    };
    const deps = {
      runAnalysis: vi.fn(async () => ({ analyzed: 1, total: 1, provider: "test" })),
      discoverAndStoreRunMemory: vi.fn(async () => ({ run_id: 22, comments: 1, subtopics: 0, evidence: 0, provider: "test", model: "test" })),
      runTranslation: vi.fn(),
    };
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn(async () => ({ id: 1 })),
          run: vi.fn(async () => ({})),
        })),
      },
    } as any;

    await drainProcessingQueue(env, deps, store, { maxConcurrentJobs: 1 });

    expect(store.markDone).not.toHaveBeenCalled();
    expect(store.markFailed).not.toHaveBeenCalled();
    expect(store.markCancelled).toHaveBeenCalledWith(env, 8, "Processing job cancelled");
  });

  test("cancels queued or running processing jobs by id", async () => {
    const store = {
      claimNext: vi.fn(),
      markDone: vi.fn(),
      requeue: vi.fn(),
      failAttempt: vi.fn(async () => ({ willRetry: false, attempts: 1 })),
      markFailed: vi.fn(),
      markCancelled: vi.fn(),
      isCancelled: vi.fn(),
      cancelJob: vi.fn(async () => ({ id: 12, progress_key: "ingest-store-analyze-12" })),
      enqueueJobs: vi.fn(),
    };
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn(async () => ({ id: 1 })),
          run: vi.fn(async () => ({})),
        })),
      },
    } as any;

    await expect(cancelProcessingJob(env, 12, store)).resolves.toEqual({ id: 12, status: "cancelled" });
    expect(store.cancelJob).toHaveBeenCalledWith(env, 12, "Processing job cancelled by user");
  });

  test("can cancel failed processing jobs so users can clear error rows", async () => {
    const statements: string[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          statements.push(sql);
          return {
            bind: vi.fn().mockReturnThis(),
            first: vi.fn(async () => {
              if (sql.includes("UPDATE processing_queue")) {
                return { id: 13, progress_key: "ingest-store-translate-13" };
              }
              return { id: 99 };
            }),
            run: vi.fn(async () => ({})),
          };
        },
      },
    } as any;

    await expect(cancelProcessingJob(env, 13)).resolves.toEqual({ id: 13, status: "cancelled" });
    expect(statements[0]).toContain("status IN ('queued', 'running', 'failed')");
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
                    run_note: "{\"start_date\":\"2026-06-29\",\"end_date\":\"2026-07-05\"}",
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
        run: expect.objectContaining({
          id: 42,
          source_type: "store",
          note: "{\"start_date\":\"2026-06-29\",\"end_date\":\"2026-07-05\"}",
        }),
      }),
    ]);
    expect(calls[0].sql).toContain("FROM processing_queue q");
    expect(calls[0].sql).toContain("LEFT JOIN analyze_jobs p");
    expect(calls[0].args).toEqual([10]);
  });

  test("recoverStaleProcessingJobs marks queue rows done when their progress is already done", async () => {
    const calls: { sql: string; args: any[] }[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: any[]) {
              calls.push({ sql, args });
              return this;
            },
            async run() {
              return {};
            },
          };
        },
      },
    } as any;

    await recoverStaleProcessingJobs(env, 600000);

    expect(calls[0].sql).toContain("EXISTS");
    expect(calls[0].sql).toContain("p.status = 'done'");
    expect(calls[1].sql).toContain("SET status = 'queued'");
  });

  test("requeues incomplete analysis slices instead of holding a Worker event open", async () => {
    const jobs: ProcessingQueueJob[] = [
      { id: 20, job_type: "analysis", run_id: 22, progress_key: "run-22" },
    ];
    const store = {
      claimNext: vi.fn(async () => jobs.shift() || null),
      markDone: vi.fn(),
      requeue: vi.fn(),
      failAttempt: vi.fn(async () => ({ willRetry: false, attempts: 1 })),
      markFailed: vi.fn(),
      markCancelled: vi.fn(),
      isCancelled: vi.fn(async () => false),
      cancelJob: vi.fn(),
      enqueueJobs: vi.fn(),
    };
    const deps = {
      runAnalysis: vi.fn(async () => ({ analyzed: 150, total: 15674, provider: "test", complete: false })),
      discoverAndStoreRunMemory: vi.fn(),
      runTranslation: vi.fn(),
    };
    const env = {} as any;

    await drainProcessingQueue(env, deps, store, { maxConcurrentJobs: 1 });

    expect(store.requeue).toHaveBeenCalledWith(env, 20);
    expect(store.markDone).not.toHaveBeenCalled();
    expect(deps.discoverAndStoreRunMemory).not.toHaveBeenCalled();
    expect(store.claimNext).toHaveBeenCalledTimes(1);
    expect(deps.runAnalysis).toHaveBeenCalledWith(env, expect.objectContaining({
      maxBatches: 3,
    }));
  });
});

describe("retrying instead of dying", () => {
  /** setProgress writes to analyze_jobs, so the error paths need a DB that responds. */
  function envWithDb() {
    return {
      DB: {
        prepare() {
          return {
            bind() { return this; },
            async first() { return { id: 1 }; },
            async run() { return {}; },
            async all() { return { results: [] }; },
          };
        },
      },
    } as any;
  }

  function storeWithFailAttempt(willRetry: boolean) {
    return {
      claimNext: vi.fn()
        .mockResolvedValueOnce({ id: 7, job_type: "analysis", progress_key: "run-97", run_id: 97 } as any)
        .mockResolvedValue(null),
      markDone: vi.fn(async () => {}),
      requeue: vi.fn(async () => {}),
      failAttempt: vi.fn(async () => ({ willRetry, attempts: willRetry ? 3 : 200 })),
      markFailed: vi.fn(async () => {}),
      markCancelled: vi.fn(async () => {}),
      isCancelled: vi.fn(async () => false),
      cancelJob: vi.fn(async () => null),
      enqueueJobs: vi.fn(async () => {}),
    };
  }

  test("a thrown job counts an attempt and is queued again, not marked failed", async () => {
    // One 502 from the LLM proxy used to end the whole run here.
    const store = storeWithFailAttempt(true);
    const deps = {
      runAnalysis: vi.fn(async () => { throw new Error("OpenAI API lỗi 502"); }),
      discoverAndStoreRunMemory: vi.fn(async () => ({}) as any),
      runTranslation: vi.fn(async () => ({}) as any),
    } as any;

    await drainProcessingQueue(envWithDb(), deps, store as any);

    expect(store.failAttempt).toHaveBeenCalledWith(expect.anything(), 7, expect.stringContaining("502"), expect.any(Number));
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  test("only once the attempts are exhausted does the job stay failed", async () => {
    const store = storeWithFailAttempt(false);
    const deps = {
      runAnalysis: vi.fn(async () => { throw new Error("still broken"); }),
      discoverAndStoreRunMemory: vi.fn(async () => ({}) as any),
      runTranslation: vi.fn(async () => ({}) as any),
    } as any;

    await drainProcessingQueue(envWithDb(), deps, store as any);

    // failAttempt itself flips the row to 'failed' once attempts run out, so the job
    // is neither requeued nor separately marked failed.
    expect(store.failAttempt).toHaveBeenCalledTimes(1);
    expect(store.requeue).not.toHaveBeenCalled();
    expect(store.markDone).not.toHaveBeenCalled();
  });

  test("a cancelled job is still cancelled, not retried", async () => {
    const store = storeWithFailAttempt(true);
    store.isCancelled = vi.fn(async () => true);
    const deps = {
      runAnalysis: vi.fn(async () => ({ analyzed: 0, complete: true }) as any),
      discoverAndStoreRunMemory: vi.fn(async () => ({}) as any),
      runTranslation: vi.fn(async () => ({}) as any),
    } as any;

    await drainProcessingQueue(envWithDb(), deps, store as any);

    expect(store.markCancelled).toHaveBeenCalled();
    expect(store.failAttempt).not.toHaveBeenCalled();
  });
});
