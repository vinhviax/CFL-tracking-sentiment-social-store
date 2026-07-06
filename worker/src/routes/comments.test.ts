import { describe, expect, test } from "vitest";
import { mapCommentRow } from "./comments";

describe("mapCommentRow", () => {
  const baseRow = {
    id: 10,
    source_type: "store",
    created_at: "2026-07-05T08:00:00.000Z",
    message: "Game bị lag sau bản cập nhật",
    rating: 2,
    country: "VN",
    store: "gp",
    legacy_topic: null,
    post_id: null,
    topic_main: "performance_lag_crash",
    topics_sub: "[]",
    sentiment: "negative",
    urgency: "medium",
    summary: "Người chơi phàn nàn game bị lag sau cập nhật.",
    other_suggested: null,
    confidence: 0.9,
    provider: "llm_viax",
    model: "ag/gemini-3-flash-agent",
    message_translated: "更新后游戏卡顿",
    summary_translated: "玩家抱怨更新后游戏卡顿。",
    dynamic_subtopics: [
      {
        key: "performance_lag_crash:drop_fps_khi_combat",
        parent_topic: "performance_lag_crash",
        label: "Drop FPS khi combat",
        label_vi: "Drop FPS khi combat",
        label_zh_cn: "战斗时掉帧",
        confidence: 0.86,
        status: "active",
      },
    ],
  };

  test("returns zh-CN translated message and summary while preserving originals", () => {
    const got = mapCommentRow(baseRow, "zh-CN");

    expect(got.message).toBe("更新后游戏卡顿");
    expect(got.message_original).toBe("Game bị lag sau bản cập nhật");
    expect(got.analysis?.summary).toBe("玩家抱怨更新后游戏卡顿。");
    expect(got.analysis?.summary_original).toBe("Người chơi phàn nàn game bị lag sau cập nhật.");
    expect(got.analysis?.subtopics_dynamic?.[0]).toMatchObject({
      key: "performance_lag_crash:drop_fps_khi_combat",
      label: "战斗时掉帧",
    });
  });

  test("falls back to Vietnamese text when zh-CN translation is missing", () => {
    const got = mapCommentRow({ ...baseRow, message_translated: null, summary_translated: null }, "zh-CN");

    expect(got.message).toBe("Game bị lag sau bản cập nhật");
    expect(got.analysis?.summary).toBe("Người chơi phàn nàn game bị lag sau cập nhật.");
  });
});
