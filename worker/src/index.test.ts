import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestFacebook: vi.fn(),
  ingestSensorTower: vi.fn(),
  seedSourceCursor: vi.fn(),
  buildCursorCatchupRange: vi.fn(),
  upsertSourceCursor: vi.fn(),
  enqueueProcessingJobs: vi.fn(),
  drainProcessingQueue: vi.fn(),
}));

vi.mock("./routes/analyze", () => ({ analyzeRoute: { routes: [] } }));
vi.mock("./routes/comments", () => ({ commentsRoute: { routes: [] } }));
vi.mock("./routes/export", () => ({ exportRoute: { routes: [] } }));
vi.mock("./routes/ingest", () => ({ ingestRoute: { routes: [] } }));
vi.mock("./routes/insights", () => ({ insightsRoute: { routes: [] } }));
vi.mock("./routes/posts", () => ({ postsRoute: { routes: [] } }));
vi.mock("./routes/processing", () => ({ processingRoute: { routes: [] } }));
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
}));
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

import { dailyJob } from "./index";

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
