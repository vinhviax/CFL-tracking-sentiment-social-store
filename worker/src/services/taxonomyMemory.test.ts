import { describe, expect, test } from "vitest";
import {
  buildDiscoverySystem,
  extractRepeatedSubtopicCandidates,
  MEMORY_ACTIVE_EVIDENCE_THRESHOLD,
  nextSubtopicStatus,
  normalizeSubtopicKey,
  parseSubtopicDiscoveryResults,
} from "./taxonomyMemory";

describe("taxonomy memory helpers", () => {
  test("prompts discovery to group semantic intents instead of repeated text fragments", () => {
    const prompt = buildDiscoverySystem();

    expect(prompt).toContain("đọc hiểu");
    expect(prompt).toContain("Không tạo chủ đề con chỉ vì một n-gram");
    expect(prompt).toContain("gộp");
    expect(prompt).toContain("Cập nhật/phiên bản mới");
  });

  test("normalizes Vietnamese subtopic labels into stable parent-scoped keys", () => {
    expect(normalizeSubtopicKey("gameplay_mode_map", "Cơ chế đặt bom / gỡ bom")).toBe("gameplay_mode_map:co_che_dat_bom_go_bom");
    expect(normalizeSubtopicKey("lag_fps", "Giật, lag & drop FPS!!!")).toBe("lag_fps:giat_lag_drop_fps");
  });

  test("normalizes semantically equivalent update subtopics into one key", () => {
    expect(normalizeSubtopicKey("update_download", "cap nhat xong")).toBe("update_download:cap_nhat_phien_ban_moi");
    expect(normalizeSubtopicKey("update_download", "phien ban moi")).toBe("update_download:cap_nhat_phien_ban_moi");
    expect(normalizeSubtopicKey("update_download", "cap nhat moi")).toBe("update_download:cap_nhat_phien_ban_moi");
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

  test("collapses overlapping update phrases into one semantic subtopic", () => {
    const candidates = extractRepeatedSubtopicCandidates([
      memoryComment(1, "cap nhat xong lag qua", "update_download"),
      memoryComment(2, "sau khi cap nhat xong game loi", "update_download"),
      memoryComment(3, "phien ban moi giat lag", "update_download"),
      memoryComment(4, "cap nhat moi khong vao game duoc", "update_download"),
    ] as any, 2);

    const updateCandidates = candidates.filter((candidate) => candidate.parent_topic === "update_download");
    expect(updateCandidates).toHaveLength(1);
    expect(updateCandidates[0]).toMatchObject({
      label_vi: "Cập nhật/phiên bản mới",
      comment_ids: [1, 2, 3, 4],
    });
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
