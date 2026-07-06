import { describe, expect, test } from "vitest";
import { filterFreshSensorTowerReviews, parseReviewDate } from "./sensortower";

describe("filterFreshSensorTowerReviews", () => {
  test("drops existing DB hashes and duplicate hashes within one Sensor Tower pull", () => {
    const existing = new Set(["already-in-db"]);
    const reviews = [
      { hash: "new-review", r: { content: "first" } },
      { hash: "already-in-db", r: { content: "stored" } },
      { hash: "new-review", r: { content: "duplicate from API" } },
      { hash: "second-review", r: { content: "second" } },
    ];

    expect(filterFreshSensorTowerReviews(reviews, existing)).toEqual([
      { hash: "new-review", r: { content: "first" } },
      { hash: "second-review", r: { content: "second" } },
    ]);
  });
});

describe("parseReviewDate", () => {
  test("preserves the Sensor Tower source calendar date when an offset is present", () => {
    expect(parseReviewDate("2026-07-06T00:30:00+07:00")).toBe("2026-07-06T00:30:00.000Z");
  });

  test("preserves the Sensor Tower source calendar date for space-separated timestamps", () => {
    expect(parseReviewDate("2026-07-06 01:15:20")).toBe("2026-07-06T01:15:20.000Z");
  });
});
