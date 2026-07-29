import type { LLMProvider } from "./llm/base";
import { buildProvider } from "./llm/providers";
import type { Env } from "../types";
import {
  type ByoOverride,
  getLlmProvider,
  isLlmAgentSlot,
  type LlmAgentSlot,
  LLM_SLOT_DEFAULTS,
  LLM_SLOTS,
  normalizeStoredSelection,
  publicLlmCatalog,
  shortModelName,
} from "./llmCatalog";

export type { LlmAgentSlot, ByoOverride };
export { isLlmAgentSlot };

interface SlotRow {
  slot: LlmAgentSlot;
  provider: string;
  model: string;
  updated_at?: string | null;
}

interface ProviderSecretRow {
  provider: string;
  endpoint_url: string | null;
  api_key: string | null;
}

/**
 * Credentials for a non-BYO provider. gemini_viax rides the worker's own LLM_VIAX_*
 * configuration; anything else comes from llm_provider_secrets.
 */
async function loadProviderCredentials(
  env: Env,
  providerId: string
): Promise<{ apiKey?: string | null; endpoint?: string | null }> {
  if (providerId === "gemini_viax") {
    return { apiKey: env.LLM_VIAX_API_KEY, endpoint: env.LLM_VIAX_BASE_URL };
  }
  try {
    const row = await env.DB.prepare(
      `SELECT provider, endpoint_url, api_key FROM llm_provider_secrets WHERE provider = ?`
    ).bind(providerId).first<ProviderSecretRow>();
    if (row) return { apiKey: row.api_key, endpoint: row.endpoint_url };
  } catch (e: any) {
    if (!String(e?.message || e).includes("no such table")) throw e;
  }
  // No stored credential: fall back to the shared Viax proxy rather than nothing.
  return { apiKey: env.LLM_VIAX_API_KEY, endpoint: env.LLM_VIAX_BASE_URL };
}

async function getSlotRow(env: Env, slot: LlmAgentSlot): Promise<SlotRow | null> {
  try {
    return await env.DB.prepare(
      `SELECT slot, provider, model, updated_at FROM llm_agent_configs WHERE slot = ?`
    ).bind(slot).first<SlotRow>();
  } catch (e: any) {
    if (String(e?.message || e).includes("no such table")) return null;
    throw e;
  }
}

/** The provider/model a slot will use, falling back to the documented default. */
export async function getSlotSelection(env: Env, slot: LlmAgentSlot): Promise<{ provider: string; model: string }> {
  const row = await getSlotRow(env, slot);
  const fallback = LLM_SLOT_DEFAULTS[slot];
  if (!row) return fallback;
  const spec = getLlmProvider(row.provider);
  // A row naming a provider the catalog no longer has must not strand the slot.
  if (!spec || spec.byo) return fallback;
  return { provider: row.provider, model: row.model || fallback.model };
}

/**
 * Slot state for the UI: provider id, its label, and the short model name only —
 * never an endpoint or a key, for stock providers as much as BYO ones.
 */
export async function listLlmAgentConfigs(env: Env) {
  const out = [];
  for (const slot of LLM_SLOTS) {
    const selection = await getSlotSelection(env, slot);
    const spec = getLlmProvider(selection.provider);
    out.push({
      slot,
      provider: selection.provider,
      provider_label: spec?.label || selection.provider,
      model: selection.model,
      model_label: shortModelName(selection.model),
      is_default:
        selection.provider === LLM_SLOT_DEFAULTS[slot].provider &&
        selection.model === LLM_SLOT_DEFAULTS[slot].model,
    });
  }
  return out;
}

export function llmConfigPayloadDefaults() {
  return Object.fromEntries(
    LLM_SLOTS.map((slot) => {
      const spec = getLlmProvider(LLM_SLOT_DEFAULTS[slot].provider);
      return [
        slot,
        {
          slot,
          provider: LLM_SLOT_DEFAULTS[slot].provider,
          provider_label: spec?.label || LLM_SLOT_DEFAULTS[slot].provider,
          model: LLM_SLOT_DEFAULTS[slot].model,
          model_label: shortModelName(LLM_SLOT_DEFAULTS[slot].model),
        },
      ];
    })
  );
}

export function llmCatalogPayload() {
  return publicLlmCatalog();
}

/** Persist a slot's provider/model. Rejects BYO providers — see normalizeStoredSelection. */
export async function saveLlmAgentConfig(env: Env, slot: LlmAgentSlot, input: { provider?: unknown; model?: unknown }) {
  const selection = normalizeStoredSelection(input);
  await env.DB.prepare(
    `INSERT INTO llm_agent_configs (slot, provider, model, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(slot) DO UPDATE SET
       provider = excluded.provider,
       model = excluded.model,
       updated_at = excluded.updated_at`
  ).bind(slot, selection.provider, selection.model, new Date().toISOString()).run();
  return (await listLlmAgentConfigs(env)).find((row) => row.slot === slot)!;
}

/**
 * Resolve the provider to call for a slot.
 *
 * A BYO config supplied with the request wins and is used from memory only. It is
 * never persisted, so a drain triggered by cron — or by any request that did not
 * carry it, e.g. after the tab closed — falls back to the slot's stored provider.
 * That fallback is the cost of not storing the user's key, and is intentional.
 */
/** Provider used as the house safety net when the chosen one errors. */
const SAFETY_NET_PROVIDER = "gemini_viax";

/**
 * Providers to try for a slot, in order.
 *
 * Gemini by Viax is appended as a safety net so one bad provider choice degrades to a
 * working model rather than to keyword classification. It is omitted when it is
 * already the primary, and when it cannot be built (no proxy credential).
 */
export async function resolveLlmProviderChain(
  env: Env,
  slot: LlmAgentSlot,
  byo?: ByoOverride | null
): Promise<LLMProvider[]> {
  const chain: LLMProvider[] = [];
  const primary = await resolveLlmProvider(env, slot, byo);
  if (primary) chain.push(primary);

  if (!chain.some((p) => p.name === SAFETY_NET_PROVIDER)) {
    const spec = getLlmProvider(SAFETY_NET_PROVIDER);
    const model = spec?.models[0];
    if (model) {
      const creds = await loadProviderCredentials(env, SAFETY_NET_PROVIDER);
      const safety = buildProvider(SAFETY_NET_PROVIDER, model, creds);
      if (safety) chain.push(safety);
    }
  }
  return chain;
}

/**
 * Why a slot resolved the way it did, as booleans only — no endpoint, no key.
 * Exposed by /api/health so a misconfigured slot is diagnosable without guessing.
 */
export async function describeSlotResolution(env: Env, slot: LlmAgentSlot) {
  const selection = await getSlotSelection(env, slot);
  const creds = await loadProviderCredentials(env, selection.provider);
  const provider = buildProvider(selection.provider, selection.model, creds);
  return {
    slot,
    provider: selection.provider,
    provider_label: getLlmProvider(selection.provider)?.label || selection.provider,
    model: shortModelName(selection.model),
    has_endpoint: Boolean(creds.endpoint),
    has_api_key: Boolean(creds.apiKey),
    ready: provider !== null,
  };
}

export async function resolveLlmProvider(
  env: Env,
  slot: LlmAgentSlot,
  byo?: ByoOverride | null
): Promise<LLMProvider | null> {
  if (byo) {
    const provider = buildProvider(byo.provider, byo.model, {
      apiKey: byo.api_key,
      endpoint: byo.endpoint_url,
    });
    if (provider) return provider;
  }
  const selection = await getSlotSelection(env, slot);
  const creds = await loadProviderCredentials(env, selection.provider);
  return buildProvider(selection.provider, selection.model, creds);
}
