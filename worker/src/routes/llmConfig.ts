import { Hono } from "hono";
import type { Env } from "../types";
import {
  buildDefaultLlmAgentConfig,
  isLlmAgentSlot,
  listLlmAgentConfigs,
  upsertLlmAgentConfig,
} from "../services/llmAgentConfig";

export const llmConfigRoute = new Hono<{ Bindings: Env }>();

llmConfigRoute.get("/", async (c) => {
  const defaults = buildDefaultLlmAgentConfig(c.env);
  const configs = await listLlmAgentConfigs(c.env);
  return c.json({ defaults, configs });
});

llmConfigRoute.put("/:slot", async (c) => {
  const slot = c.req.param("slot");
  if (!isLlmAgentSlot(slot)) return c.json({ detail: "Slot LLM không hợp lệ" }, 400);

  const body = await c.req.json().catch(() => ({}));
  try {
    const saved = await upsertLlmAgentConfig(c.env, slot, {
      enabled: body.enabled,
      provider: body.provider,
      endpoint_url: body.endpoint_url,
      api_key: body.api_key,
      clear_api_key: body.clear_api_key,
      model: body.model,
    });
    return c.json(saved);
  } catch (e: any) {
    return c.json({ detail: e?.message || "Không lưu được cấu hình LLM" }, 400);
  }
});
