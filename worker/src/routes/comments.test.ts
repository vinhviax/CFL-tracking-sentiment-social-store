import { describe, expect, test } from "vitest";
import { commentsRoute, mapCommentRow } from "./comments";

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
    topic_main: "lag_fps",
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
        key: "lag_fps:drop_fps_khi_combat",
        parent_topic: "lag_fps",
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
      key: "lag_fps:drop_fps_khi_combat",
      label: "战斗时掉帧",
    });
  });

  test("falls back to Vietnamese text when zh-CN translation is missing", () => {
    const got = mapCommentRow({ ...baseRow, message_translated: null, summary_translated: null }, "zh-CN");

    expect(got.message).toBe("Game bị lag sau bản cập nhật");
    expect(got.analysis?.summary).toBe("Người chơi phàn nàn game bị lag sau cập nhật.");
  });
  test("includes parent Facebook post context when available", () => {
    const got = mapCommentRow({
      ...baseRow,
      source_type: "fb_page",
      post_id: 77,
      post_external_id: "post_77",
      post_published_at: "2026-07-06T01:00:00.000Z",
      post_message: "Thong bao cap nhat che do moi.",
      post_permalink: "https://facebook.com/post_77",
    });

    expect(got.post).toEqual({
      id: 77,
      external_id: "post_77",
      published_at: "2026-07-06T01:00:00.000Z",
      message: "Thong bao cap nhat che do moi.",
      permalink: "https://facebook.com/post_77",
    });
  });
});

describe("commentsRoute human topic correction", () => {
  test("updates a comment analysis topic and writes an audit row", async () => {
    const calls: Array<{ sql: string; args: any[] }> = [];
    const env = {
      DB: {
        prepare(sql: string) {
          const stmt = {
            args: [] as any[],
            bind(...args: any[]) {
              this.args = args;
              calls.push({ sql, args });
              return this;
            },
            async first() {
              if (sql.includes("FROM comments c") && sql.includes("LEFT JOIN analyses")) {
                return {
                  comment_id: 10,
                  topic_main: "other",
                  topics_sub: "[]",
                };
              }
              return null;
            },
            async run() {
              return { success: true };
            },
          };
          return stmt;
        },
      },
    } as any;

    const res = await commentsRoute.request("/10/analysis", {
      method: "PATCH",
      body: JSON.stringify({ topic_main: "lag_fps", note: "Human says this is lag because FPS drops during combat" }),
    }, env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      comment_id: 10,
      previous_topic_main: "other",
      topic_main: "lag_fps",
      corrected_by: "human",
    });
    expect(calls.some((call) => call.sql.includes("INSERT INTO analysis_corrections"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("INSERT INTO analysis_corrections") && call.args.includes("Human says this is lag because FPS drops during combat"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("UPDATE analyses") && call.args.includes("lag_fps"))).toBe(true);
  });

  test("rejects manual correction to an unknown topic", async () => {
    const res = await commentsRoute.request("/10/analysis", {
      method: "PATCH",
      body: JSON.stringify({ topic_main: "not_a_topic" }),
    }, { DB: {} } as any);

    expect(res.status).toBe(400);
  });
});
