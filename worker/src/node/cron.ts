// The three Cloudflare Cron Triggers, running inside the container's own process.
//
// On Workers the platform woke the worker up and called `scheduled()`, which dispatched
// on the cron string. A container has no such caller, so the schedules move in-process:
// same expressions, same job functions, same dispatch — just a different alarm clock.
//
// In-process rather than a system crontab or a separate scheduler container: the jobs
// are plain functions over `env`, so running them here needs no second copy of the
// config, no HTTP endpoint that would have to be protected, and no way for the two to
// drift out of sync.
import cron from "node-cron";
import {
  DAILY_INGEST_CRON,
  DAILY_SLOT_RESET_CRON,
  dailyJob,
  dailySlotResetJob,
  PROCESSING_SWEEP_CRON,
  sweepProcessingQueue,
} from "../index";
import type { Env } from "../types";

/** The slice of node-cron used here, injectable so the tests need no wall clock. */
export type ScheduleFn = (
  expression: string,
  handler: () => unknown,
  options?: { timezone?: string; noOverlap?: boolean; name?: string }
) => { stop: () => unknown };

export interface CronSchedules {
  stop(): void;
}

const SCHEDULE_OPTIONS = {
  // Cloudflare crons are UTC — "45 6 * * *" is 13:45 GMT+7 — while node-cron follows the
  // host clock. Without this a container on Asia/Ho_Chi_Minh would run the daily ingest
  // seven hours early, and nothing would look broken.
  timezone: "UTC",
  // The five-minute sweep can outlast its own interval on a large backlog. Overlapping
  // sweeps would both claim queue jobs and pay for the same LLM batches twice.
  noOverlap: true,
} as const;

export function startCronSchedules(
  env: Env,
  deps: { schedule?: ScheduleFn } = {}
): CronSchedules {
  const schedule = deps.schedule ?? (cron.schedule as unknown as ScheduleFn);

  const jobs: [string, string, (env: Env) => Promise<void>][] = [
    [DAILY_INGEST_CRON, "daily-ingest", dailyJob],
    [DAILY_SLOT_RESET_CRON, "daily-llm-slot-reset", dailySlotResetJob],
    [PROCESSING_SWEEP_CRON, "processing-sweep", sweepProcessingQueue],
  ];

  const tasks = jobs.map(([expression, name, job]) =>
    schedule(
      expression,
      async () => {
        // Each job already try/catches internally, so this is the backstop for anything
        // thrown before that: in a long-lived process an unhandled rejection is fatal,
        // whereas on Workers it only ended that one invocation.
        try {
          await job(env);
        } catch (e) {
          console.error(`cron job ${name} failed`, e);
        }
      },
      { ...SCHEDULE_OPTIONS, name }
    )
  );

  return {
    stop() {
      for (const task of tasks) task.stop();
    },
  };
}
