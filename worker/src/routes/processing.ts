import { Hono } from "hono";
import type { Env } from "../types";
import { listProcessingJobLogs } from "../services/processingLogs";
import { cancelProcessingJob, drainProcessingQueue, listProcessingJobs } from "../services/processingQueue";
import { BYO_HEADER, parseByoHeader } from "../services/llmCatalog";

export const processingRoute = new Hono<{ Bindings: Env }>();

processingRoute.get("/jobs", async (c) => {
  const byo = parseByoHeader(c.req.header(BYO_HEADER));
  const limit = Math.max(1, Number(c.req.query("limit")) || 20);
  const jobs = await listProcessingJobs(c.env, { limit });
  c.executionCtx.waitUntil(
    drainProcessingQueue(c.env, undefined, undefined, { byo })
      .catch((e) => console.error("processing queue drain failed while listing jobs", e))
  );
  return c.json(jobs);
});

processingRoute.get("/jobs/:id/logs", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) return c.json({ detail: "Invalid processing job id" }, 400);
  const limit = Math.max(1, Math.min(Number(c.req.query("limit")) || 20, 100));
  const logs = await listProcessingJobLogs(c.env, id, { limit });
  return c.json(logs);
});

processingRoute.post("/jobs/:id/cancel", async (c) => {
  const byo = parseByoHeader(c.req.header(BYO_HEADER));
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) return c.json({ detail: "Invalid processing job id" }, 400);

  const cancelled = await cancelProcessingJob(c.env, id);
  if (!cancelled) return c.json({ detail: "Processing job not found or already finished" }, 404);

  // Cancelling one job lets the rest of the queue move, so carry the caller's
  // provider here too rather than leaving this the one drain that ignores it.
  c.executionCtx.waitUntil(
    drainProcessingQueue(c.env, undefined, undefined, { byo })
      .catch((e) => console.error("processing queue drain failed after cancelling job", e))
  );
  return c.json(cancelled);
});
