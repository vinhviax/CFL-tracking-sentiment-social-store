import { Hono } from "hono";
import type { Env } from "../types";
import { DEFAULT_TRANSLATION_LOCALE, getTranslationProgress } from "../services/translation";
import { drainProcessingQueue, enqueueProcessingJobs } from "../services/processingQueue";

export const translateRoute = new Hono<{ Bindings: Env }>();

translateRoute.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const runId: number | undefined = body.run_id;
  const commentIds: number[] | undefined = body.comment_ids;
  const locale = body.locale || DEFAULT_TRANSLATION_LOCALE;
  const progressKey = runId ? `translate-run-${runId}-${locale}` : `translate-${Date.now()}`;

  await enqueueProcessingJobs(c.env, [
    {
      job_type: "translation",
      ...(runId != null ? { run_id: runId } : {}),
      ...(commentIds?.length ? { comment_ids: commentIds } : {}),
      progress_key: progressKey,
      locale,
      force: Boolean(body.force),
      limit: body.limit,
    },
  ]);

  c.executionCtx.waitUntil(
    drainProcessingQueue(c.env)
      .catch((e) => console.error(`translation queue failed for ${progressKey}`, e))
  );

  return c.json({ progress_key: progressKey, status: "queued" });
});

translateRoute.get("/progress/:key", async (c) => {
  const progress = await getTranslationProgress(c.env, c.req.param("key"));
  return c.json(progress);
});
