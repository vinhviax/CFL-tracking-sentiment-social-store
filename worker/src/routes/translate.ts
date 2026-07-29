import { Hono } from "hono";
import type { Env } from "../types";
import { DEFAULT_TRANSLATION_LOCALE, getTranslationProgress } from "../services/translation";
import { drainProcessingQueue, enqueueProcessingJobs } from "../services/processingQueue";
import { BYO_HEADER, parseByoHeader } from "../services/llmCatalog";

export const translateRoute = new Hono<{ Bindings: Env }>();

translateRoute.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const byo = parseByoHeader(c.req.header(BYO_HEADER));
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
    drainProcessingQueue(c.env, undefined, undefined, { byo })
      .catch((e) => console.error(`translation queue failed for ${progressKey}`, e))
  );

  return c.json({ progress_key: progressKey, status: "queued" });
});

translateRoute.get("/progress/:key", async (c) => {
  const byo = parseByoHeader(c.req.header(BYO_HEADER));
  const progress = await getTranslationProgress(c.env, c.req.param("key"));
  const status = (progress as any)?.status;
  if (!["done", "failed", "cancelled"].includes(status)) {
    c.executionCtx.waitUntil(
      drainProcessingQueue(c.env, undefined, undefined, { byo })
        .catch((e) => console.error(`translation queue failed while polling ${c.req.param("key")}`, e))
    );
  }
  return c.json(progress);
});
