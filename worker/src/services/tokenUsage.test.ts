import { describe, expect, test } from "vitest";
import {
  loadRunTokenUsage,
  loadTokenUsageByRange,
  mergeGroupsByShortModel,
  resolveUtcDayRange,
  sumTokenUsage,
} from "./tokenUsage";

/** Records the SQL/params it was asked to run and replays one canned result set. */
function fakeEnv(results: any[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            calls.push({ sql, params });
            return {
              async all() {
                return { results };
              },
            };
          },
        };
      },
    },
  } as any;
  return { env, calls };
}

describe("resolveUtcDayRange", () => {
  test("converts an inclusive Bangkok day range into half-open UTC bounds", () => {
    // 2026-07-01 00:00 +07 is 2026-06-30 17:00 UTC; `to` is inclusive so the upper
    // bound is the start of 2026-07-03 local.
    expect(resolveUtcDayRange("2026-07-01", "2026-07-02")).toEqual({
      start: "2026-06-30T17:00:00.000Z",
      end: "2026-07-02T17:00:00.000Z",
    });
  });

  test("keeps a single-day range one full local day wide", () => {
    const { start, end } = resolveUtcDayRange("2026-07-29", "2026-07-29");
    expect(new Date(end!).getTime() - new Date(start!).getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test("leaves an unspecified bound null instead of defaulting to now", () => {
    expect(resolveUtcDayRange(null, null)).toEqual({ start: null, end: null });
    expect(resolveUtcDayRange("2026-07-01", null).end).toBeNull();
  });

  test("treats an unparseable date as absent rather than emitting Invalid Date", () => {
    expect(resolveUtcDayRange("hom qua", "2026-07-02").start).toBeNull();
  });
});

describe("sumTokenUsage", () => {
  test("adds every field across groups", () => {
    expect(
      sumTokenUsage([
        { job_type: "analysis", model: "a", input_tokens: 10, output_tokens: 2, batches: 1, batches_with_usage: 1 },
        { job_type: "translation", model: "b", input_tokens: 5, output_tokens: 3, batches: 2, batches_with_usage: 1 },
      ])
    ).toEqual({ input_tokens: 15, output_tokens: 5, batches: 3, batches_with_usage: 2 });
  });

  test("returns zeros for no groups", () => {
    expect(sumTokenUsage([])).toEqual({ input_tokens: 0, output_tokens: 0, batches: 0, batches_with_usage: 0 });
  });
});

describe("loadRunTokenUsage", () => {
  test("groups by run, job type and model, joining through processing_queue.run_id", async () => {
    const { env, calls } = fakeEnv([
      { run_id: 99, job_type: "analysis", model: "m1", input_tokens: 1000, output_tokens: 200, batches: 4, batches_with_usage: 4 },
      { run_id: 99, job_type: "translation", model: "m2", input_tokens: 300, output_tokens: 80, batches: 2, batches_with_usage: 2 },
      { run_id: 97, job_type: "analysis", model: "m1", input_tokens: 50, output_tokens: 5, batches: 1, batches_with_usage: 0 },
    ]);

    const byRun = await loadRunTokenUsage(env, [99, 97]);

    expect(byRun.get(99)).toHaveLength(2);
    expect(byRun.get(97)?.[0].batches_with_usage).toBe(0);
    expect(calls[0].sql).toContain("JOIN processing_queue pq ON pq.id = pl.processing_job_id");
    // Only completed batches are billed; start/error rows carry no usage.
    expect(calls[0].sql).toContain("pl.level = 'success'");
    expect(calls[0].params).toEqual([99, 97]);
  });

  test("does not query at all for an empty or non-numeric run list", async () => {
    const { env, calls } = fakeEnv([]);
    expect(await loadRunTokenUsage(env, [])).toEqual(new Map());
    expect(await loadRunTokenUsage(env, [NaN])).toEqual(new Map());
    expect(calls).toHaveLength(0);
  });

  test("deduplicates repeated run ids", async () => {
    const { env, calls } = fakeEnv([]);
    await loadRunTokenUsage(env, [5, 5, 5]);
    expect(calls[0].params).toEqual([5]);
  });

  test("chunks lookups so a full page of runs stays under the D1 bind limit", async () => {
    const { env, calls } = fakeEnv([]);
    await loadRunTokenUsage(env, Array.from({ length: 200 }, (_, i) => i + 1));
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.params.length).toBeLessThanOrEqual(90);
  });
});

describe("loadTokenUsageByRange", () => {
  test("filters by converted UTC bounds and totals across models", async () => {
    const { env, calls } = fakeEnv([
      { job_type: "analysis", model: "terra", input_tokens: 1000, output_tokens: 400, batches: 3, batches_with_usage: 3 },
      { job_type: "translation", model: "flash", input_tokens: 200, output_tokens: 100, batches: 1, batches_with_usage: 1 },
    ]);

    const result = await loadTokenUsageByRange(env, { from: "2026-07-29", to: "2026-07-29" });

    expect(result.total).toEqual({ input_tokens: 1200, output_tokens: 500, batches: 4, batches_with_usage: 4 });
    expect(result.by_model.map((g) => g.model)).toEqual(["terra", "flash"]);
    expect(result.range).toEqual({ from: "2026-07-29", to: "2026-07-29" });
    expect(calls[0].params).toEqual(["2026-07-28T17:00:00.000Z", "2026-07-29T17:00:00.000Z"]);
  });

  test("omits the date predicates entirely when no range is given", async () => {
    const { env, calls } = fakeEnv([]);
    await loadTokenUsageByRange(env, {});
    expect(calls[0].sql).not.toContain("created_at");
    expect(calls[0].params).toEqual([]);
  });

  test("reads processing_logs directly so spend not tied to a run is still counted", async () => {
    const { env, calls } = fakeEnv([]);
    await loadTokenUsageByRange(env, { from: "2026-07-01", to: "2026-07-02" });
    expect(calls[0].sql).not.toContain("processing_queue");
  });
});

describe("mergeGroupsByShortModel", () => {
  test("collapses the same model logged under different routing prefixes into one row", () => {
    // Real production data: the provider refactor moved off the "codex-lb/" prefix, so
    // the same model exists under two ids. Displayed prefix-stripped, they rendered as
    // two identical "gpt-5.6-terra" rows in the token table.
    const merged = mergeGroupsByShortModel([
      { job_type: "analysis", model: "gpt-5.6-terra", input_tokens: 15026259, output_tokens: 4987214, batches: 3042, batches_with_usage: 3042 },
      { job_type: "analysis", model: "codex-lb/gpt-5.6-terra", input_tokens: 0, output_tokens: 0, batches: 671, batches_with_usage: 0 },
    ]);
    expect(merged).toEqual([
      { job_type: "analysis", model: "gpt-5.6-terra", input_tokens: 15026259, output_tokens: 4987214, batches: 3713, batches_with_usage: 3042 },
    ]);
  });

  test("keeps genuinely different models apart, and does not merge across job types", () => {
    const merged = mergeGroupsByShortModel([
      { job_type: "analysis", model: "codex-lb/gpt-5.4", input_tokens: 0, output_tokens: 0, batches: 603, batches_with_usage: 0 },
      { job_type: "analysis", model: "gpt-5.6-terra", input_tokens: 10, output_tokens: 5, batches: 1, batches_with_usage: 1 },
      { job_type: "translation", model: "gpt-5.6-terra", input_tokens: 7, output_tokens: 3, batches: 1, batches_with_usage: 1 },
    ]);
    expect(merged.map((g) => `${g.job_type}|${g.model}`).sort()).toEqual([
      "analysis|gpt-5.4",
      "analysis|gpt-5.6-terra",
      "translation|gpt-5.6-terra",
    ]);
  });

  test("orders the merged rows by total spend, biggest first", () => {
    const merged = mergeGroupsByShortModel([
      { job_type: "translation", model: "a/small", input_tokens: 1, output_tokens: 1, batches: 1, batches_with_usage: 1 },
      { job_type: "analysis", model: "b/big", input_tokens: 100, output_tokens: 100, batches: 1, batches_with_usage: 1 },
    ]);
    expect(merged[0].model).toBe("big");
  });
});
