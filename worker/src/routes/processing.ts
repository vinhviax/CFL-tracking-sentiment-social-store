import { Hono } from "hono";
import type { Env } from "../types";
import { drainProcessingQueue, listProcessingJobs } from "../services/processingQueue";

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
