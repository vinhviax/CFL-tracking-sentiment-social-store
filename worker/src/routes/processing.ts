import { Hono } from "hono";
import type { Env } from "../types";
import { listProcessingJobLogs } from "../services/processingLogs";
import {
  cancelProcessingJob,
  drainProcessingQueue,
  listProcessingJobs,
  recoverStaleProcessingJobs,
  retryFailedProcessingJobs,
} from "../services/processingQueue";
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

/**
 * Do a bounded amount of queue work inside this request and report what happened.
 *
 * The other endpoints drain in `ctx.waitUntil`, which Cloudflare stops shortly after
 * the response — an LLM batch that runs longer than that is killed mid-flight, leaving
 * the job stuck in 'running' until stale recovery reclaims it. That made a large
 * re-analysis crawl at roughly one batch per stale window. Awaiting the drain instead
 * keeps the work inside the request's own budget, so a caller can loop this to
 * completion and see real progress each time.
 */
processingRoute.post("/drain", async (c) => {
  const byo = parseByoHeader(c.req.header(BYO_HEADER));
  const before = await listProcessingJobs(c.env, { limit: 50 });
  // Short takeover window. A waitUntil drain that dies mid-batch still logs "batch
  // started" first, so the job looks alive for the normal window and this endpoint
  // could never claim it — the two kept deadlocking. Taking over after 20s is safe
  // because the work is idempotent: each attempt re-selects only comments that still
  // have no analysis, and analyses are upserted.
  await recoverStaleProcessingJobs(c.env, 20_000);
  const retried = await retryFailedProcessingJobs(c.env);
  await drainProcessingQueue(c.env, undefined, undefined, { byo });
  const after = await listProcessingJobs(c.env, { limit: 50 });
  return c.json({
    requeued_failed: retried,
    active_before: before.length,
    active_after: after.length,
    jobs: after,
  });
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
