import { describe, expect, test } from "vitest";
import { getCsvDateRange, filterFreshUniqueHashes, filterGroupCsvRows, validateCsvGroupImport } from "./csvIngest";

describe("filterFreshUniqueHashes", () => {
  test("drops hashes that already exist in DB and duplicate hashes within the same upload", () => {
    const existing = new Set(["db-existing"]);
    const rows = [
      { hash: "new-a", row: "first" },
      { hash: "db-existing", row: "already stored" },
      { hash: "new-a", row: "duplicate in file" },
      { hash: "new-b", row: "second unique" },
    ];

    expect(filterFreshUniqueHashes(rows, existing)).toEqual([
      { hash: "new-a", row: "first" },
      { hash: "new-b", row: "second unique" },
    ]);
  });
});

describe("Facebook Group CSV guardrails", () => {
  test("only keeps rows whose source column is Group", () => {
    const rows = [
      { source: "Group", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "lag", legacyTopic: null },
      { source: "Fanpage", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "event", legacyTopic: null },
      { source: " group ", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "hack", legacyTopic: null },
    ];

    expect(filterGroupCsvRows(rows).map((row) => row.commentMessage)).toEqual(["lag", "hack"]);
  });

  test("rejects a CSV upload that contains no Group rows", () => {
    expect(() => validateCsvGroupImport({ totalRows: 2, groupRows: 0, freshRows: 0 }))
      .toThrow(/khong co dong Group/i);
  });

  test("rejects a CSV upload when every Group row is already imported or duplicated", () => {
    expect(() => validateCsvGroupImport({ totalRows: 4, groupRows: 3, freshRows: 0 }))
      .toThrow(/khong co comment Group moi/i);
  });

  test("detects the first and last comment date from Group rows", () => {
    const rows = [
      { source: "Group", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "lag", legacyTopic: null },
      { source: "Group", postPublished: "", postMessage: "", createdDate: "4/7/2026 08:30:00", commentMessage: "hack", legacyTopic: null },
      { source: "Group", postPublished: "", postMessage: "", createdDate: "bad date", commentMessage: "ignored", legacyTopic: null },
    ];

    expect(getCsvDateRange(rows)).toEqual({
      data_start_date: "2026-07-04",
      data_end_date: "2026-07-06",
    });
  });
});
