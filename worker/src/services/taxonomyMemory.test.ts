import { describe, expect, test } from "vitest";
import {
  extractRepeatedSubtopicCandidates,
  MEMORY_ACTIVE_EVIDENCE_THRESHOLD,
  nextSubtopicStatus,
  normalizeSubtopicKey,
  parseSubtopicDiscoveryResults,
} from "./taxonomyMemory";

describe("taxonomy memory helpers", () => {
  test("normalizes Vietnamese subtopic labels into stable parent-scoped keys", () => {
    expect(normalizeSubtopicKey("gameplay_mode_map", "Cơ chế đặt bom / gỡ bom")).toBe("gameplay_mode_map:co_che_dat_bom_go_bom");
    expect(normalizeSubtopicKey("lag_fps", "Giật, lag & drop FPS!!!")).toBe("lag_fps:giat_lag_drop_fps");
  });

  test("parses LLM subtopic discovery output and deduplicates evidence comment ids", () => {
    const parsed = parseSubtopicDiscoveryResults(JSON.stringify({
      subtopics: [
        {
          parent_topic: "gameplay_mode_map",
          label_vi: "Cơ chế đặt bom",
          label_zh_cn: "安装炸弹机制",
          description: "Người chơi phàn nàn thao tác đặt/gỡ bom.",
          comment_ids: [1, 1, "2", "bad"],
          confidence: 0.82,
          novelty: "new",
        },
      ],
    }));

    expect(parsed).toEqual([
      {
        parent_topic: "gameplay_mode_map",
        label_vi: "Cơ chế đặt bom",
        label_zh_cn: "安装炸弹机制",
        description: "Người chơi phàn nàn thao tác đặt/gỡ bom.",
        comment_ids: [1, 2],
        confidence: 0.82,
        novelty: "new",
      },
    ]);
  });

  test("keeps weak novel signals pending and auto-activates repeated subtopics", () => {
    expect(nextSubtopicStatus(0, MEMORY_ACTIVE_EVIDENCE_THRESHOLD - 1)).toBe("pending");
    expect(nextSubtopicStatus(1, MEMORY_ACTIVE_EVIDENCE_THRESHOLD - 1)).toBe("active");
  });

  test("extracts repeated phrases in a run as subtopic candidates", () => {
    const candidates = extractRepeatedSubtopicCandidates([
      memoryComment(1, "Đặt bom bị lỗi, đặt bom quá chậm"),
      memoryComment(2, "Cơ chế đặt bom khó chịu trong map này"),
      memoryComment(3, "Nút đặt bom không ăn, thua oan"),
      memoryComment(4, "Gỡ bom bị khựng nhưng đặt bom vẫn là vấn đề"),
    ] as any);

    const bomb = candidates.find((candidate) => candidate.label_vi === "đặt bom");
    expect(bomb?.parent_topic).toBe("gameplay_mode_map");
    expect(bomb?.comment_ids).toEqual([1, 2, 3, 4]);
    expect(bomb?.novelty).toBe("emerging");
  });

  test("does not promote generic major-topic words into subtopics", () => {
    const candidates = extractRepeatedSubtopicCandidates([
      memoryComment(1, "Lag quá lag không chơi nổi", "lag_fps"),
      memoryComment(2, "Vẫn lag sau update", "lag_fps"),
      memoryComment(3, "Lag giật liên tục", "lag_fps"),
    ] as any);

    expect(candidates.some((candidate) => candidate.label_vi.includes("lag"))).toBe(false);
  });
});

function memoryComment(id: number, message: string, topic_main = "gameplay_mode_map") {
  return {
    id,
    message,
    created_at: null,
    source_type: "store",
    topic_main,
    sentiment: "negative",
    urgency: "medium",
    summary: null,
    other_suggested: null,
  };
}
