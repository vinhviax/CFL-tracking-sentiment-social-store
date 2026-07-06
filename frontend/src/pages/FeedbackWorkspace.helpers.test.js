import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkspaceFilter, buildTopicOptions } from "./FeedbackWorkspace.helpers.js";

test("changing sentiment resets topic and subtopic filters", () => {
  const current = {
    from: "2026-06-29",
    to: "2026-07-06",
    q: "lag",
    sentiment: "negative",
    topic: "lag_fps",
    subtopic: "lag_fps:drop_fps",
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
    topic: "lag_fps",
    subtopic: "lag_fps:drop_fps",
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
      lag_fps: "Lag/Giật/Tụt FPS",
      hack_cheat: "Hack/Cheat",
      technical_other: "Lỗi kỹ thuật khác",
    },
    [
      { topic: "hack_cheat", label: "Hack/Cheat", count: 8 },
      { topic: "lag_fps", label: "Lag/Giật/Tụt FPS", count: 5 },
    ]
  );

  assert.deepEqual(options, [
    { key: "hack_cheat", label: "Hack/Cheat", count: 8 },
    { key: "lag_fps", label: "Lag/Giật/Tụt FPS", count: 5 },
    { key: "technical_other", label: "Lỗi kỹ thuật khác", count: 0 },
  ]);
});

test("topic options can hide static topics when sentiment narrows the hierarchy", () => {
  const options = buildTopicOptions(
    {
      lag_fps: "Lag/Giật/Tụt FPS",
      hack_cheat: "Hack/Cheat",
      technical_other: "Lỗi kỹ thuật khác",
    },
    [
      { topic: "hack_cheat", label: "Hack/Cheat", count: 8 },
      { topic: "lag_fps", label: "Lag/Giật/Tụt FPS", count: 5 },
    ],
    { includeEmpty: false }
  );

  assert.deepEqual(options, [
    { key: "hack_cheat", label: "Hack/Cheat", count: 8 },
    { key: "lag_fps", label: "Lag/Giật/Tụt FPS", count: 5 },
  ]);
});
