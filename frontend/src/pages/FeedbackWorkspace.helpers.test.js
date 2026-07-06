import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkspaceFilter, buildTopicOptions } from "./FeedbackWorkspace.helpers.js";

test("changing sentiment resets topic and subtopic filters", () => {
  const current = {
    from: "2026-06-29",
    to: "2026-07-06",
    q: "lag",
    sentiment: "negative",
    topic: "performance_lag_crash",
    subtopic: "performance_lag_crash:drop_fps",
    urgency: "high",
  };

  assert.deepEqual(applyWorkspaceFilter(current, "sentiment", "positive"), {
    ...current,
    sentiment: "positive",
    topic: "",
    subtopic: "",
  });
});

test("changing topic resets subtopic while keeping sentiment", () => {
  const current = {
    from: "2026-06-29",
    to: "2026-07-06",
    q: "",
    sentiment: "negative",
    topic: "performance_lag_crash",
    subtopic: "performance_lag_crash:drop_fps",
    urgency: "",
  };

  assert.deepEqual(applyWorkspaceFilter(current, "topic", "hack_cheat"), {
    ...current,
    topic: "hack_cheat",
    subtopic: "",
  });
});

test("topic options follow the filtered ranking before falling back to static labels", () => {
  const options = buildTopicOptions(
    {
      performance_lag_crash: "Hiệu năng/Lag/Crash",
      hack_cheat: "Hack/Cheat",
      bug: "Lỗi (Bug)",
    },
    [
      { topic: "hack_cheat", label: "Hack/Cheat", count: 8 },
      { topic: "performance_lag_crash", label: "Hiệu năng/Lag/Crash", count: 5 },
    ]
  );

  assert.deepEqual(options, [
    { key: "hack_cheat", label: "Hack/Cheat", count: 8 },
    { key: "performance_lag_crash", label: "Hiệu năng/Lag/Crash", count: 5 },
    { key: "bug", label: "Lỗi (Bug)", count: 0 },
  ]);
});

test("topic options can hide static topics when sentiment narrows the hierarchy", () => {
  const options = buildTopicOptions(
    {
      performance_lag_crash: "Hiệu năng/Lag/Crash",
      hack_cheat: "Hack/Cheat",
      bug: "Lỗi (Bug)",
    },
    [
      { topic: "hack_cheat", label: "Hack/Cheat", count: 8 },
      { topic: "performance_lag_crash", label: "Hiệu năng/Lag/Crash", count: 5 },
    ],
    { includeEmpty: false }
  );

  assert.deepEqual(options, [
    { key: "hack_cheat", label: "Hack/Cheat", count: 8 },
    { key: "performance_lag_crash", label: "Hiệu năng/Lag/Crash", count: 5 },
  ]);
});
