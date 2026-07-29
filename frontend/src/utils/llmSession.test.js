import assert from "node:assert/strict";
import test from "node:test";

// sessionStorage does not exist under node:test, so stand one up before importing
// the module — it reads storage at call time, not at import time.
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { byoHeaderValue, clearByoConfig, getByoConfig, setByoConfig, slotForRequestUrl } = await import("./llmSession.js");

test("translation requests take the simple slot, everything else reasoning", () => {
  assert.equal(slotForRequestUrl("/api/translate/run"), "simple");
  assert.equal(slotForRequestUrl("/api/translate/progress/x"), "simple");
  assert.equal(slotForRequestUrl("/api/analyze/run"), "reasoning");
  assert.equal(slotForRequestUrl("/api/insights/generate"), "reasoning");
  // A generic queue drain cannot know which job it will claim, so it carries
  // reasoning and a translation batch drained that way uses its saved provider.
  assert.equal(slotForRequestUrl("/api/processing/jobs"), "reasoning");
  assert.equal(slotForRequestUrl(undefined), "reasoning");
});

test("a slot with no own-key config contributes no header", () => {
  store.clear();
  assert.equal(getByoConfig("reasoning"), null);
  assert.equal(byoHeaderValue("/api/analyze/run"), null);
});

test("a complete own-key config becomes a header on the matching slot only", () => {
  store.clear();
  setByoConfig("reasoning", { provider: "anthropic_direct", model: "claude-x", api_key: "k" });

  assert.deepEqual(JSON.parse(byoHeaderValue("/api/analyze/run")), {
    provider: "anthropic_direct",
    model: "claude-x",
    api_key: "k",
  });
  // The simple slot was not configured, so translation carries nothing.
  assert.equal(byoHeaderValue("/api/translate/run"), null);
});

test("a non-Custom provider does not send an endpoint; the server picks it", () => {
  store.clear();
  setByoConfig("reasoning", { provider: "gemini_direct", model: "g", api_key: "k", endpoint_url: "https://x.example" });
  assert.equal("endpoint_url" in JSON.parse(byoHeaderValue("/api/analyze/run")), false);
});

test("Custom sends its endpoint, and is ignored while the endpoint is missing", () => {
  store.clear();
  setByoConfig("simple", { provider: "custom", model: "m", api_key: "k" });
  assert.equal(byoHeaderValue("/api/translate/run"), null);

  setByoConfig("simple", { provider: "custom", model: "m", api_key: "k", endpoint_url: "https://gw.example/v1" });
  assert.equal(JSON.parse(byoHeaderValue("/api/translate/run")).endpoint_url, "https://gw.example/v1");
});

test("an incomplete config sends nothing rather than a half-formed header", () => {
  store.clear();
  setByoConfig("reasoning", { provider: "openai_direct", model: "gpt-x" }); // no key
  assert.equal(byoHeaderValue("/api/analyze/run"), null);

  setByoConfig("reasoning", { provider: "openai_direct", api_key: "k" }); // no model
  assert.equal(byoHeaderValue("/api/analyze/run"), null);
});

test("the two slots are independent", () => {
  store.clear();
  setByoConfig("reasoning", { provider: "anthropic_direct", model: "a", api_key: "k1" });
  setByoConfig("simple", { provider: "openai_direct", model: "b", api_key: "k2" });

  assert.equal(JSON.parse(byoHeaderValue("/api/analyze/run")).model, "a");
  assert.equal(JSON.parse(byoHeaderValue("/api/translate/run")).model, "b");

  clearByoConfig("reasoning");
  assert.equal(byoHeaderValue("/api/analyze/run"), null);
  assert.equal(JSON.parse(byoHeaderValue("/api/translate/run")).model, "b");
});

test("survives storage holding something unparseable", () => {
  store.clear();
  store.set("cfl.llm.byo.v1", "{not json");
  assert.equal(getByoConfig("reasoning"), null);
});
