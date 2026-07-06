import type { LLMProvider } from "./llm/base";
import { buildProvider } from "./llm/providers";
import type { Env } from "../types";

export type LlmAgentSlot = "reasoning" | "simple";
export type LlmAgentProvider = "openai" | "anthropic" | "gemini" | "custom" | "openai_compatible" | "llm_viax";

const SLOTS = new Set(["reasoning", "simple"]);
const PROVIDERS = new Set(["openai", "anthropic", "gemini", "custom", "openai_compatible", "llm_viax"]);

export interface LlmAgentConfigRow {
  slot: LlmAgentSlot;
  enabled: number | boolean;
  provider: LlmAgentProvider;
  endpoint_url: string | null;
  api_key: string | null;
  model: string;
  updated_at?: string | null;
}

export interface LlmAgentConfigInput {
  enabled?: boolean;
  provider?: string;
  endpoint_url?: string | null;
  api_key?: string | null;
  clear_api_key?: boolean;
  model?: string;
}

export function isLlmAgentSlot(value: string): value is LlmAgentSlot {
  return SLOTS.has(value);
}

function normalizeProvider(value: string | undefined): LlmAgentProvider {
  const provider = String(value || "").trim().toLowerCase();
  if (!PROVIDERS.has(provider)) throw new Error("Provider không hợp lệ");
  return provider as LlmAgentProvider;
}

function trimOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export function maskApiKey(apiKey: string | null | undefined) {
  if (!apiKey) return null;
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function sanitizeLlmAgentConfig(row: LlmAgentConfigRow) {
  return {
    slot: row.slot,
    enabled: Boolean(row.enabled),
    provider: row.provider,
    endpoint_url: row.endpoint_url || null,
    model: row.model,
    has_api_key: Boolean(row.api_key),
    api_key_masked: maskApiKey(row.api_key),
    updated_at: row.updated_at || null,
  };
}

export function buildDefaultLlmAgentConfig(env: Env) {
  return {
    reasoning: {
      slot: "reasoning" as const,
      provider: env.LLM_PROVIDER,
      endpoint_url: env.LLM_PROVIDER === "llm_viax" ? env.LLM_VIAX_BASE_URL || null : env.LLM_BASE_URL || null,
      model: env.LLM_CLASSIFY_MODEL,
    },
    simple: {
      slot: "simple" as const,
      provider: env.LLM_PROVIDER,
      endpoint_url: env.LLM_PROVIDER === "llm_viax" ? env.LLM_VIAX_BASE_URL || null : env.LLM_BASE_URL || null,
      model: env.LLM_TRANSLATE_MODEL || env.LLM_INSIGHT_MODEL,
    },
  };
}

async function getConfigRow(env: Env, slot: LlmAgentSlot): Promise<LlmAgentConfigRow | null> {
  return env.DB.prepare(
    `SELECT slot, enabled, provider, endpoint_url, api_key, model, updated_at
     FROM llm_agent_configs
     WHERE slot = ?`
  ).bind(slot).first<LlmAgentConfigRow>();
}

export async function listLlmAgentConfigs(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT slot, enabled, provider, endpoint_url, api_key, model, updated_at
     FROM llm_agent_configs
     ORDER BY CASE slot WHEN 'reasoning' THEN 1 WHEN 'simple' THEN 2 ELSE 9 END`
  ).all<LlmAgentConfigRow>();
  return rows.results.map(sanitizeLlmAgentConfig);
}

export async function upsertLlmAgentConfig(env: Env, slot: LlmAgentSlot, input: LlmAgentConfigInput) {
  const existing = await getConfigRow(env, slot);
  const provider = normalizeProvider(input.provider || existing?.provider || "custom");
  const model = trimOrNull(input.model || existing?.model);
  if (!model) throw new Error("Model không được để trống");

  const endpointUrl = trimOrNull(input.endpoint_url ?? existing?.endpoint_url);
  const apiKey = input.clear_api_key
    ? null
    : trimOrNull(input.api_key) || existing?.api_key || null;
  const enabled = input.enabled == null ? Boolean(existing?.enabled) : Boolean(input.enabled);
  const now = new Date().toISOString();

  const row = await env.DB.prepare(
    `INSERT INTO llm_agent_configs (slot, enabled, provider, endpoint_url, api_key, model, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slot) DO UPDATE SET
       enabled = excluded.enabled,
       provider = excluded.provider,
       endpoint_url = excluded.endpoint_url,
       api_key = excluded.api_key,
       model = excluded.model,
       updated_at = excluded.updated_at
     RETURNING slot, enabled, provider, endpoint_url, api_key, model, updated_at`
  ).bind(slot, enabled ? 1 : 0, provider, endpointUrl, apiKey, model, now).first<LlmAgentConfigRow>();
  return sanitizeLlmAgentConfig(row!);
}

function buildProviderFromConfig(row: LlmAgentConfigRow): LLMProvider | null {
  const provider = row.provider === "custom" ? "custom" : row.provider;
  return buildProvider(provider, row.model, {
    anthropicKey: row.api_key || undefined,
    openaiKey: row.api_key || undefined,
    baseUrl: row.endpoint_url || undefined,
    llmViaxKey: row.api_key || undefined,
    llmViaxBaseUrl: row.endpoint_url || undefined,
  });
}

function buildDefaultProvider(env: Env, slot: LlmAgentSlot): LLMProvider | null {
  const model = slot === "simple"
    ? env.LLM_TRANSLATE_MODEL || env.LLM_INSIGHT_MODEL
    : env.LLM_CLASSIFY_MODEL;
  return buildProvider(env.LLM_PROVIDER, model, {
    anthropicKey: env.ANTHROPIC_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    llmViaxKey: env.LLM_VIAX_API_KEY,
    llmViaxBaseUrl: env.LLM_VIAX_BASE_URL,
  });
}

export async function resolveLlmProvider(env: Env, slot: LlmAgentSlot) {
  try {
    const row = await getConfigRow(env, slot);
    if (row?.enabled) {
      const provider = buildProviderFromConfig(row);
      if (provider) return provider;
    }
  } catch (e: any) {
    if (!String(e?.message || e).includes("no such table")) throw e;
  }
  return buildDefaultProvider(env, slot);
}
