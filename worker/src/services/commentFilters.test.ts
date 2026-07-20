import { describe, expect, test } from "vitest";
import { buildCommentFilters } from "./commentFilters";

describe("buildCommentFilters", () => {
  test("maps store group to the store source_type", () => {
    const { where } = buildCommentFilters({ group: "store" });
    expect(where).toContain("c.source_type = 'store'");
  });

  test("maps facebook group to both facebook source types", () => {
    const { where } = buildCommentFilters({ group: "facebook" });
    expect(where).toContain("c.source_type IN ('fb_page','fb_group_csv')");
  });

  test("applies store subtab, date range and sentiment together", () => {
    const { where, params } = buildCommentFilters({
      group: "store",
      store: "gp",
      from: "2026-07-01",
      to: "2026-07-15",
      sentiment: "negative",
    });
    expect(where).toContain("c.store = ?");
    expect(where.some((clause) => clause.includes("substr(c.created_at, 1, 10) >="))).toBe(true);
    expect(where.some((clause) => clause.includes("substr(c.created_at, 1, 10) <="))).toBe(true);
    expect(where).toContain("a.sentiment = ?");
    expect(params).toEqual(expect.arrayContaining(["gp", "2026-07-01", "2026-07-15", "negative"]));
  });

  test("ignores malformed date values", () => {
    const { where } = buildCommentFilters({ from: "not-a-date" });
    expect(where.some((clause) => clause.includes("substr(c.created_at"))).toBe(false);
  });

  test("returns an error for an empty subtopic filter", () => {
    const { error } = buildCommentFilters({ subtopic: " , ," });
    expect(error).toBe("Invalid subtopic filter");
  });

  test("maps a sources list into a source_type IN clause", () => {
    const { where, params } = buildCommentFilters({ sources: "store,fb_page" });
    expect(where.some((clause) => clause.includes("c.source_type IN (?,?)"))).toBe(true);
    expect(params).toEqual(expect.arrayContaining(["store", "fb_page"]));
  });

  test("drops unknown source types from a sources list", () => {
    const { where, params } = buildCommentFilters({ sources: "store,evil_source" });
    expect(where.some((clause) => clause.includes("c.source_type IN (?)"))).toBe(true);
    expect(params).toContain("store");
    expect(params).not.toContain("evil_source");
  });

  test("expands a valid subtopic filter into an EXISTS clause", () => {
    const { where, params } = buildCommentFilters({ subtopic: "lag_fps:drop_fps" });
    expect(where.some((clause) => clause.includes("comment_subtopics"))).toBe(true);
    expect(params).toContain("lag_fps:drop_fps");
  });
});
