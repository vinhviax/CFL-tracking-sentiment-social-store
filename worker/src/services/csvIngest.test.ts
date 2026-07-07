import { describe, expect, test } from "vitest";
import {
  buildFacebookCsvDedupeKey,
  buildFacebookCsvPostExternalId,
  getCsvDateRange,
  getFacebookCsvSourceCounts,
  filterFreshUniqueHashes,
  filterFacebookCsvRows,
  parseRows,
  sourceTypeForCsvRow,
  validateFacebookCsvImport,
  getCsvDedupeLookupChunkSize,
  getCsvCommentInsertChunkSize,
  getCsvPostInsertChunkSize,
} from "./csvIngest";

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

describe("Facebook CSV guardrails", () => {
  test("keeps CSV dedupe lookups under the SQL variable limit", () => {
    expect(getCsvDedupeLookupChunkSize() * 2).toBeLessThanOrEqual(90);
  });

  test("keeps CSV insert batches large enough to avoid Worker subrequest limits", () => {
    expect(getCsvPostInsertChunkSize()).toBeGreaterThanOrEqual(50);
    expect(getCsvCommentInsertChunkSize()).toBeGreaterThanOrEqual(100);
  });

  test("parses Facebook CSV using columns A to E only and ignores source labels in later columns", () => {
    const csv = [
      "Source\tPost Published Date\tPost Message\tCreated Date\tComment Message\tTopic",
      "Group\t6/7/2026 13:28\tAi cho minh xin 6 manh\t6/7/2026 15:07\tNgoc Phuong cho toi xin manh con voi\titem_skin",
      "Fanpage\t6/7/2026 14:00\tCHỈ CẦN comment nhận code\t6/7/2026 15:08\tVNG nay chiều ae thế\tpositive",
    ].join("\n");

    const rows = filterFacebookCsvRows(parseRows(new TextEncoder().encode(csv).buffer as ArrayBuffer));

    expect(rows).toEqual([
      {
        source: "Group",
        postPublished: "6/7/2026 13:28",
        postMessage: "Ai cho minh xin 6 manh",
        createdDate: "6/7/2026 15:07",
        commentMessage: "Ngoc Phuong cho toi xin manh con voi",
        legacyTopic: null,
      },
      {
        source: "Fanpage",
        postPublished: "6/7/2026 14:00",
        postMessage: "CHỈ CẦN comment nhận code",
        createdDate: "6/7/2026 15:08",
        commentMessage: "VNG nay chiều ae thế",
        legacyTopic: null,
      },
    ]);
  });

  test("keeps rows whose source column is Fanpage or Group", () => {
    const rows = [
      { source: "Group", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "lag", legacyTopic: null },
      { source: "Fanpage", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "event", legacyTopic: null },
      { source: " group ", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "hack", legacyTopic: null },
      { source: " fanpage ", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "code", legacyTopic: null },
      { source: "Store", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "skip", legacyTopic: null },
    ];

    expect(filterFacebookCsvRows(rows).map((row) => row.commentMessage)).toEqual(["lag", "event", "hack", "code"]);
    expect(getFacebookCsvSourceCounts(rows)).toEqual({
      fanpage_rows: 2,
      group_rows: 2,
      importable_rows: 4,
      skipped_rows: 1,
    });
  });

  test("maps Fanpage rows to fb_page and Group rows to fb_group_csv", () => {
    expect(sourceTypeForCsvRow({ source: "Fanpage" })).toBe("fb_page");
    expect(sourceTypeForCsvRow({ source: "Group" })).toBe("fb_group_csv");
    expect(sourceTypeForCsvRow({ source: "Store" })).toBeNull();
  });

  test("rejects a CSV upload that contains no Fanpage or Group rows", () => {
    expect(() => validateFacebookCsvImport({ totalRows: 2, importableRows: 0, freshRows: 0 }))
      .toThrow(/khong co dong Fanpage hoac Group/i);
  });

  test("rejects a CSV upload when every Facebook row is already imported or duplicated", () => {
    expect(() => validateFacebookCsvImport({ totalRows: 4, importableRows: 3, freshRows: 0 }))
      .toThrow(/khong co comment Facebook moi/i);
  });

  test("detects the first and last comment date from Facebook rows", () => {
    const rows = [
      { source: "Fanpage", postPublished: "", postMessage: "", createdDate: "6/7/2026", commentMessage: "event", legacyTopic: null },
      { source: "Group", postPublished: "", postMessage: "", createdDate: "4/7/2026 08:30:00", commentMessage: "hack", legacyTopic: null },
      { source: "Group", postPublished: "", postMessage: "", createdDate: "bad date", commentMessage: "ignored", legacyTopic: null },
    ];

    expect(getCsvDateRange(rows)).toEqual({
      data_start_date: "2026-07-04",
      data_end_date: "2026-07-06",
    });
  });

  test("uses source and post context when identifying CSV posts and comments", () => {
    const base = {
      source: "Fanpage",
      postPublished: "6/7/2026 13:28",
      postMessage: "Ai cho minh xin 6 manh",
      createdDate: "6/7/2026 15:07",
      commentMessage: "Cho toi xin manh con voi",
      legacyTopic: null,
    };
    const sameCommentDifferentPost = {
      ...base,
      postPublished: "6/7/2026 12:56",
      postMessage: "Thay chua",
    };
    const sameTextFromGroup = { ...base, source: "Group" };

    expect(buildFacebookCsvPostExternalId(base)).toBe(buildFacebookCsvPostExternalId({ ...base, commentMessage: "comment khac" }));
    expect(buildFacebookCsvPostExternalId(base)).not.toBe(buildFacebookCsvPostExternalId(sameCommentDifferentPost));
    expect(buildFacebookCsvPostExternalId(base)).not.toBe(buildFacebookCsvPostExternalId(sameTextFromGroup));
    expect(buildFacebookCsvDedupeKey(base)).not.toBe(buildFacebookCsvDedupeKey(sameCommentDifferentPost));
    expect(buildFacebookCsvDedupeKey(base)).not.toBe(buildFacebookCsvDedupeKey(sameTextFromGroup));
  });
});
