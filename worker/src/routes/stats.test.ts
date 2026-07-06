import { describe, expect, test } from "vitest";
import { summarizeStoreBreakdown } from "../services/storeStats";

describe("summarizeStoreBreakdown", () => {
  test("computes Store average rating and range highlights from rating distribution", () => {
    const got = summarizeStoreBreakdown(
      { "1": 3, "2": 2, "3": 1, "4": 4, "5": 10 },
      [
        { store: "gp", count: 11, avg_rating: 3.12 },
        { store: "ios", count: 9, avg_rating: 4.6 },
      ]
    );

    expect(got.avg_rating).toBe(3.8);
    expect(got.rating_count).toBe(20);
    expect(got.low_rating_count).toBe(5);
    expect(got.low_rating_pct).toBe(25);
    expect(got.high_rating_count).toBe(14);
    expect(got.high_rating_pct).toBe(70);
    expect(got.lowest_platform).toEqual({ store: "gp", count: 11, avg_rating: 3.12 });
    expect(got.highlights).toEqual([
      { key: "avg_rating", label: "Điểm trung bình", value: "3.8/5", tone: "neutral" },
      { key: "low_ratings", label: "Review 1-2 sao", value: "5 (25%)", tone: "negative" },
      { key: "high_ratings", label: "Review 4-5 sao", value: "14 (70%)", tone: "positive" },
      { key: "lowest_platform", label: "Nền tảng cần chú ý", value: "Google Play 3.12/5", tone: "warning" },
    ]);
  });

  test("returns empty highlights when Store ratings are not available", () => {
    const got = summarizeStoreBreakdown(
      { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
      []
    );

    expect(got.avg_rating).toBeNull();
    expect(got.rating_count).toBe(0);
    expect(got.lowest_platform).toBeNull();
    expect(got.highlights).toEqual([]);
  });
});
