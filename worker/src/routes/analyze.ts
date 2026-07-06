import { Hono } from "hono";
import type { Env } from "../types";
import { getProgress } from "../services/analysis";
import { drainProcessingQueue, enqueueProcessingJobs } from "../services/processingQueue";

export const analyzeRoute = new Hono<{ Bindings: Env }>();

analyzeRoute.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const commentIds: number[] | undefined = body.comment_ids;
  const runId: number | undefined = body.run_id;

  const progressKey = runId ? `run-${runId}` : `adhoc-${Date.now()}`;

  await enqueueProcessingJobs(c.env, [
    {
      job_type: "analysis",
      ...(runId != null ? { run_id: runId } : {}),
      ...(commentIds?.length ? { comment_ids: commentIds } : {}),
      progress_key: progressKey,
    },
  ]);

  c.executionCtx.waitUntil(
    drainProcessingQueue(c.env)
      .catch((e) => console.error(`analysis queue failed for ${progressKey}`, e))
  );

  return c.json({ progress_key: progressKey, status: "queued" });
});

analyzeRoute.get("/progress/:key", async (c) => {
  const progress = await getProgress(c.env, c.req.param("key"));
  const status = (progress as any)?.status;
  if (!["done", "failed", "cancelled"].includes(status)) {
    c.executionCtx.waitUntil(
      drainProcessingQueue(c.env)
        .catch((e) => console.error(`analysis queue failed while polling ${c.req.param("key")}`, e))
    );
  }
  return c.json(progress);
});
