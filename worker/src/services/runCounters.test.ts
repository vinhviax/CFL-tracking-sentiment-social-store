import { describe, expect, test, vi } from "vitest";
import { loadQueueActivity, needsRecount, pickStaleRunIds, refreshRunCounts } from "./runCounters";

describe("needsRecount — when a cached snapshot can still be trusted", () => {
  const snapshot = { id: 7, counts_updated_at: "2026-09-03T10:00:00.000Z" };

  test("a run that has never been counted always recounts", () => {
    expect(needsRecount({ id: 7, counts_updated_at: null }, null)).toBe(true);
  });

  test("a finished run whose jobs all ended before the snapshot is left alone", () => {
    expect(needsRecount(snapshot, { active: false, last_touched_at: "2026-09-03T09:00:00.000Z" })).toBe(false);
  });

  test("a run with no processing jobs at all is left alone once counted", () => {
    // Store pulls that returned zero new rows never get a job; without this they would
    // recount on every single request, which is the cost this cache exists to remove.
    expect(needsRecount(snapshot, { active: false, last_touched_at: null })).toBe(false);
  });

  test("a run with work still queued, running or failed recounts", () => {
    expect(needsRecount(snapshot, { active: true, last_touched_at: "2026-09-03T09:00:00.000Z" })).toBe(true);
  });

  test("a job that finished after the snapshot recounts", () => {
    // The job ended, so `active` is false, but it wrote analyses after the snapshot was
    // taken. Every queue transition bumps processing_queue.updated_at, so comparing
    // against it catches exactly this case.
    expect(needsRecount(snapshot, { active: false, last_touched_at: "2026-09-03T10:00:01.000Z" })).toBe(true);
  });

  test("equal timestamps count as already covered, not stale", () => {
    expect(needsRecount(snapshot, { active: false, last_touched_at: snapshot.counts_updated_at })).toBe(false);
  });
});

describe("pickStaleRunIds", () => {
  test("returns only the runs that actually need work", () => {
    const rows = [
      { id: 1, counts_updated_at: "2026-09-03T10:00:00.000Z" },
      { id: 2, counts_updated_at: null },
      { id: 3, counts_updated_at: "2026-09-03T10:00:00.000Z" },
    ];
    const activity = new Map([
      [1, { active: false, last_touched_at: "2026-09-01T00:00:00.000Z" }],
      [3, { active: true, last_touched_at: "2026-09-03T11:00:00.000Z" }],
    ]);

    expect(pickStaleRunIds(rows, activity)).toEqual([2, 3]);
  });

  test("an all-fresh page costs no recounts", () => {
    const rows = [{ id: 1, counts_updated_at: "2026-09-03T10:00:00.000Z" }];
    const activity = new Map([[1, { active: false, last_touched_at: null }]]);

    expect(pickStaleRunIds(rows, activity)).toEqual([]);
  });
});

function fakeEnv(handlers: { sql: RegExp; rows?: any[]; first?: any }[]) {
  const runs: string[] = [];
  const DB = {
    prepare(sql: string) {
      const handler = handlers.find((h) => h.sql.test(sql));
      return {
        bind(...args: unknown[]) {
          return {
            async all() {
              return { results: handler?.rows ?? [] };
            },
            async first() {
              return handler?.first ?? null;
            },
            async run() {
              runs.push(`${sql}|${JSON.stringify(args)}`);
              return {};
            },
          };
        },
      };
    },
    batch: vi.fn(async () => []),
  };
  return { env: { DB } as any, runs };
}

describe("loadQueueActivity", () => {
  test("reads one small grouped row per run rather than per-run queries", async () => {
    const { env } = fakeEnv([
      {
        sql: /FROM processing_queue/,
        rows: [
          { run_id: 5, active: 1, last_touched_at: "2026-09-03T10:00:00.000Z" },
          { run_id: 6, active: 0, last_touched_at: "2026-09-02T10:00:00.000Z" },
        ],
      },
    ]);

    const activity = await loadQueueActivity(env);

    expect(activity.get(5)).toEqual({ active: true, last_touched_at: "2026-09-03T10:00:00.000Z" });
    expect(activity.get(6)).toEqual({ active: false, last_touched_at: "2026-09-02T10:00:00.000Z" });
    expect(activity.get(999)).toBeUndefined();
  });
});

describe("refreshRunCounts", () => {
  test("counts a run, keeps the date range unfiltered, and persists the snapshot", async () => {
    const { env, runs } = fakeEnv([
      {
        sql: /LEFT JOIN analyses/,
        first: { comment_count: 20, analyzed_count: 12, translated_zh_cn_count: 3 },
      },
      { sql: /MIN\(SUBSTR/, first: { data_start_date: "2026-07-27", data_end_date: "2026-08-11" } },
      { sql: /UPDATE ingest_runs/ },
    ]);

    const got = await refreshRunCounts(env, [133]);

    expect(got.get(133)).toMatchObject({
      comment_count: 20,
      analyzed_count: 12,
      translated_zh_cn_count: 3,
      data_start_date: "2026-07-27",
      data_end_date: "2026-08-11",
    });
    expect(got.get(133)?.counts_updated_at).toBeTruthy();
    expect(runs.some((sql) => sql.includes("UPDATE ingest_runs"))).toBe(true);
  });

  test("no stale runs means no queries at all", async () => {
    const { env, runs } = fakeEnv([]);
    expect((await refreshRunCounts(env, [])).size).toBe(0);
    expect(runs).toEqual([]);
  });
});
