import { Hono } from "hono";
import type { Env } from "../types";
import { GAME_MODES } from "../services/gameModes";
import { tagGameModes } from "../services/gameModeTagging";
import { BYO_HEADER, parseByoHeader } from "../services/llmCatalog";

export const gameModesRoute = new Hono<{ Bindings: Env }>();

gameModesRoute.get("/", (c) =>
  c.json({
    parent_topic: "gameplay_mode_map",
    modes: GAME_MODES.map((mode) => ({
      key: mode.key,
      label_vi: mode.label_vi,
      label_zh_cn: mode.label_zh_cn,
      description: mode.description,
    })),
  })
);

gameModesRoute.post("/tag", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await tagGameModes(c.env, {
    byo: parseByoHeader(c.req.header(BYO_HEADER)),
    from: body.from,
    to: body.to,
    verify: body.verify,
    verifyBatchSize: body.verify_batch_size,
    maxLlmBatches: body.max_llm_batches,
    debug: body.debug,
  });
  return c.json(result);
});
