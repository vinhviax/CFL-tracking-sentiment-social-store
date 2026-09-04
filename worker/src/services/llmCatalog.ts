// The closed set of LLM providers the app offers, and what each one needs.
//
// Endpoints live here rather than in the client so the UI never has to render a
// real URL, and the two "by Viax" entries keep their credentials server-side
// (llm_provider_secrets / the LLM_VIAX_API_KEY secret). The four BYO entries take
// the user's own key per request and are never persisted — see resolveLlmProvider.

/** Wire format to speak, independent of who is hosting the model. */
export type LlmTransport = "openai" | "anthropic" | "gemini";

export interface LlmProviderSpec {
  id: string;
  label: string;
  transport: LlmTransport;
  /**
   * true when the caller supplies the API key (and, for `custom`, the endpoint).
   * Nothing about a BYO provider is written to the database.
   */
  byo: boolean;
  /** Fixed endpoint. Absent for `custom`, where the user supplies it. */
  endpoint?: string;
  /**
   * Allowed models. Empty means free-form: the user types a model name, because
   * we cannot enumerate what their own account has access to.
   */
  models: string[];
}

const STUDIO_ENDPOINTS = {
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openai: "https://api.openai.com/v1",
};

export const LLM_PROVIDERS: LlmProviderSpec[] = [
  {
    id: "vng_lite",
    label: "VNG Lite (nội bộ)",
    // The gateway is OpenAI-compatible: /v1/chat/completions accepts the same body and
    // returns choices[0].message.content plus a usage block, so OpenAIProvider works
    // unchanged. Verified against the live endpoint 2026-09-04.
    transport: "openai",
    byo: false,
    // Ordered by measured speed on a real 20-comment classification batch (2026-09-04),
    // because that is what decides whether a run finishes at all:
    //   gemini-3.5-flash-lite 4.7s · gpt-5.4-mini 4.9s · 3.1-flash-lite 5.0s
    //   gemini-3.6-flash 19.9s (only with reasoning_effort=none; 68.8s without)
    //   deepseek-v4-flash 38.3s — it ignores reasoning_effort=none entirely
    // The leaders spend zero reasoning tokens; the slow ones burn 1,500-2,500 of them
    // per batch. Keep a lite model first: the code sends no reasoning_effort, so a
    // reasoning-heavy default would silently cost 8x the latency.
    models: [
      "gemini/gemini-3.5-flash-lite",
      "gpt-5.4-mini",
      "gemini-3.1-flash-lite-preview",
      "gemini/gemini-3.6-flash",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "gemini-3.1-pro-preview",
    ],
  },
  {
    id: "gemini_viax",
    label: "Gemini by Viax",
    transport: "openai", // the Viax proxy is OpenAI-compatible whatever model it fronts
    byo: false,
    // Newest first — that is what the slots default to. The older flash-agent name is
    // kept selectable rather than deleted so a model the proxy turns out not to serve
    // can be reverted from the UI in seconds instead of needing a deploy.
    models: ["ag/gemini-3.6-flash-high", "ag/gemini-3-flash-agent"],
  },
  {
    id: "openai_viax",
    label: "OpenAI by Viax",
    transport: "openai",
    byo: false,
    // Bare names, no "codex-lb/" prefix: that prefix is how the rpi7jss proxy routes,
    // and sending it to agent-shop returns 403 model_not_allowed. Configuring the
    // prefixed name against this endpoint is what silently dropped analysis to the
    // keyword fallback for 31,322 comments between 2026-07-17 and 2026-07-29.
    models: ["gpt-5.6-terra", "gpt-5.6-luna"],
  },
  {
    id: "anthropic_direct",
    label: "Anthropic chính chủ",
    transport: "anthropic",
    byo: true,
    endpoint: STUDIO_ENDPOINTS.anthropic,
    models: [],
  },
  {
    id: "gemini_direct",
    label: "Gemini chính chủ",
    transport: "gemini",
    byo: true,
    endpoint: STUDIO_ENDPOINTS.gemini,
    models: [],
  },
  {
    id: "openai_direct",
    label: "OpenAI chính chủ",
    transport: "openai",
    byo: true,
    endpoint: STUDIO_ENDPOINTS.openai,
    models: [],
  },
  {
    id: "custom",
    label: "Custom",
    transport: "openai",
    byo: true,
    models: [],
  },
];

const BY_ID = new Map(LLM_PROVIDERS.map((p) => [p.id, p]));

export type LlmAgentSlot = "reasoning" | "simple";

export const LLM_SLOTS: LlmAgentSlot[] = ["reasoning", "simple"];

/** What each slot uses when the user has never chosen anything. */
export const LLM_SLOT_DEFAULTS: Record<LlmAgentSlot, { provider: string; model: string }> = {
  reasoning: { provider: "openai_viax", model: "gpt-5.6-terra" },
  simple: { provider: "gemini_viax", model: "ag/gemini-3.6-flash-high" },
};

export function isLlmAgentSlot(value: unknown): value is LlmAgentSlot {
  return LLM_SLOTS.includes(String(value) as LlmAgentSlot);
}

export function getLlmProvider(id: string | null | undefined): LlmProviderSpec | null {
  return BY_ID.get(String(id || "")) || null;
}

/** Last path segment of a model id: "codex-lb/gpt-5.6-terra" to "gpt-5.6-terra". */
export function shortModelName(model: string | null | undefined): string | null {
  if (!model) return null;
  const parts = String(model).split("/");
  return parts[parts.length - 1] || String(model);
}

/**
 * Catalog for the client. Deliberately omits `endpoint`: requirement is that no
 * real endpoint is ever shown, for stock providers as much as user-made ones.
 */
export function publicLlmCatalog() {
  return LLM_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    byo: p.byo,
    needs_endpoint: p.id === "custom",
    needs_api_key: p.byo,
    models: p.models,
    model_options: p.models.map((m) => ({ value: m, label: shortModelName(m) })),
  }));
}

export interface LlmSelectionInput {
  provider?: unknown;
  model?: unknown;
}

/**
 * Validate a stored slot selection. Only the non-BYO providers can be persisted:
 * a BYO choice carries a key, and keys are never written to the database, so
 * there would be nothing usable to store.
 */
export function normalizeStoredSelection(input: LlmSelectionInput): { provider: string; model: string } {
  const spec = getLlmProvider(String(input.provider || ""));
  if (!spec) throw new Error("Provider không hợp lệ");
  if (spec.byo) {
    throw new Error(`${spec.label} dùng API key riêng của bạn nên không lưu được; nó chỉ áp dụng cho phiên làm việc hiện tại.`);
  }
  const model = String(input.model || "").trim();
  if (!model) throw new Error("Model không được để trống");
  if (!spec.models.includes(model)) {
    throw new Error(`Model "${model}" không thuộc ${spec.label}`);
  }
  return { provider: spec.id, model };
}

export interface ByoOverride {
  provider: string;
  model: string;
  api_key?: string | null;
  endpoint_url?: string | null;
}

/**
 * Header the browser uses to carry its own provider config.
 *
 * A header rather than a query parameter because the value contains the user's API
 * key, and secrets must never travel in a URL. A header rather than the request body
 * because the polling endpoints that drain the queue are GETs.
 */
export const BYO_HEADER = "x-cfl-llm-config";

export function parseByoHeader(value: string | null | undefined): ByoOverride | null {
  if (!value) return null;
  try {
    return normalizeByoOverride(JSON.parse(value));
  } catch {
    return null; // a malformed header falls back to the slot default rather than failing the request
  }
}

/**
 * Validate a per-request BYO config. Returns null when the request carried none,
 * which is the normal case (cron, and any drain after the browser went away).
 */
export function normalizeByoOverride(raw: unknown): ByoOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const spec = getLlmProvider(String(input.provider || ""));
  if (!spec || !spec.byo) return null;

  const model = String(input.model || "").trim();
  const apiKey = String(input.api_key || "").trim();
  const endpointUrl = String(input.endpoint_url || "").trim();
  if (!model || !apiKey) return null;
  if (spec.id === "custom" && !endpointUrl) return null;

  return {
    provider: spec.id,
    model,
    api_key: apiKey,
    endpoint_url: spec.id === "custom" ? endpointUrl : spec.endpoint || null,
  };
}
