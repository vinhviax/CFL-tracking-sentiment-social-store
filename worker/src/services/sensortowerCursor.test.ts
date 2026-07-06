import { describe, expect, test } from "vitest";
import { buildCursorCatchupRange, getTodayBangkokDate, pickSeedCursorDate } from "./sensortowerCursor";

describe("ingest source cursor dates", () => {
  test("uses today in Asia/Bangkok as the cron cutoff date", () => {
    const cronTime = new Date("2026-07-07T06:45:00.000Z");

    expect(getTodayBangkokDate(cronTime)).toBe("2026-07-07");
  });

  test("builds an inclusive catch-up range from each source cursor to today", () => {
    const cronTime = new Date("2026-07-07T06:45:00.000Z");

    expect(buildCursorCatchupRange("2026-07-05", cronTime)).toEqual({
      startDate: "2026-07-05",
      endDate: "2026-07-07",
    });
  });

  test("returns no dates when cursor is already caught up", () => {
    const cronTime = new Date("2026-07-07T06:45:00.000Z");

    expect(buildCursorCatchupRange("2026-07-07", cronTime)).toBeNull();
  });

  test("seeds from the latest successful run end date before comment dates", () => {
    const cronTime = new Date("2026-07-07T06:45:00.000Z");

    expect(pickSeedCursorDate("2026-07-06", "2026-07-05", cronTime)).toBe("2026-07-06");
    expect(pickSeedCursorDate(null, "2026-07-05", cronTime)).toBe("2026-07-05");
    expect(pickSeedCursorDate(null, null, cronTime)).toBe("2026-07-07");
  });
});
