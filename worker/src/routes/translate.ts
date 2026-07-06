import { Hono } from "hono";
import type { Env } from "../types";
import { DEFAULT_TRANSLATION_LOCALE, getTranslationProgress, runTranslation } from "../services/translation";

export const translateRoute = new Hono<{ Bindings: Env }>();

translateRoute.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const runId: number | undefined = body.run_id;
  const commentIds: number[] | undefined = body.comment_ids;
  const locale = body.locale || DEFAULT_TRANSLATION_LOCALE;
  const progressKey = runId ? `translate-run-${runId}-${locale}` : `translate-${Date.now()}`;

  c.executionCtx.waitUntil(runTranslation(c.env, {
    progressKey,
    locale,
    runId,
    commentIds,
    force: Boolean(body.force),
    limit: body.limit,
  }));

  return c.json({ progress_key: progressKey, status: "queued" });
});

translateRoute.get("/progress/:key", async (c) => {
  const progress = await getTranslationProgress(c.env, c.req.param("key"));
  return c.json(progress);
});
