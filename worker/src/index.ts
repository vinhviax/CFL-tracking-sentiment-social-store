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
import { runAnalysis } from "./services/analysis";
import { ingestFacebook } from "./services/facebook";
import { buildProvider } from "./services/llm/providers";
import { ingestSensorTower } from "./services/sensortower";
import { PROMPT_VERSION, SENTIMENT_LABELS_VI, TOPIC_LABELS_VI, URGENCIES } from "./taxonomy";
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
  c.json({ topics: TOPIC_LABELS_VI, sentiments: SENTIMENT_LABELS_VI, urgencies: URGENCIES, prompt_version: PROMPT_VERSION })
);

app.route("/api/ingest", ingestRoute);
app.route("/api/analyze", analyzeRoute);
app.route("/api/comments", commentsRoute);
app.route("/api/runs", runsRoute);
app.route("/api/stats", statsRoute);
app.route("/api/insights", insightsRoute);
app.route("/api/posts", postsRoute);
app.route("/api/export", exportRoute);

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailyJob(env));
  },
};

async function dailyJob(env: Env) {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10); // small overlap, dedupe handles it

  try {
    const run = await ingestSensorTower(env, start, end);
    console.log(`sensortower: status=${run.status} new=${run.rows_new}`);
  } catch (e) {
    console.error("sensortower scheduled ingest failed", e);
  }

  try {
    const run = await ingestFacebook(env);
    console.log(`facebook: status=${run.status} new=${run.rows_new}`);
  } catch (e) {
    console.error("facebook scheduled ingest failed", e);
  }

  try {
    const result = await runAnalysis(env, { progressKey: "scheduled" });
    console.log(`analysis: ${JSON.stringify(result)}`);
  } catch (e) {
    console.error("scheduled analysis failed", e);
  }
}
