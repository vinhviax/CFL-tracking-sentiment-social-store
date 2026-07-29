import assert from "node:assert/strict";
import test from "node:test";
import { formatTokens, shortModelName, tokenUsageState, totalTokens, usageModelLabel } from "./IngestSettings.helpers.js";

test("no logged batch reads as 'none', so nothing is rendered at all", () => {
  assert.equal(tokenUsageState(null), "none");
  assert.equal(tokenUsageState(undefined), "none");
  assert.equal(tokenUsageState({ batches: 0, batches_with_usage: 0 }), "none");
});

test("batches that reported no usage read as 'missing', never as zero tokens", () => {
  // Every batch processed before token capture shipped looks like this. Showing a
  // 0 total here would claim the run cost nothing.
  const preTokenCapture = { batches: 550, batches_with_usage: 0, input_tokens: 0, output_tokens: 0 };
  assert.equal(tokenUsageState(preTokenCapture), "missing");
});

test("a mix of reported and unreported batches reads as 'partial'", () => {
  assert.equal(tokenUsageState({ batches: 10, batches_with_usage: 4, input_tokens: 100, output_tokens: 20 }), "partial");
});

test("every batch reporting usage reads as 'full'", () => {
  assert.equal(tokenUsageState({ batches: 7, batches_with_usage: 7, input_tokens: 100, output_tokens: 20 }), "full");
});

test("a genuine zero-token batch that did report usage is still 'full', not 'missing'", () => {
  // batches_with_usage is what separates "reported 0" from "reported nothing".
  assert.equal(tokenUsageState({ batches: 1, batches_with_usage: 1, input_tokens: 0, output_tokens: 0 }), "full");
});

test("counts arriving as strings do not break the state decision", () => {
  assert.equal(tokenUsageState({ batches: "3", batches_with_usage: "3" }), "full");
  assert.equal(tokenUsageState({ batches: "3", batches_with_usage: "0" }), "missing");
});

test("model names drop the provider prefix", () => {
  assert.equal(shortModelName("codex-lb/gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(shortModelName("ag/gemini-3-flash-agent"), "gemini-3-flash-agent");
  assert.equal(shortModelName("plain-model"), "plain-model");
  assert.equal(shortModelName(null), "—");
  assert.equal(shortModelName(""), "—");
});

test("token counts are grouped for Vietnamese readers", () => {
  assert.equal(formatTokens(1234567), "1.234.567");
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(null), "0");
  assert.equal(formatTokens(undefined), "0");
});

test("totalTokens adds input and output, tolerating missing fields", () => {
  assert.equal(totalTokens({ input_tokens: 1000, output_tokens: 250 }), 1250);
  assert.equal(totalTokens({ input_tokens: 1000 }), 1000);
  assert.equal(totalTokens(null), 0);
});

test("a job spanning two models lists both", () => {
  const usage = { by_model: [{ model: "codex-lb/gpt-5.6-terra" }, { model: "ag/gemini-3-flash-agent" }] };
  assert.equal(usageModelLabel(usage), "gpt-5.6-terra, gemini-3-flash-agent");
  assert.equal(usageModelLabel({}), "");
});
