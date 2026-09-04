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
import { claimSlotAttempt, getSlotState, resetSlotEscalation } from "./llmSlotState";

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
 * Credentials for a non-BYO provider. gemini_viax and vng_lite ride the worker's own
 * environment; anything else comes from llm_provider_secrets.
 */
async function loadProviderCredentials(
  env: Env,
  providerId: string
): Promise<{ apiKey?: string | null; endpoint?: string | null }> {
  if (providerId === "gemini_viax") {
    return { apiKey: env.LLM_VIAX_API_KEY, endpoint: env.LLM_VIAX_BASE_URL };
  }
  // Returned even when unset, deliberately without the Viax fallback below: the Viax
  // proxies are unreachable from the VNG network this provider exists for, so falling
  // back would report a ready slot that fails every call.
  if (providerId === "vng_lite") {
    return { apiKey: env.LLM_VNG_LITE_API_KEY, endpoint: env.LLM_VNG_LITE_BASE_URL };
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
    // Escalation state comes along so the UI can say which provider is actually in
    // use right now — otherwise a slot silently running on its secondary, or stopped
    // for the day, looks identical to one running normally on its configured primary.
    const state = await getSlotState(env, slot).catch(() => null);
    const activeSpec = state?.tier === "secondary" ? getLlmProvider(SLOT_SECONDARY[slot].provider) : spec;
    out.push({
      slot,
      provider: selection.provider,
      provider_label: spec?.label || selection.provider,
      model: selection.model,
      model_label: shortModelName(selection.model),
      is_default:
        selection.provider === LLM_SLOT_DEFAULTS[slot].provider &&
        selection.model === LLM_SLOT_DEFAULTS[slot].model,
      tier: state?.tier || "primary",
      consecutive_failures: state?.consecutive_failures ?? 0,
      active_provider_label: state?.tier === "exhausted"
        ? null
        : activeSpec?.label || (state?.tier === "secondary" ? SLOT_SECONDARY[slot].provider : selection.provider),
      active_model_label: state?.tier === "exhausted"
        ? null
        : shortModelName(state?.tier === "secondary" ? SLOT_SECONDARY[slot].model : selection.model),
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
  // A manual provider change is a deliberate intervention — give the slot a clean
  // slate immediately rather than making the admin wait for tomorrow's reset cron
  // or for 3 more failures to accumulate against a tier that no longer applies.
  await resetSlotEscalation(env, slot);
  return (await listLlmAgentConfigs(env)).find((row) => row.slot === slot)!;
}

/**
 * Fixed secondary provider per slot — what it escalates to after 3 consecutive
 * primary failures. Each Viax provider backs up the other, and the two slots use
 * different OpenAI models on purpose: the reasoning slot's own primary is terra, so
 * the simple slot falls back to luna instead of competing for the same model.
 */
const SLOT_SECONDARY: Record<LlmAgentSlot, { provider: string; model: string }> = {
  reasoning: { provider: "gemini_viax", model: "ag/gemini-3.6-flash-high" },
  simple: { provider: "openai_viax", model: "gpt-5.6-luna" },
};

async function buildSlotTierProvider(
  env: Env,
  slot: LlmAgentSlot,
  tier: "primary" | "secondary"
): Promise<LLMProvider | null> {
  if (tier === "primary") {
    const selection = await getSlotSelection(env, slot);
    const creds = await loadProviderCredentials(env, selection.provider);
    return buildProvider(selection.provider, selection.model, creds);
  }
  const secondary = SLOT_SECONDARY[slot];
  const creds = await loadProviderCredentials(env, secondary.provider);
  return buildProvider(secondary.provider, secondary.model, creds);
}

/**
 * The provider to call for a slot right now — at most one, chosen by the slot's
 * persisted escalation tier (see llmSlotState.ts) rather than always chaining
 * primary + a safety net on every single call. Empty means "do not attempt right
 * now": the slot is in its post-failure backoff window (simple only), or has
 * given up for the day, or a provider could not be built at all.
 *
 * A BYO override bypasses escalation state entirely — it's an explicit per-request
 * choice and must not be gated by machinery that exists to protect the shared
 * house providers' quota. Kept as an array (rather than a single provider) so the
 * 5 call sites don't need to change how they use `chain[0]`/`chain.length`.
 */
export async function resolveLlmProviderChain(
  env: Env,
  slot: LlmAgentSlot,
  byo?: ByoOverride | null
): Promise<LLMProvider[]> {
  if (byo) {
    const provider = buildProvider(byo.provider, byo.model, {
      apiKey: byo.api_key,
      endpoint: byo.endpoint_url,
    });
    return provider ? [provider] : [];
  }
  const claim = await claimSlotAttempt(env, slot);
  if (!claim || claim.tier === "exhausted") return [];
  const provider = await buildSlotTierProvider(env, slot, claim.tier);
  return provider ? [provider] : [];
}

/**
 * Whether a slot's own configured provider can be built at all, ignoring
 * escalation state entirely. Used to tell "genuinely unconfigured" (a hard
 * failure, worth failing the whole job for) apart from "temporarily has no
 * active provider" (backoff/exhausted — just skip this attempt and let the
 * job requeue, see translation.ts/analysis.ts).
 */
export async function isSlotConfigured(env: Env, slot: LlmAgentSlot, byo?: ByoOverride | null): Promise<boolean> {
  if (byo) {
    return Boolean(buildProvider(byo.provider, byo.model, { apiKey: byo.api_key, endpoint: byo.endpoint_url }));
  }
  const selection = await getSlotSelection(env, slot);
  const creds = await loadProviderCredentials(env, selection.provider);
  return Boolean(buildProvider(selection.provider, selection.model, creds));
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
