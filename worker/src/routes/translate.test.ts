import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueProcessingJobs: vi.fn(),
  drainProcessingQueue: vi.fn(),
}));

vi.mock("../services/processingQueue", () => ({
  enqueueProcessingJobs: mocks.enqueueProcessingJobs,
  drainProcessingQueue: mocks.drainProcessingQueue,
}));

import { translateRoute } from "./translate";

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

describe("translateRoute queueing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueProcessingJobs.mockResolvedValue(undefined);
    mocks.drainProcessingQueue.mockResolvedValue(undefined);
  });

  test("manual run enqueues translation behind earlier jobs", async () => {
    const env = { DB: {} } as any;
    const ctx = executionCtx();

    const res = await translateRoute.request(
      "/run",
      { method: "POST", body: JSON.stringify({ run_id: 88, locale: "zh-CN", limit: 300 }) },
      env,
      ctx
    );

    await expect(res.json()).resolves.toEqual({
      progress_key: "translate-run-88-zh-CN",
      status: "queued",
    });
    expect(mocks.enqueueProcessingJobs).toHaveBeenCalledWith(env, [
      {
        job_type: "translation",
        run_id: 88,
        progress_key: "translate-run-88-zh-CN",
        locale: "zh-CN",
        force: false,
        limit: 300,
      },
    ]);
    expect(ctx.scheduled).toHaveLength(1);
    await Promise.all(ctx.scheduled);
    expect(mocks.drainProcessingQueue).toHaveBeenCalledWith(env);
  });
});
