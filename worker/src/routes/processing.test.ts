import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelProcessingJob: vi.fn(),
  listProcessingJobs: vi.fn(),
  drainProcessingQueue: vi.fn(),
}));

vi.mock("../services/processingQueue", () => ({
  cancelProcessingJob: mocks.cancelProcessingJob,
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
    mocks.cancelProcessingJob.mockResolvedValue({ id: 7, status: "cancelled" });
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

  test("cancels a queued or running processing job and kicks the queue drainer", async () => {
    const env = { DB: {} } as any;
    const ctx = executionCtx();

    const res = await processingRoute.request("/jobs/7/cancel", { method: "POST" }, env, ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: 7, status: "cancelled" });
    expect(mocks.cancelProcessingJob).toHaveBeenCalledWith(env, 7);
    expect(ctx.scheduled).toHaveLength(1);
    await Promise.all(ctx.scheduled);
    expect(mocks.drainProcessingQueue).toHaveBeenCalledWith(env);
  });

  test("returns 404 when the processing job cannot be cancelled", async () => {
    const env = { DB: {} } as any;
    mocks.cancelProcessingJob.mockResolvedValue(null);

    const res = await processingRoute.request("/jobs/99/cancel", { method: "POST" }, env, executionCtx());

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ detail: "Processing job not found or already finished" });
  });
});
