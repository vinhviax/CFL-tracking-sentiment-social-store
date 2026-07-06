import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueProcessingJobs: vi.fn(),
  drainProcessingQueue: vi.fn(),
}));

vi.mock("../services/processingQueue", () => ({
  enqueueProcessingJobs: mocks.enqueueProcessingJobs,
  drainProcessingQueue: mocks.drainProcessingQueue,
}));

import { analyzeRoute } from "./analyze";

function executionCtx() {
  const scheduled: Promise<unknown>[] = [];
  return {
    scheduled,
    waitUntil(promise: Promise<unknown>) {
      scheduled.push(promise);
    },
    passThroughOnException() {},
  } as any;
}

describe("analyzeRoute queueing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueProcessingJobs.mockResolvedValue(undefined);
    mocks.drainProcessingQueue.mockResolvedValue(undefined);
  });

  test("manual run enqueues analysis instead of replacing an active job", async () => {
    const env = { DB: {} } as any;
    const ctx = executionCtx();

    const res = await analyzeRoute.request(
      "/run",
      { method: "POST", body: JSON.stringify({ run_id: 77 }) },
      env,
      ctx
    );

    await expect(res.json()).resolves.toEqual({
      progress_key: "run-77",
      status: "queued",
    });
    expect(mocks.enqueueProcessingJobs).toHaveBeenCalledWith(env, [
      { job_type: "analysis", run_id: 77, progress_key: "run-77" },
    ]);
    expect(ctx.scheduled).toHaveLength(1);
    await Promise.all(ctx.scheduled);
    expect(mocks.drainProcessingQueue).toHaveBeenCalledWith(env);
  });
});
