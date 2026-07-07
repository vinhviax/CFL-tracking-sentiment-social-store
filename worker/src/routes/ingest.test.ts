import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestCsv: vi.fn(),
  parseRows: vi.fn(),
  ingestFacebook: vi.fn(),
  ingestSensorTower: vi.fn(),
  upsertSourceCursor: vi.fn(),
  enqueueProcessingJobs: vi.fn(),
  drainProcessingQueue: vi.fn(),
}));

vi.mock("../services/csvIngest", () => ({
  ingestCsv: mocks.ingestCsv,
  parseRows: mocks.parseRows,
  filterFacebookCsvRows: (rows: any[]) => rows.filter((row) => ["fanpage", "group"].includes(String(row.source || "").trim().toLowerCase())),
  getFacebookCsvSourceCounts: (rows: any[]) => {
    const fanpageRows = rows.filter((row) => String(row.source || "").trim().toLowerCase() === "fanpage").length;
    const groupRows = rows.filter((row) => String(row.source || "").trim().toLowerCase() === "group").length;
    return {
      fanpage_rows: fanpageRows,
      group_rows: groupRows,
      importable_rows: fanpageRows + groupRows,
      skipped_rows: rows.length - fanpageRows - groupRows,
    };
  },
  getCsvDateRange: (rows: any[]) => {
    const dates = rows
      .map((row) => {
        const value = String(row.createdDate || "");
        const vn = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (!vn) return null;
        return `${vn[3]}-${vn[2].padStart(2, "0")}-${vn[1].padStart(2, "0")}`;
      })
      .filter(Boolean)
      .sort();
    return { data_start_date: dates[0] || null, data_end_date: dates.at(-1) || null };
  },
}));
vi.mock("../services/facebook", () => ({
  ingestFacebook: mocks.ingestFacebook,
}));
vi.mock("../services/sensortower", () => ({
  ingestSensorTower: mocks.ingestSensorTower,
}));
vi.mock("../services/sensortowerCursor", () => ({
  SENSOR_TOWER_CURSOR_KEY: "sensortower_store",
  FACEBOOK_CURSOR_KEY: "facebook_page",
  upsertSourceCursor: mocks.upsertSourceCursor,
}));
vi.mock("../services/processingQueue", () => ({
  buildRunProcessingJobs: (runId: number, progressPrefix: string, locale = "zh-CN") => [
    { job_type: "analysis", run_id: runId, progress_key: `${progressPrefix}-analyze-${runId}` },
    { job_type: "translation", run_id: runId, progress_key: `${progressPrefix}-translate-${runId}`, locale },
  ],
  enqueueProcessingJobs: mocks.enqueueProcessingJobs,
  drainProcessingQueue: mocks.drainProcessingQueue,
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
    mocks.enqueueProcessingJobs.mockResolvedValue(undefined);
    mocks.drainProcessingQueue.mockResolvedValue(undefined);
    mocks.upsertSourceCursor.mockResolvedValue(undefined);
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
    expect(mocks.enqueueProcessingJobs).toHaveBeenCalledWith(testEnv, [
      { job_type: "analysis", run_id: 51, progress_key: "ingest-store-analyze-51" },
      { job_type: "translation", run_id: 51, progress_key: "ingest-store-translate-51", locale: "zh-CN" },
    ]);
    expect(mocks.drainProcessingQueue).toHaveBeenCalledWith(testEnv);
    expect(mocks.upsertSourceCursor).toHaveBeenCalledWith(testEnv, "sensortower_store", "2026-07-06", 51);
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
    expect(mocks.enqueueProcessingJobs).toHaveBeenCalledWith(testEnv, [
      { job_type: "analysis", run_id: 52, progress_key: "ingest-facebook-analyze-52" },
      { job_type: "translation", run_id: 52, progress_key: "ingest-facebook-translate-52", locale: "zh-CN" },
    ]);
  });

  test("passes the selected Fanpage date range to Facebook ingest", async () => {
    const testEnv = env();
    mocks.ingestFacebook.mockResolvedValue({
      id: 55,
      source_type: "fb_page",
      status: "done",
      rows_fetched: 30,
      rows_new: 12,
    });

    const res = await ingestRoute.request(
      "/facebook",
      { method: "POST", body: JSON.stringify({ since: "2026-06-29", until: "2026-07-06" }) },
      testEnv,
      executionCtx()
    );

    expect(res.status).toBe(200);
    expect(mocks.ingestFacebook).toHaveBeenCalledWith(
      testEnv,
      "2026-06-29",
      "2026-07-07",
      undefined,
      {
        start_date: "2026-06-29",
        end_date: "2026-07-06",
        post_limit: "all",
      },
      { startDate: "2026-06-29", endDate: "2026-07-06" }
    );
    expect(mocks.upsertSourceCursor).toHaveBeenCalledWith(testEnv, "facebook_page", "2026-07-06", 55);
  });

  test("queues analysis then zh-CN translation after Facebook CSV upload", async () => {
    const testEnv = env();
    mocks.ingestCsv.mockResolvedValue({
      id: 53,
      source_type: "facebook_csv",
      status: "done",
      rows_fetched: 3,
      rows_new: 3,
    });
    const ctx = executionCtx();
    const form = new FormData();
    form.append("file", new File(["source\tcreated_date\tcomment_message\nFanpage\t2026-07-06\tlag"], "fanpage.csv"));

    const res = await ingestRoute.request(
      "/upload-csv",
      { method: "POST", body: form },
      testEnv,
      ctx
    );

    expect(res.status).toBe(200);
    expect(ctx.scheduled).toHaveLength(1);
    await flushScheduled(ctx);
    expect(mocks.enqueueProcessingJobs).toHaveBeenCalledWith(testEnv, [
      { job_type: "analysis", run_id: 53, progress_key: "ingest-facebook-csv-analyze-53" },
      { job_type: "translation", run_id: 53, progress_key: "ingest-facebook-csv-translate-53", locale: "zh-CN" },
    ]);
  });

  test("CSV preview counts Fanpage and Group rows as importable", async () => {
    mocks.parseRows.mockReturnValue([
      { source: "Group", createdDate: "6/7/2026", commentMessage: "lag", legacyTopic: null },
      { source: "Group", createdDate: "4/7/2026 08:30:00", commentMessage: "hack", legacyTopic: null },
      { source: "Fanpage", createdDate: "6/7/2026", commentMessage: "event", legacyTopic: null },
      { source: "Store", createdDate: "6/7/2026", commentMessage: "ignored", legacyTopic: null },
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
      total_rows: 4,
      fanpage_rows: 1,
      group_rows: 2,
      skipped_non_group_rows: 1,
      importable_rows: 3,
      sample: [
        { source: "Group", comment_message: "lag" },
        { source: "Group", comment_message: "hack" },
        { source: "Fanpage", comment_message: "event" },
      ],
      data_start_date: "2026-07-04",
      data_end_date: "2026-07-06",
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
    expect(mocks.enqueueProcessingJobs).not.toHaveBeenCalled();
    expect(mocks.drainProcessingQueue).not.toHaveBeenCalled();
  });

  test("status returns latest data date for Store, Fanpage, and Group", async () => {
    const calls: { sql: string; args: any[] }[] = [];
    const testEnv = {
      DB: {
        prepare(sql: string) {
          calls.push({ sql, args: [] });
          return {
            bind(...args: any[]) {
              calls.push({ sql, args });
              return this;
            },
            async all() {
              if (sql.includes("FROM ingest_cursors")) {
                return {
                  results: [
                    { key: "facebook_page", cursor_date: "2026-07-07", last_run_id: 32 },
                    { key: "sensortower_store", cursor_date: "2026-07-06", last_run_id: 23 },
                  ],
                };
              }
              if (sql.includes("FROM comments")) {
                return {
                  results: [
                    { source_type: "store", latest_data_date: "2026-07-06" },
                    { source_type: "fb_page", latest_data_date: "2026-07-06" },
                    { source_type: "fb_group_csv", latest_data_date: "2026-07-05" },
                  ],
                };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes("source_type = 'store'")) return { id: 23, source_type: "store", status: "done" };
              if (sql.includes("source_type = 'fb_page'")) return { id: 32, source_type: "fb_page", status: "done" };
              if (sql.includes("source_type = 'fb_group_csv'")) return { id: 21, source_type: "fb_group_csv", status: "done" };
              return null;
            },
          };
        },
      },
    } as any;

    const res = await ingestRoute.request("/status", {}, testEnv, executionCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      source_status: [
        { key: "store", label: "Store", latest_data_date: "2026-07-06", cursor_date: "2026-07-06" },
        { key: "facebook_page", label: "Fanpage", latest_data_date: "2026-07-06", cursor_date: "2026-07-07" },
        { key: "facebook_group", label: "Group Fanpage", latest_data_date: "2026-07-05", cursor_date: null },
      ],
    });
    expect(calls.some((call) => call.sql.includes("GROUP BY source_type"))).toBe(true);
  });
});
