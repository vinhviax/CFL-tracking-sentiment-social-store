import assert from "node:assert/strict";
import test from "node:test";
import {
  displayDateToIso,
  formatDisplayDate,
  formatDisplayDateTime,
  isoToDisplayDate,
} from "./dateFormat.js";

test("formats dates as dd/mm/yyyy with leading zeroes", () => {
  assert.equal(formatDisplayDate("2026-07-04"), "04/07/2026");
  assert.equal(formatDisplayDate("2026-7-4"), "04/07/2026");
  assert.equal(isoToDisplayDate("2026-06-29"), "29/06/2026");
});

test("formats date-times as dd/mm/yyyy hh:mm:ss", () => {
  assert.match(formatDisplayDateTime("2026-07-04T01:02:03Z"), /^04\/07\/2026 \d{2}:\d{2}:\d{2}$/);
});

test("parses dd/mm/yyyy input back to yyyy-mm-dd for APIs", () => {
  assert.equal(displayDateToIso("29/06/2026"), "2026-06-29");
  assert.equal(displayDateToIso("4/7/2026"), "2026-07-04");
  assert.equal(displayDateToIso("2026-07-04"), "2026-07-04");
  assert.equal(displayDateToIso("31/02/2026"), null);
});
