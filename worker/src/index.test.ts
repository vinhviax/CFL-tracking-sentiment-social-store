import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestFacebook: vi.fn(),
  ingestSensorTower: vi.fn(),
  seedSourceCursor: vi.fn(),
  buildCursorCatchupRange: vi.fn(),
  upsertSourceCursor: vi.fn(),
  enqueueProcessingJobs: vi.fn(),
  drainProcessingQueue: vi.fn(),
  recoverStaleProcessingJobs: vi.fn(),
  retryFailedProcessingJobs: vi.fn(),
  resetAllSlotsForNewDay: vi.fn(),
}));

vi.mock("./routes/analyze", () => ({ analyzeRoute: { routes: [] } }));
vi.mock("./routes/comments", () => ({ commentsRoute: { routes: [] } }));
vi.mock("./routes/export", () => ({ exportRoute: { routes: [] } }));
vi.mock("./routes/ingest", () => ({ ingestRoute: { routes: [] } }));
vi.mock("./routes/insights", () => ({ insightsRoute: { routes: [] } }));
vi.mock("./routes/llmConfig", () => ({ llmConfigRoute: { routes: [] } }));
vi.mock("./routes/posts", () => ({ postsRoute: { routes: [] } }));
vi.mock("./routes/processing", () => ({ processingRoute: { routes: [] } }));
vi.mock("./routes/report", () => ({ reportRoute: { routes: [] } }));
vi.mock("./routes/runs", () => ({ runsRoute: { routes: [] } }));
vi.mock("./routes/stats", () => ({ statsRoute: { routes: [] } }));
vi.mock("./routes/translate", () => ({ translateRoute: { routes: [] } }));
vi.mock("./services/facebook", () => ({ ingestFacebook: mocks.ingestFacebook }));
vi.mock("./services/sensortower", () => ({ ingestSensorTower: mocks.ingestSensorTower }));
vi.mock("./services/processingQueue", () => ({
  buildRunProcessingJobs: (runId: number, prefix: string) => [
    { job_type: "analysis", run_id: runId, progress_key: `${prefix}-analyze-${runId}` },
    { job_type: "translation", run_id: runId, progress_key: `${prefix}-translate-${runId}`, locale: "zh-CN" },
  ],
  enqueueProcessingJobs: mocks.enqueueProcessingJobs,
  drainProcessingQueue: mocks.drainProcessingQueue,
  recoverStaleProcessingJobs: mocks.recoverStaleProcessingJobs,
  retryFailedProcessingJobs: mocks.retryFailedProcessingJobs,
}));
vi.mock("./services/llmSlotState", () => ({ resetAllSlotsForNewDay: mocks.resetAllSlotsForNewDay }));
vi.mock("./services/sensortowerCursor", () => ({
  SENSOR_TOWER_CURSOR_KEY: "sensortower_store",
  FACEBOOK_CURSOR_KEY: "facebook_page",
  addDays: (date: string, days: number) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  },
  buildCursorCatchupRange: mocks.buildCursorCatchupRange,
  seedSourceCursor: mocks.seedSourceCursor,
  upsertSourceCursor: mocks.upsertSourceCursor,
}));

import worker, { DAILY_INGEST_CRON, DAILY_SLOT_RESET_CRON, dailyJob } from "./index";

/**
 * The scheduled handler must not hand its work to ctx.waitUntil and return.
 *
 * Cloudflare cancels waitUntil tasks roughly 30s after the invocation ends — it logs
 * "waitUntil() tasks did not complete within the allowed time and have been cancelled".
 * An LLM batch takes 25-35s, so every sweep was killed mid-batch: the job stayed
 * 'running' with nothing to finish it, stale recovery reclaimed it 3 minutes later, and
 * the run restarted from batch 1 forever. Awaiting keeps the invocation alive for the
 * whole sweep, which is what makes a long run finish on its own.
 */
describe("scheduled handler keeps its work inside the invocation", () => {
  const cronEvent = (cron: string) => ({ cron, scheduledTime: Date.now(), noRetry() {} }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recoverStaleProcessingJobs.mockResolvedValue(undefined);
    mocks.retryFailedProcessingJobs.mockResolvedValue(0);
    mocks.resetAllSlotsForNewDay.mockResolvedValue(undefined);
    mocks.enqueueProcessingJobs.mockResolvedValue(undefined);
    mocks.seedSourceCursor.mockResolvedValue(null);
    mocks.buildCursorCatchupRange.mockReturnValue(null);
  });

  test("the five-minute sweep finishes draining before scheduled() resolves", async () => {
    let drained = false;
    mocks.drainProcessingQueue.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      drained = true;
    });
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any;

    await worker.scheduled(cronEvent("*/5 * * * *"), {} as any, ctx);

    expect(drained).toBe(true);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  test("the daily ingest is awaited too, not fired into the background", async () => {
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any;

    await worker.scheduled(cronEvent(DAILY_INGEST_CRON), {} as any, ctx);

    expect(mocks.seedSourceCursor).toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  test("the daily slot reset is awaited too", async () => {
    mocks.drainProcessingQueue.mockResolvedValue(undefined);
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any;

    await worker.scheduled(cronEvent(DAILY_SLOT_RESET_CRON), {} as any, ctx);

    expect(mocks.resetAllSlotsForNewDay).toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
});

describe("scheduled cursor ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueProcessingJobs.mockResolvedValue(undefined);
    mocks.drainProcessingQueue.mockResolvedValue(undefined);
    mocks.upsertSourceCursor.mockResolvedValue(undefined);
  });

  test("pulls Store and Fanpage from their own cursor dates to today", async () => {
    const env = {} as any;
    mocks.seedSourceCursor
      .mockResolvedValueOnce("2026-07-05")
      .mockResolvedValueOnce("2026-07-06");
    mocks.buildCursorCatchupRange
      .mockReturnValueOnce({ startDate: "2026-07-05", endDate: "2026-07-07" })
      .mockReturnValueOnce({ startDate: "2026-07-06", endDate: "2026-07-07" });
    mocks.ingestSensorTower.mockResolvedValue({
      id: 21,
      source_type: "store",
      status: "done",
      rows_new: 4,
    });
    mocks.ingestFacebook.mockResolvedValue({
      id: 22,
      source_type: "fb_page",
      status: "done",
      rows_new: 3,
    });

    await dailyJob(env);

    expect(mocks.seedSourceCursor).toHaveBeenCalledWith(env, {
      key: "sensortower_store",
      sourceType: "store",
    });
    expect(mocks.seedSourceCursor).toHaveBeenCalledWith(env, {
      key: "facebook_page",
      sourceType: "fb_page",
    });
    expect(mocks.ingestSensorTower).toHaveBeenCalledWith(env, "2026-07-05", "2026-07-07", undefined, {
      mode: "scheduled_cursor",
      cursor_key: "sensortower_store",
      start_date: "2026-07-05",
      end_date: "2026-07-07",
    });
    expect(mocks.ingestFacebook).toHaveBeenCalledWith(env, "2026-07-06", "2026-07-08", 50, {
      mode: "scheduled_cursor",
      cursor_key: "facebook_page",
      start_date: "2026-07-06",
      end_date: "2026-07-07",
      post_limit: 50,
    });
    expect(mocks.upsertSourceCursor).toHaveBeenCalledWith(env, "sensortower_store", "2026-07-07", 21);
    expect(mocks.upsertSourceCursor).toHaveBeenCalledWith(env, "facebook_page", "2026-07-07", 22);
  });
});
