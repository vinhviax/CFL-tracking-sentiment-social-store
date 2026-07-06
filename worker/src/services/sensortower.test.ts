import { describe, expect, test } from "vitest";
import { filterFreshSensorTowerReviews } from "./sensortower";

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
