import { describe, expect, test } from "vitest";
import { buildSensorTowerCatchupDates, getYesterdayBangkokDate } from "./sensortowerCursor";

describe("Sensor Tower cursor dates", () => {
  test("uses yesterday in Asia/Bangkok as the cron cutoff date", () => {
    const cronTime = new Date("2026-07-06T06:45:00.000Z");

    expect(getYesterdayBangkokDate(cronTime)).toBe("2026-07-05");
  });

  test("builds only missing dates after the cursor up to yesterday Bangkok time", () => {
    const cronTime = new Date("2026-07-06T06:45:00.000Z");

    expect(buildSensorTowerCatchupDates("2026-07-03", cronTime)).toEqual([
      "2026-07-04",
      "2026-07-05",
    ]);
  });

  test("returns no dates when cursor is already caught up", () => {
    const cronTime = new Date("2026-07-06T06:45:00.000Z");

    expect(buildSensorTowerCatchupDates("2026-07-05", cronTime)).toEqual([]);
  });
});
