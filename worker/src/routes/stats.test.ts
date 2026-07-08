import { describe, expect, test } from "vitest";
import { buildTrendSeries, computeOverview } from "./stats";
import { summarizeStoreBreakdown } from "../services/storeStats";

describe("buildTrendSeries", () => {
  test("fills missing days inside the selected date range", () => {
    const got = buildTrendSeries(
      [
        { d: "2026-07-06", sentiment: "negative", n: 4 },
        { d: "2026-07-06", sentiment: "positive", n: 1 },
      ],
      { from: "2026-07-04", to: "2026-07-07" }
    );

    expect(got).toEqual([
      { date: "2026-07-04", negative: 0, neutral: 0, positive: 0 },
      { date: "2026-07-05", negative: 0, neutral: 0, positive: 0 },
      { date: "2026-07-06", negative: 4, neutral: 0, positive: 1 },
      { date: "2026-07-07", negative: 0, neutral: 0, positive: 0 },
    ]);
  });
});

describe("computeOverview", () => {
  test("scopes overview totals and sentiment to the selected main topic", async () => {
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const record = { sql, params: [] as unknown[] };
        prepared.push(record);
        const stmt = {
          bind(...params: unknown[]) {
            record.params = params;
            return stmt;
          },
          async first() {
            return { n: 2 };
          },
          async all() {
            if (sql.includes("SELECT a.sentiment")) {
              return { results: [{ sentiment: "negative", n: 2 }] };
            }
            if (sql.includes("SELECT a.topic_main, COUNT(*) as negative")) {
              return { results: [{ topic_main: "hack_cheat", negative: 2, urgent: 1 }] };
            }
            if (sql.includes("SELECT a.topic_main, COUNT(*) as n")) {
              return { results: [{ topic_main: "hack_cheat", n: 2 }] };
            }
            return { results: [] };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    const got = await computeOverview(db, { group: "facebook", topic: "hack_cheat", lang: "vi" });

    expect(got.total_comments).toBe(2);
    expect(got.sentiment.negative).toBe(2);
    expect(prepared[0].sql).toContain("JOIN analyses a ON a.comment_id = c.id");
    expect(prepared[0].sql).toContain("a.topic_main = ?");
    expect(prepared[0].params).toContain("hack_cheat");
    expect(prepared[1].sql).toContain("a.topic_main = ?");
    expect(prepared[1].params).toContain("hack_cheat");
  });

  test("excludes other from main top topics and hot issues", async () => {
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            if (sql.includes("COUNT(*) as n FROM comments c JOIN analyses")) return { n: 5 };
            return { n: 5 };
          },
          async all() {
            if (sql.includes("SELECT a.sentiment")) {
              return {
                results: [
                  { sentiment: "negative", n: 4 },
                  { sentiment: "positive", n: 1 },
                ],
              };
            }
            if (sql.includes("SELECT a.topic_main, COUNT(*) as negative")) {
              return {
                results: [
                  { topic_main: "other", negative: 3, urgent: 3 },
                  { topic_main: "lag_fps", negative: 2, urgent: 1 },
                ],
              };
            }
            if (sql.includes("SELECT a.topic_main, COUNT(*) as n")) {
              return {
                results: [
                  { topic_main: "other", n: 3 },
                  { topic_main: "lag_fps", n: 2 },
                  { topic_main: "positive_feedback", n: 1 },
                ],
              };
            }
            return { results: [] };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    const got = await computeOverview(db, { lang: "vi" });

    expect(got.top_topics.map((topic) => topic.topic)).toEqual(["lag_fps", "positive_feedback"]);
    expect(got.hot_issues.map((issue) => issue.topic)).toEqual(["lag_fps"]);
  });
});

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
