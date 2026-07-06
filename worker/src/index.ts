import { Hono } from "hono";
import { cors } from "hono/cors";
import { analyzeRoute } from "./routes/analyze";
import { commentsRoute } from "./routes/comments";
import { exportRoute } from "./routes/export";
import { ingestRoute } from "./routes/ingest";
import { insightsRoute } from "./routes/insights";
import { postsRoute } from "./routes/posts";
import { runsRoute } from "./routes/runs";
import { statsRoute } from "./routes/stats";
import { translateRoute } from "./routes/translate";
import { ingestFacebook } from "./services/facebook";
import { buildProvider } from "./services/llm/providers";
import { buildRunProcessingJobs, drainProcessingQueue, enqueueProcessingJobs } from "./services/processingQueue";
import { ingestSensorTower } from "./services/sensortower";
import { buildSensorTowerCatchupDates, seedSensorTowerCursor, upsertSensorTowerCursor } from "./services/sensortowerCursor";
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

app.use("*", cors());

app.get("/api/health", (c) => {
  const provider = buildProvider(c.env.LLM_PROVIDER, c.env.LLM_CLASSIFY_MODEL, {
    anthropicKey: c.env.ANTHROPIC_API_KEY,
    openaiKey: c.env.OPENAI_API_KEY,
    baseUrl: c.env.LLM_BASE_URL,
    llmViaxKey: c.env.LLM_VIAX_API_KEY,
    llmViaxBaseUrl: c.env.LLM_VIAX_BASE_URL,
  });
  return c.json({ status: "ok", llm_provider: c.env.LLM_PROVIDER, llm_ready: provider !== null, prompt_version: PROMPT_VERSION });
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
app.route("/api/analyze", analyzeRoute);
app.route("/api/comments", commentsRoute);
app.route("/api/runs", runsRoute);
app.route("/api/stats", statsRoute);
app.route("/api/insights", insightsRoute);
app.route("/api/posts", postsRoute);
app.route("/api/export", exportRoute);
app.route("/api/translate", translateRoute);

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailyJob(env));
  },
};

async function dailyJob(env: Env) {
  try {
    const cursor = await seedSensorTowerCursor(env);
    const dates = buildSensorTowerCatchupDates(cursor);
    for (const date of dates) {
      const run = await ingestSensorTower(env, date, date, undefined, { mode: "scheduled_cursor", cursor_key: "sensortower_store" });
      console.log(`sensortower: date=${date} status=${run.status} new=${run.rows_new}`);
      if (run.status !== "done") break;
      await upsertSensorTowerCursor(env, date, run.id);
      if (run.rows_new > 0) {
        await enqueueProcessingJobs(env, buildRunProcessingJobs(run.id, "scheduled-store"));
        await drainProcessingQueue(env);
      }
    }
  } catch (e) {
    console.error("sensortower scheduled ingest failed", e);
  }

  try {
    const run = await ingestFacebook(env);
    console.log(`facebook: status=${run.status} new=${run.rows_new}`);
    if (run.status === "done" && run.rows_new > 0) {
      await enqueueProcessingJobs(env, buildRunProcessingJobs(run.id, "scheduled-facebook"));
      await drainProcessingQueue(env);
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
