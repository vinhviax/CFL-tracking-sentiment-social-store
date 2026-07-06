import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteIngestRun: vi.fn(),
}));

vi.mock("../services/deleteIngestRun", () => ({
  deleteIngestRun: mocks.deleteIngestRun,
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
      comment_count: 141,
      analyzed_count: 141,
      translated_zh_cn_count: 141,
    });

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
