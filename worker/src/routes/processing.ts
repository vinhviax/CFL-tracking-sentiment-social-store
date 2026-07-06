import { Hono } from "hono";
import type { Env } from "../types";
import { cancelProcessingJob, drainProcessingQueue, listProcessingJobs } from "../services/processingQueue";

export const processingRoute = new Hono<{ Bindings: Env }>();

processingRoute.get("/jobs", async (c) => {
  const limit = Math.max(1, Number(c.req.query("limit")) || 20);
  const jobs = await listProcessingJobs(c.env, { limit });
  c.executionCtx.waitUntil(
    drainProcessingQueue(c.env)
      .catch((e) => console.error("processing queue drain failed while listing jobs", e))
  );
  return c.json(jobs);
});

processingRoute.post("/jobs/:id/cancel", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) return c.json({ detail: "Invalid processing job id" }, 400);

  const cancelled = await cancelProcessingJob(c.env, id);
  if (!cancelled) return c.json({ detail: "Processing job not found or already finished" }, 404);

  c.executionCtx.waitUntil(
    drainProcessingQueue(c.env)
      .catch((e) => console.error("processing queue drain failed after cancelling job", e))
  );
  return c.json(cancelled);
});
