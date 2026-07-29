// Bring-your-own-key LLM config, held for the tab only.
//
// The four BYO providers (anthropic/gemini/openai chính chủ, and Custom) take the
// user's own API key, which is never sent to the database. sessionStorage is the
// right home: it survives F5 in the same tab and is gone in a new tab or after the
// tab closes, which is exactly the required lifetime.
//
// The worker reads this from a request header — never a query parameter, since the
// value contains a secret.

const STORAGE_KEY = "cfl.llm.byo.v1";

export const BYO_HEADER = "X-CFL-LLM-Config";

function readStore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {}; // private mode, or a value from an older shape
  }
}

function writeStore(store) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* nothing useful to do if the tab refuses storage */
  }
}

/** The BYO config for one slot, or null when that slot uses a saved provider. */
export function getByoConfig(slot) {
  return readStore()[slot] || null;
}

export function setByoConfig(slot, config) {
  const store = readStore();
  if (!config) delete store[slot];
  else store[slot] = config;
  writeStore(store);
}

export function clearByoConfig(slot) {
  setByoConfig(slot, null);
}

/**
 * Which slot's config to attach to a given request.
 *
 * Translation runs on the "simple" slot and everything else on "reasoning", so the
 * URL decides. Requests that drain the queue generically (the processing endpoints)
 * cannot know which job they will pick up, so they carry reasoning — the analysis
 * slot — and a translation batch drained that way falls back to its saved provider.
 */
export function slotForRequestUrl(url) {
  const path = String(url || "");
  if (path.includes("/api/translate")) return "simple";
  return "reasoning";
}

/** Header value for a request, or null when the slot has no BYO config. */
export function byoHeaderValue(url) {
  const config = getByoConfig(slotForRequestUrl(url));
  if (!config?.provider || !config?.model || !config?.api_key) return null;
  if (config.provider === "custom" && !config.endpoint_url) return null;
  return JSON.stringify({
    provider: config.provider,
    model: config.model,
    api_key: config.api_key,
    ...(config.provider === "custom" ? { endpoint_url: config.endpoint_url } : {}),
  });
}
