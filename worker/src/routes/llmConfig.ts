import { Hono } from "hono";
import type { Env } from "../types";
import {
  isLlmAgentSlot,
  listLlmAgentConfigs,
  llmCatalogPayload,
  llmConfigPayloadDefaults,
  saveLlmAgentConfig,
} from "../services/llmAgentConfig";

export const llmConfigRoute = new Hono<{ Bindings: Env }>();

/**
 * Catalog plus the current per-slot selection. Carries no endpoint and no API key:
 * the UI shows provider names and short model names only.
 */
llmConfigRoute.get("/", async (c) => {
  return c.json({
    providers: llmCatalogPayload(),
    defaults: llmConfigPayloadDefaults(),
    configs: await listLlmAgentConfigs(c.env),
  });
});

llmConfigRoute.put("/:slot", async (c) => {
  const slot = c.req.param("slot");
  if (!isLlmAgentSlot(slot)) return c.json({ detail: "Slot LLM không hợp lệ" }, 400);

  const body = await c.req.json().catch(() => ({}));
  try {
    // Only the non-BYO providers reach here; a BYO choice lives in the browser for
    // the session and is sent per request instead of being saved.
    return c.json(await saveLlmAgentConfig(c.env, slot, { provider: body.provider, model: body.model }));
  } catch (e: any) {
    return c.json({ detail: e?.message || "Không lưu được cấu hình LLM" }, 400);
  }
});
