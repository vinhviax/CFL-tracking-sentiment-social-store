import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestCsv: vi.fn(),
  parseRows: vi.fn(),
  ingestFacebook: vi.fn(),
  ingestSensorTower: vi.fn(),
  processAutomatedFeedbackRun: vi.fn(),
}));

vi.mock("../services/csvIngest", () => ({
  ingestCsv: mocks.ingestCsv,
  parseRows: mocks.parseRows,
  filterGroupCsvRows: (rows: any[]) => rows.filter((row) => String(row.source || "").trim().toLowerCase() === "group"),
}));
vi.mock("../services/facebook", () => ({
  ingestFacebook: mocks.ingestFacebook,
}));
vi.mock("../services/sensortower", () => ({
  ingestSensorTower: mocks.ingestSensorTower,
}));
vi.mock("../services/sensortowerCursor", () => ({
  SENSOR_TOWER_CURSOR_KEY: "sensortower_store",
}));
vi.mock("../services/automatedProcessing", () => ({
  processAutomatedFeedbackRun: mocks.processAutomatedFeedbackRun,
}));

import { ingestRoute } from "./ingest";

function env() {
  return { DB: {} } as any;
}

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

async function flushScheduled(ctx: ReturnType<typeof executionCtx>) {
  await Promise.all(ctx.scheduled);
}

describe("ingestRoute automated processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processAutomatedFeedbackRun.mockResolvedValue({
      analysis: { analyzed: 1, total: 1, provider: "test" },
      memory: { run_id: 0, comments: 1, subtopics: 0, evidence: 0, provider: "test", model: "test" },
      translation: { translated: 1, total: 1, provider: "test" },
    });
  });

  test("queues analysis then zh-CN translation after manual Store ingest", async () => {
    const testEnv = env();
    mocks.ingestSensorTower.mockResolvedValue({
      id: 51,
      source_type: "store",
      status: "done",
      rows_fetched: 20,
      rows_new: 8,
    });
    const ctx = executionCtx();

    const res = await ingestRoute.request(
      "/sensortower",
      { method: "POST", body: JSON.stringify({ start_date: "2026-07-05", end_date: "2026-07-06" }) },
      testEnv,
      ctx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      auto_processing: {
        queued: true,
        analysis_progress_key: "ingest-store-analyze-51",
        translation_progress_key: "ingest-store-translate-51",
        locale: "zh-CN",
      },
    });
    expect(ctx.scheduled).toHaveLength(1);
    await flushScheduled(ctx);
    expect(mocks.processAutomatedFeedbackRun).toHaveBeenCalledWith(testEnv, {
      runId: 51,
      progressPrefix: "ingest-store",
    });
  });

  test("queues analysis then zh-CN translation after manual Facebook ingest", async () => {
    const testEnv = env();
    mocks.ingestFacebook.mockResolvedValue({
      id: 52,
      source_type: "fb_page",
      status: "done",
      rows_fetched: 10,
      rows_new: 4,
    });
    const ctx = executionCtx();

    const res = await ingestRoute.request(
      "/facebook",
      { method: "POST", body: JSON.stringify({ post_limit: 5 }) },
      testEnv,
      ctx
    );

    expect(res.status).toBe(200);
    expect(ctx.scheduled).toHaveLength(1);
    await flushScheduled(ctx);
    expect(mocks.processAutomatedFeedbackRun).toHaveBeenCalledWith(testEnv, {
      runId: 52,
      progressPrefix: "ingest-facebook",
    });
  });

  test("queues analysis then zh-CN translation after CSV Group upload", async () => {
    const testEnv = env();
    mocks.ingestCsv.mockResolvedValue({
      id: 53,
      source_type: "fb_group_csv",
      status: "done",
      rows_fetched: 3,
      rows_new: 3,
    });
    const ctx = executionCtx();
    const form = new FormData();
    form.append("file", new File(["source\tcreated_date\tcomment_message\nGroup\t2026-07-06\tlag"], "group.csv"));

    const res = await ingestRoute.request(
      "/upload-csv",
      { method: "POST", body: form },
      testEnv,
      ctx
    );

    expect(res.status).toBe(200);
    expect(ctx.scheduled).toHaveLength(1);
    await flushScheduled(ctx);
    expect(mocks.processAutomatedFeedbackRun).toHaveBeenCalledWith(testEnv, {
      runId: 53,
      progressPrefix: "ingest-fb-group",
    });
  });

  test("CSV preview counts only Group rows as importable", async () => {
    mocks.parseRows.mockReturnValue([
      { source: "Group", createdDate: "6/7/2026", commentMessage: "lag", legacyTopic: null },
      { source: "Fanpage", createdDate: "6/7/2026", commentMessage: "event", legacyTopic: null },
    ]);
    const form = new FormData();
    form.append("file", new File(["mock"], "mixed.csv"));

    const res = await ingestRoute.request(
      "/preview-csv",
      { method: "POST", body: form },
      env(),
      executionCtx()
    );

    await expect(res.json()).resolves.toMatchObject({
      total_rows: 2,
      group_rows: 1,
      skipped_non_group_rows: 1,
      sample: [{ source: "Group", comment_message: "lag" }],
    });
  });

  test("does not queue automated processing when Store ingest fails", async () => {
    mocks.ingestSensorTower.mockResolvedValue({
      id: 54,
      source_type: "store",
      status: "failed",
      error: "bad upstream",
    });
    const ctx = executionCtx();

    const res = await ingestRoute.request(
      "/sensortower",
      { method: "POST", body: JSON.stringify({}) },
      env(),
      ctx
    );

    expect(res.status).toBe(502);
    expect(ctx.scheduled).toHaveLength(0);
    expect(mocks.processAutomatedFeedbackRun).not.toHaveBeenCalled();
  });
});
