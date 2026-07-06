import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listProcessingJobs: vi.fn(),
  drainProcessingQueue: vi.fn(),
}));

vi.mock("../services/processingQueue", () => ({
  listProcessingJobs: mocks.listProcessingJobs,
  drainProcessingQueue: mocks.drainProcessingQueue,
}));

import { processingRoute } from "./processing";

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

describe("processingRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProcessingJobs.mockResolvedValue([]);
    mocks.drainProcessingQueue.mockResolvedValue(undefined);
  });

  test("lists active processing jobs and kicks the queue drainer", async () => {
    const env = { DB: {} } as any;
    const ctx = executionCtx();
    mocks.listProcessingJobs.mockResolvedValue([
      { id: 1, job_type: "analysis", progress_key: "run-15", status: "queued" },
    ]);

    const res = await processingRoute.request("/jobs?limit=5", {}, env, ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([
      { id: 1, job_type: "analysis", progress_key: "run-15", status: "queued" },
    ]);
    expect(mocks.listProcessingJobs).toHaveBeenCalledWith(env, { limit: 5 });
    expect(ctx.scheduled).toHaveLength(1);
    await Promise.all(ctx.scheduled);
    expect(mocks.drainProcessingQueue).toHaveBeenCalledWith(env);
  });
});
