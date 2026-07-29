import { Hono } from "hono";
import { cors } from "hono/cors";
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
import { ingestFacebook } from "./services/facebook";
import { describeSlotResolution } from "./services/llmAgentConfig";
import { BYO_HEADER } from "./services/llmCatalog";
import { buildRunProcessingJobs, drainProcessingQueue, enqueueProcessingJobs } from "./services/processingQueue";
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
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", BYO_HEADER] }));

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

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailyJob(env));
  },
};

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
