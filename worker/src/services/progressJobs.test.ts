import { describe, expect, test } from "vitest";
import { getProgressJob } from "./progressJobs";

function envReturning(row: any) {
  const calls: { sql: string; args: any[] }[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            calls.push({ sql, args });
            return this;
          },
          async first() {
            return row;
          },
        };
      },
    },
  } as any;
  return { env, calls };
}

describe("getProgressJob", () => {
  test("reports the queue state alongside the counts", async () => {
    // The UI cannot tell a job that is merely waiting its turn from one that is
    // working without these: both have done=0, total=0 and no logs.
    const { env, calls } = envReturning({
      status: "queued",
      done: 0,
      total: 0,
      provider: null,
      error: null,
      queue_status: "queued",
      queue_started_at: null,
      queue_ahead: 3,
    });

    const progress = await getProgressJob(env, "run-99");

    expect(calls[0].args).toEqual(["run-99"]);
    expect(calls[0].sql).toContain("LEFT JOIN processing_queue q");
    expect(progress).toEqual({
      status: "queued",
      done: 0,
      total: 0,
      provider: null,
      error: null,
      queue_status: "queued",
      queue_started_at: null,
      queue_ahead: 3,
    });
  });

  test("a claimed job carries its start time, which is what marks it as resumed rather than new", async () => {
    const { env } = envReturning({
      status: "running",
      done: 150,
      total: 400,
      provider: "openai_viax",
      error: null,
      queue_status: "running",
      queue_started_at: "2026-07-30T01:10:42.360Z",
      queue_ahead: null,
    });

    const progress = await getProgressJob(env, "run-47");

    expect(progress.queue_started_at).toBe("2026-07-30T01:10:42.360Z");
    expect(progress.queue_ahead).toBeNull();
    expect(progress.done).toBe(150);
  });

  test("an unknown key stays the old shape so polling can give up on it", async () => {
    const { env } = envReturning(null);
    expect(await getProgressJob(env, "nope")).toEqual({ status: "unknown", done: 0, total: 0 });
  });
});
