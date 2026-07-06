import { describe, expect, test, vi } from "vitest";
import { drainProcessingQueue, type ProcessingQueueJob } from "./processingQueue";

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
});
