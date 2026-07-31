import { Hono } from "hono";
import { cors } from "hono/cors";
import { adminRoute } from "./routes/admin";
import { analyzeRoute } from "./routes/analyze";
import { commentsRoute } from "./routes/comments";
import { exportRoute } from "./routes/export";
import { gameModesRoute } from "./routes/gameModes";
import { ingestRoute } from "./routes/ingest";
import { insightsRoute } from "./routes/insights";
import { llmConfigRoute } from "./routes/llmConfig";
import { postsRoute } from "./routes/posts";
import { processingRoute } from "./routes/processing";
import { reportRoute } from "./routes/report";
import { runsRoute } from "./routes/runs";
import { statsRoute } from "./routes/stats";
import { translateRoute } from "./routes/translate";
import { ADMIN_HEADER, requireAdmin } from "./services/adminAuth";
import { ingestFacebook } from "./services/facebook";
import { describeSlotResolution } from "./services/llmAgentConfig";
import { BYO_HEADER } from "./services/llmCatalog";
import { resetAllSlotsForNewDay } from "./services/llmSlotState";
import {
  buildRunProcessingJobs,
  drainProcessingQueue,
  enqueueProcessingJobs,
  recoverStaleProcessingJobs,
  retryFailedProcessingJobs,
} from "./services/processingQueue";
import { ingestSensorTower } from "./services/sensortower";
import {
  addDays,
  buildCursorCatchupRange,
  FACEBOOK_CURSOR_KEY,
  seedSourceCursor,
  SENSOR_TOWER_CURSOR_KEY,
  upsertSourceCursor,
} from "./services/sensortowerCursor";
import {
  PROMPT_VERSION,
  SENTIMENT_LABELS_VI,
  SENTIMENT_LABELS_ZH_CN,
  TOPIC_LABELS_VI,
  TOPIC_LABELS_ZH_CN,
  URGENCIES,
} from "./taxonomy";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// Pages is a different origin, so the browser's own-provider header has to be
// allow-listed explicitly — the default allowed set does not include it.
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", BYO_HEADER, ADMIN_HEADER] }));

// The write side of Ingest & Cài đặt, behind the shared admin password. Reads fall
// straight through (see adminAuth.ts), so a viewer still gets every panel, every
// progress poll, and the queue drain those polls perform. Everything outside this
// list — comments, insights, stats, export — stays open on purpose: the lock covers
// the Ingest tab only.
app.use("/api/ingest/*", requireAdmin);
app.use("/api/llm-config/*", requireAdmin);
app.use("/api/analyze/*", requireAdmin);
app.use("/api/translate/*", requireAdmin);
app.use("/api/runs/*", requireAdmin);
app.use("/api/processing/*", requireAdmin);

app.get("/api/health", async (c) => {
  // Reports both slots, which is what the pipeline actually uses, instead of the
  // raw LLM_PROVIDER var it used to read. Booleans only — no endpoint, no key.
  const [reasoning, simple] = await Promise.all([
    describeSlotResolution(c.env, "reasoning"),
    describeSlotResolution(c.env, "simple"),
  ]);
  return c.json({
    status: "ok",
    llm_provider: reasoning.provider,
    llm_provider_label: reasoning.provider_label,
    llm_model: reasoning.model,
    llm_ready: reasoning.ready,
    llm_slots: { reasoning, simple },
    prompt_version: PROMPT_VERSION,
  });
});

app.get("/api/meta", (c) =>
  c.json({
    topics: TOPIC_LABELS_VI,
    topics_zh_cn: TOPIC_LABELS_ZH_CN,
    sentiments: SENTIMENT_LABELS_VI,
    sentiments_zh_cn: SENTIMENT_LABELS_ZH_CN,
    urgencies: URGENCIES,
    prompt_version: PROMPT_VERSION,
  })
);

app.route("/api/admin", adminRoute);
app.route("/api/ingest", ingestRoute);
app.route("/api/llm-config", llmConfigRoute);
app.route("/api/analyze", analyzeRoute);
app.route("/api/comments", commentsRoute);
app.route("/api/runs", runsRoute);
app.route("/api/stats", statsRoute);
app.route("/api/insights", insightsRoute);
app.route("/api/posts", postsRoute);
app.route("/api/export", exportRoute);
app.route("/api/game-modes", gameModesRoute);
app.route("/api/report", reportRoute);
app.route("/api/translate", translateRoute);
app.route("/api/processing", processingRoute);

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Three schedules share this handler, dispatched by exact cron string: the daily
    // ingest, the daily LLM slot reset, and a five-minute sweep that only keeps the
    // processing queue moving. The sweep must not re-run either daily job.
    if (event.cron === DAILY_INGEST_CRON) {
      ctx.waitUntil(dailyJob(env));
      return;
    }
    if (event.cron === DAILY_SLOT_RESET_CRON) {
      ctx.waitUntil(dailySlotResetJob(env));
      return;
    }
    ctx.waitUntil(sweepProcessingQueue(env));
  },
};

export const DAILY_INGEST_CRON = "45 6 * * *";
/** 14:00 GMT+7, 15 minutes after the ingest, so a long ingest does not overlap it. */
export const DAILY_SLOT_RESET_CRON = "0 7 * * *";

/**
 * Give both LLM slots a fresh day.
 *
 * A slot that exhausted its primary and secondary provider stops attempting anything
 * for the rest of the day (see llmSlotState.ts), which is what stops a dead provider
 * from being hammered every five minutes. That state has to be cleared by something,
 * and it is this: reset both slots to their primary tier, then re-enqueue the pending
 * work so whatever was left unanalysed/untranslated gets another full pass.
 */
export async function dailySlotResetJob(env: Env) {
  try {
    await resetAllSlotsForNewDay(env);
    const suffix = new Date().toISOString().slice(0, 10);
    await enqueueProcessingJobs(env, [
      { job_type: "analysis", progress_key: `daily-retry-analyze-${suffix}` },
      { job_type: "translation", progress_key: `daily-retry-translate-${suffix}`, locale: "zh-CN", limit: 1000 },
    ]);
    await drainProcessingQueue(env);
  } catch (e) {
    console.error("daily llm slot reset failed", e);
  }
}

/**
 * Return abandoned and retryable jobs to the queue, then drain.
 *
 * This is what makes a long run finish on its own. Draining used to happen only inside
 * requests the browser made, so closing the Ingest tab left the remainder of a run
 * unprocessed until someone opened it again.
 */
export async function sweepProcessingQueue(env: Env) {
  try {
    await recoverStaleProcessingJobs(env);
    const retried = await retryFailedProcessingJobs(env);
    if (retried) console.log(`processing sweep: requeued ${retried} failed job(s)`);
    await drainProcessingQueue(env);
  } catch (e) {
    console.error("processing queue sweep failed", e);
  }
}

export async function dailyJob(env: Env) {
  try {
    const cursor = await seedSourceCursor(env, { key: SENSOR_TOWER_CURSOR_KEY, sourceType: "store" });
    const range = buildCursorCatchupRange(cursor);
    if (range) {
      const run = await ingestSensorTower(env, range.startDate, range.endDate, undefined, {
        mode: "scheduled_cursor",
        cursor_key: SENSOR_TOWER_CURSOR_KEY,
        start_date: range.startDate,
        end_date: range.endDate,
      });
      console.log(`sensortower: range=${range.startDate}..${range.endDate} status=${run.status} new=${run.rows_new}`);
      if (run.status !== "done") throw new Error(run.error || "Sensor Tower scheduled ingest failed");
      await upsertSourceCursor(env, SENSOR_TOWER_CURSOR_KEY, range.endDate, run.id);
      if (run.rows_new > 0) {
        await enqueueProcessingJobs(env, buildRunProcessingJobs(run.id, "scheduled-store"));
        await drainProcessingQueue(env);
      }
    }
  } catch (e) {
    console.error("sensortower scheduled ingest failed", e);
  }

  try {
    const cursor = await seedSourceCursor(env, { key: FACEBOOK_CURSOR_KEY, sourceType: "fb_page" });
    const range = buildCursorCatchupRange(cursor);
    if (range) {
      const run = await ingestFacebook(env, range.startDate, addDays(range.endDate, 1), 50, {
        mode: "scheduled_cursor",
        cursor_key: FACEBOOK_CURSOR_KEY,
        start_date: range.startDate,
        end_date: range.endDate,
        post_limit: 50,
      });
      console.log(`facebook: range=${range.startDate}..${range.endDate} status=${run.status} new=${run.rows_new}`);
      if (run.status !== "done") throw new Error(run.error || "Facebook scheduled ingest failed");
      await upsertSourceCursor(env, FACEBOOK_CURSOR_KEY, range.endDate, run.id);
      if (run.rows_new > 0) {
        await enqueueProcessingJobs(env, buildRunProcessingJobs(run.id, "scheduled-facebook"));
        await drainProcessingQueue(env);
      }
    }
  } catch (e) {
    console.error("facebook scheduled ingest failed", e);
  }

  try {
    const suffix = new Date().toISOString().slice(0, 10);
    await enqueueProcessingJobs(env, [
      { job_type: "analysis", progress_key: `scheduled-pending-analyze-${suffix}` },
      { job_type: "translation", progress_key: `scheduled-pending-translate-${suffix}`, locale: "zh-CN", limit: 1000 },
    ]);
    await drainProcessingQueue(env);
  } catch (e) {
    console.error("scheduled pending analysis/translation failed", e);
  }
}
