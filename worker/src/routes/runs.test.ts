import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteIngestRun: vi.fn(),
  loadRunTokenUsage: vi.fn(),
}));

vi.mock("../services/deleteIngestRun", () => ({
  deleteIngestRun: mocks.deleteIngestRun,
}));
vi.mock("../services/tokenUsage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/tokenUsage")>()),
  loadRunTokenUsage: mocks.loadRunTokenUsage,
}));

import { mapRunRow } from "./runs";
import { runsRoute } from "./runs";

describe("mapRunRow", () => {
  test("adds analysis and zh-CN translation status for completed runs", () => {
    const got = mapRunRow({
      id: 13,
      source_type: "store",
      started_at: "2026-07-06T13:33:25.111Z",
      finished_at: "2026-07-06T13:33:28.978Z",
      status: "done",
      rows_fetched: 654,
      rows_new: 141,
      note: "{\"start_date\":\"2026-06-29\",\"end_date\":\"2026-07-06\"}",
      error: null,
      data_start_date: "2026-07-01",
      data_end_date: "2026-07-06",
      comment_count: 141,
      analyzed_count: 141,
      translated_zh_cn_count: 141,
    });

    expect(got.data_start_date).toBe("2026-07-01");
    expect(got.data_end_date).toBe("2026-07-06");
    expect(got.analysis_status).toBe("done");
    expect(got.translation_status).toBe("done");
    expect(got.analysis_progress).toEqual({ done: 141, total: 141 });
    expect(got.translation_progress).toEqual({ done: 141, total: 141, locale: "zh-CN" });
  });

  test("marks partial processing clearly", () => {
    const got = mapRunRow({
      id: 9,
      source_type: "fb_group_csv",
      status: "done",
      rows_fetched: 3124,
      rows_new: 641,
      comment_count: 641,
      analyzed_count: 60,
      translated_zh_cn_count: 0,
    });

    expect(got.analysis_status).toBe("partial");
    expect(got.translation_status).toBe("not_started");
  });
});

/**
 * The list endpoint must serve counts from the cached columns and only recount runs
 * whose work can still move. Recomputing them per request cost ~600k D1 row reads per
 * page load and grew with the dataset — see migration 0018.
 */
describe("runsRoute list reads cached counts", () => {
  function fakeDb(runRows: any[], queueRows: any[]) {
    const statements: string[] = [];
    const DB = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() {
            return {
              async all() {
                if (/FROM processing_queue/.test(sql)) return { results: queueRows };
                return { results: runRows };
              },
              async first() {
                if (/LEFT JOIN analyses/.test(sql)) {
                  return { comment_count: 9, analyzed_count: 4, translated_zh_cn_count: 1 };
                }
                if (/MIN\(SUBSTR/.test(sql)) {
                  return { data_start_date: "2026-09-01", data_end_date: "2026-09-02" };
                }
                return runRows[0] ?? null;
              },
              async run() {
                return {};
              },
            };
          },
        };
      },
    };
    return { env: { DB } as any, statements };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadRunTokenUsage.mockResolvedValue(new Map());
  });

  test("a settled run is served from cache with no recount", async () => {
    const { env, statements } = fakeDb(
      [{ id: 12, status: "done", comment_count: 141, analyzed_count: 141, translated_zh_cn_count: 141, counts_updated_at: "2026-09-03T10:00:00.000Z" }],
      [{ run_id: 12, last_touched_at: "2026-09-02T00:00:00.000Z", active: 0 }]
    );

    const res = await runsRoute.request("/", {}, env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject([{ id: 12, analysis_status: "done" }]);
    // No correlated subqueries over comments, and no recount for this run.
    expect(statements.some((sql) => /LEFT JOIN analyses/.test(sql))).toBe(false);
    expect(statements.some((sql) => /UPDATE ingest_runs/.test(sql))).toBe(false);
  });

  test("a run with a live job is recounted and served with the fresh numbers", async () => {
    const { env, statements } = fakeDb(
      [{ id: 13, status: "done", comment_count: 5, analyzed_count: 0, translated_zh_cn_count: 0, counts_updated_at: "2026-09-03T10:00:00.000Z" }],
      [{ run_id: 13, last_touched_at: "2026-09-03T11:00:00.000Z", active: 1 }]
    );

    const res = await runsRoute.request("/", {}, env);

    await expect(res.json()).resolves.toMatchObject([
      { id: 13, comment_count: 9, analyzed_count: 4, translated_zh_cn_count: 1, data_start_date: "2026-09-01" },
    ]);
    expect(statements.some((sql) => /UPDATE ingest_runs/.test(sql))).toBe(true);
  });
});

describe("runsRoute delete", () => {
  test("deletes an ingest run and returns deleted counts", async () => {
    const env = { DB: {} } as any;
    mocks.deleteIngestRun.mockResolvedValue({
      id: 13,
      source_type: "store",
      deleted: { comments: 141, analyses: 141, translations: 141 },
    });

    const res = await runsRoute.request("/13", { method: "DELETE" }, env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: 13,
      deleted: { comments: 141 },
    });
    expect(mocks.deleteIngestRun).toHaveBeenCalledWith(env.DB, 13);
  });

  test("returns 404 when deleting a missing ingest run", async () => {
    mocks.deleteIngestRun.mockResolvedValue(null);

    const res = await runsRoute.request("/999", { method: "DELETE" }, { DB: {} } as any);

    expect(res.status).toBe(404);
  });
});
