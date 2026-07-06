import { Hono } from "hono";
import type { Env } from "../types";
import { getProgress, runAnalysis } from "../services/analysis";
import { discoverAndStoreRunMemory } from "../services/taxonomyMemory";

export const analyzeRoute = new Hono<{ Bindings: Env }>();

analyzeRoute.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const commentIds: number[] | undefined = body.comment_ids;
  const runId: number | undefined = body.run_id;

  const progressKey = runId ? `run-${runId}` : `adhoc-${Date.now()}`;

  // Background: continue processing after the response is sent.
  c.executionCtx.waitUntil(
    runAnalysis(c.env, { commentIds, runId, progressKey })
      .then(() => runId ? discoverAndStoreRunMemory(c.env, { runId }) : null)
  );

  return c.json({ progress_key: progressKey, status: "queued" });
});

analyzeRoute.get("/progress/:key", async (c) => {
  const progress = await getProgress(c.env, c.req.param("key"));
  return c.json(progress);
});
