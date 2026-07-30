import assert from "node:assert/strict";
import test from "node:test";
import {
  STALE_LOG_MS,
  formatTokens,
  processingJobCaption,
  processingJobNote,
  processingJobPhase,
  shortModelName,
  slotEscalationNote,
  tokenUsageState,
  totalTokens,
  usageModelLabel,
} from "./IngestSettings.helpers.js";

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

test("a job still waiting its turn is not reported like one that is working", () => {
  // The queue only claims a few jobs at a time, so this is the normal state for most
  // of a large batch of runs. It used to render as "Đang chờ ... 0/0 comment".
  const waiting = { status: "queued", done: 0, total: 0, queue_status: "queued", queue_started_at: null, queue_ahead: 4 };
  assert.equal(processingJobPhase(waiting, []), "waiting");
  assert.equal(processingJobCaption(waiting, "waiting"), "Chưa bắt đầu · còn 4 task phía trước");
  assert.equal(processingJobCaption({ ...waiting, queue_ahead: 0 }, "waiting"), "Chưa bắt đầu · sắp tới lượt");
});

test("a job that already did work and requeued itself reads as paused, with its real counts", () => {
  const paused = {
    status: "queued",
    done: 150,
    total: 400,
    provider: "openai_viax",
    queue_status: "queued",
    queue_started_at: "2026-07-30T01:10:42.360Z",
    queue_ahead: 2,
  };
  assert.equal(processingJobPhase(paused, []), "paused");
  assert.equal(processingJobCaption(paused, "paused"), "150/400 comment · Provider: openai_viax");
  assert.match(processingJobNote("paused"), /chạy tiếp/);
});

test("a running job whose logs went quiet past the worker's stale window reads as stalled", () => {
  const running = { status: "running", done: 20, total: 400, queue_status: "running", queue_started_at: "2026-07-30T01:10:42.360Z" };
  const fresh = [{ created_at: new Date(Date.now() - 5_000).toISOString() }];
  const quiet = [{ created_at: new Date(Date.now() - STALE_LOG_MS - 1_000).toISOString() }];
  assert.equal(processingJobPhase(running, fresh), "running");
  assert.equal(processingJobPhase(running, quiet), "stalled");
  // No log at all is not evidence of a stall — a freshly claimed job has none yet.
  assert.equal(processingJobPhase(running, []), "running");
  assert.match(processingJobNote("stalled"), /tự thu hồi/);
});

test("terminal states win over any queue row left behind", () => {
  assert.equal(processingJobPhase({ status: "done", queue_status: "queued" }, []), "done");
  assert.equal(processingJobPhase({ status: "failed" }, []), "failed");
  assert.equal(processingJobPhase({ status: "cancelled" }, []), "cancelled");
  assert.equal(processingJobNote("running"), null);
});

test("without a queue row the progress status alone decides the phase", () => {
  // Ad-hoc keys from before the queue existed, and jobs whose queue row is gone.
  assert.equal(processingJobPhase({ status: "queued", queue_status: null }, []), "waiting");
  assert.equal(processingJobPhase({ status: "running", queue_status: null }, []), "running");
  assert.equal(processingJobCaption({ status: "queued" }, "waiting"), "Chưa bắt đầu · đang chờ trong hàng đợi");
});

test("a slot running normally on its configured provider says nothing extra", () => {
  assert.equal(slotEscalationNote({ tier: "primary", consecutive_failures: 0 }), null);
  assert.equal(slotEscalationNote(null), null);
  assert.equal(slotEscalationNote(undefined), null);
});

test("a slot quietly running on its backup provider says so, with the real model", () => {
  // Without this the UI shows the configured provider while calls actually go
  // somewhere else — the state that let a dead provider go unnoticed.
  const note = slotEscalationNote({
    tier: "secondary",
    consecutive_failures: 1,
    active_provider_label: "Gemini by Viax",
    active_model_label: "gemini-3-flash-agent",
  });
  assert.match(note, /dự phòng/);
  assert.match(note, /Gemini by Viax · gemini-3-flash-agent/);
  assert.match(note, /1 lỗi liên tiếp/);
});

test("a slot that gave up for the day says when it will retry", () => {
  const note = slotEscalationNote({ tier: "exhausted", consecutive_failures: 0 });
  assert.match(note, /Đã dừng gọi LLM cho hôm nay/);
  assert.match(note, /ngày mai/);
});

test("failures short of the escalation threshold are surfaced as a warning", () => {
  const note = slotEscalationNote({ tier: "primary", consecutive_failures: 2 });
  assert.match(note, /2 lỗi liên tiếp/);
  assert.match(note, /3 lỗi sẽ chuyển/);
});
