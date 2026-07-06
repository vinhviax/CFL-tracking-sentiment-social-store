import { describe, expect, test } from "vitest";
import { mapRunRow } from "./runs";

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
