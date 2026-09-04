import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dailyJob: vi.fn(),
  dailySlotResetJob: vi.fn(),
  sweepProcessingQueue: vi.fn(),
}));

// Only the three job functions are stubbed; the cron strings come from the real index.ts
// so a change there cannot leave this scheduler behind.
vi.mock("../index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../index")>()),
  dailyJob: mocks.dailyJob,
  dailySlotResetJob: mocks.dailySlotResetJob,
  sweepProcessingQueue: mocks.sweepProcessingQueue,
}));

import { DAILY_INGEST_CRON, DAILY_SLOT_RESET_CRON, PROCESSING_SWEEP_CRON } from "../index";
import { startCronSchedules, type ScheduleFn } from "./cron";

interface Registered {
  expression: string;
  handler: () => unknown;
  options: any;
}

function fakeScheduler() {
  const registered: Registered[] = [];
  const stopped: string[] = [];
  const schedule: ScheduleFn = (expression, handler, options) => {
    registered.push({ expression, handler: handler as () => unknown, options });
    return { stop: () => void stopped.push(expression) } as any;
  };
  return { registered, stopped, schedule };
}

const env = { DB: {} } as any;

describe("startCronSchedules", () => {
  beforeEach(() => vi.clearAllMocks());

  test("registers exactly the three schedules wrangler.jsonc declares", () => {
    const config = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const declared: string[] = JSON.parse(
      config.replace(/^\s*\/\/.*$/gm, "").match(/"crons":\s*(\[[^\]]*\])/)![1]
    );
    const { registered, schedule } = fakeScheduler();

    startCronSchedules(env, { schedule });

    expect(registered.map((r) => r.expression)).toEqual(declared);
    expect(declared).toEqual([DAILY_INGEST_CRON, DAILY_SLOT_RESET_CRON, PROCESSING_SWEEP_CRON]);
  });

  test("runs every schedule in UTC, because the Cloudflare crons were written in UTC", () => {
    // 45 6 * * * means 13:45 GMT+7. node-cron defaults to the host clock, so a container
    // in Asia/Ho_Chi_Minh would silently fire the daily ingest seven hours early.
    const { registered, schedule } = fakeScheduler();

    startCronSchedules(env, { schedule });

    for (const entry of registered) expect(entry.options?.timezone).toBe("UTC");
  });

  test("asks node-cron not to overlap a schedule with its own previous run", () => {
    // A sweep can take longer than five minutes on a big backlog. Two sweeps at once
    // would each claim queue jobs and pay for the same LLM batches twice.
    const { registered, schedule } = fakeScheduler();

    startCronSchedules(env, { schedule });

    for (const entry of registered) expect(entry.options?.noOverlap).toBe(true);
  });

  test("each expression triggers its own job and nothing else", async () => {
    const { registered, schedule } = fakeScheduler();
    startCronSchedules(env, { schedule });
    const byExpression = new Map(registered.map((r) => [r.expression, r.handler]));

    await byExpression.get(DAILY_INGEST_CRON)!();
    expect(mocks.dailyJob).toHaveBeenCalledWith(env);
    expect(mocks.dailySlotResetJob).not.toHaveBeenCalled();
    expect(mocks.sweepProcessingQueue).not.toHaveBeenCalled();

    await byExpression.get(DAILY_SLOT_RESET_CRON)!();
    expect(mocks.dailySlotResetJob).toHaveBeenCalledWith(env);

    await byExpression.get(PROCESSING_SWEEP_CRON)!();
    expect(mocks.sweepProcessingQueue).toHaveBeenCalledWith(env);
    expect(mocks.dailyJob).toHaveBeenCalledTimes(1);
  });

  test("a throwing job is logged, not left to crash the process", async () => {
    // On Workers a failed scheduled() invocation died alone. Here the same rejection
    // would be an unhandled rejection inside a long-lived process.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.sweepProcessingQueue.mockRejectedValueOnce(new Error("sweep boom"));
      const { registered, schedule } = fakeScheduler();
      startCronSchedules(env, { schedule });
      const sweep = registered.find((r) => r.expression === PROCESSING_SWEEP_CRON)!;

      await expect(sweep.handler()).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("node-cron itself accepts all three expressions", async () => {
    // The scheduler is a different parser from Cloudflare's. An expression it rejects
    // would mean a job that simply never runs, with nothing at request time to notice.
    const cron = await import("node-cron");
    for (const expression of [DAILY_INGEST_CRON, DAILY_SLOT_RESET_CRON, PROCESSING_SWEEP_CRON]) {
      expect(cron.validate(expression), expression).toBe(true);
    }
  });

  test("stop() stops every schedule it started", () => {
    const { registered, stopped, schedule } = fakeScheduler();

    startCronSchedules(env, { schedule }).stop();

    expect(stopped).toEqual(registered.map((r) => r.expression));
  });
});
