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
  validateFacebookCsvSize,
  getCsvCommentInsertChunkSize,
  getCsvPostInsertChunkSize,
  getCsvMaxImportableRows,
  loadExistingCsvHashes,
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

/** Minimal D1 stub that records the SQL it was asked to run and replays canned pages. */
function fakeDbReturning(pages: { id: number; dedupe_hash: string }[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let call = 0;
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return {
            async all() {
              return { results: pages[call++] ?? [] };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Parameters<typeof loadExistingCsvHashes>[0], calls };
}

describe("loadExistingCsvHashes", () => {
  test("reads the upload's date window once instead of one lookup per row", async () => {
    const { db, calls } = fakeDbReturning([[{ id: 7, dedupe_hash: "stored-a" }, { id: 9, dedupe_hash: "stored-b" }]]);

    const existing = await loadExistingCsvHashes(db, { data_start_date: "2026-06-29", data_end_date: "2026-07-23" });

    expect(existing).toEqual(new Set(["stored-a", "stored-b"]));
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("source_type IN (?,?)");
    // NULL created_at cannot be range-filtered, so those rows must stay in scope.
    expect(calls[0].sql).toContain("created_at IS NULL");
    // Window is padded a day either side to absorb the Bangkok-vs-UTC storage skew.
    expect(calls[0].params).toEqual(["fb_page", "fb_group_csv", "2026-06-28T00:00:00", "2026-07-25T00:00:00", 0]);
  });

  test("keeps paging while a page comes back full, resuming after the last id", async () => {
    const fullPage = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, dedupe_hash: `h${i}` }));
    const { db, calls } = fakeDbReturning([fullPage, [{ id: 5001, dedupe_hash: "tail" }]]);

    const existing = await loadExistingCsvHashes(db, { data_start_date: "2026-07-01", data_end_date: "2026-07-02" });

    expect(existing.size).toBe(5001);
    expect(existing.has("tail")).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].params.at(-1)).toBe(5000);
  });

  test("scans every Facebook comment when no row carried a parseable date", async () => {
    const { db, calls } = fakeDbReturning([[]]);

    await loadExistingCsvHashes(db, { data_start_date: null, data_end_date: null });

    expect(calls[0].sql).not.toContain("created_at");
    expect(calls[0].params).toEqual(["fb_page", "fb_group_csv", 0]);
  });
});

describe("Facebook CSV guardrails", () => {
  test("keeps CSV insert batches large enough to avoid Worker subrequest limits", () => {
    expect(getCsvPostInsertChunkSize()).toBeGreaterThanOrEqual(50);
    expect(getCsvCommentInsertChunkSize()).toBeGreaterThanOrEqual(250);
  });

  test("keeps the whole upload inside one Worker's 1000 subrequest budget", () => {
    // Worst case: every row is new and every row is its own post. Lookups no longer
    // scale with the file (loadExistingCsvHashes / loadCsvPostIds page instead), so only
    // the inserts grow — but they still have to fit, or a big upload dies mid-ingest.
    const rows = getCsvMaxImportableRows();
    const commentBatches = Math.ceil(rows / getCsvCommentInsertChunkSize());
    const postBatches = Math.ceil(rows / getCsvPostInsertChunkSize());
    const pagedLookups = Math.ceil(rows / 5000) + 2;
    expect(commentBatches + postBatches + pagedLookups).toBeLessThan(900);
  });

  test("rejects an upload too large for one Worker invocation with a split-the-file hint", () => {
    expect(() => validateFacebookCsvSize(getCsvMaxImportableRows())).not.toThrow();
    expect(() => validateFacebookCsvSize(getCsvMaxImportableRows() + 1)).toThrow(/chia file thanh nhieu phan/i);
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
