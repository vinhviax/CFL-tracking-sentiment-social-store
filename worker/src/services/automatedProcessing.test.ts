import { describe, expect, test, vi } from "vitest";
import { DEFAULT_TRANSLATION_LOCALE } from "./translation";
import { processAutomatedFeedbackRun, processScheduledPendingFeedback } from "./automatedProcessing";

describe("automated cron processing", () => {
  test("classifies a run before translating it", async () => {
    const calls: string[] = [];
    const env = {} as any;
    const deps = {
      runAnalysis: vi.fn(async () => {
        calls.push("analysis");
        return { analyzed: 2, total: 2, provider: "test" };
      }),
      discoverAndStoreRunMemory: vi.fn(async () => {
        calls.push("memory");
        return { run_id: 42, comments: 2, subtopics: 1, evidence: 2, provider: "test", model: "test-model" };
      }),
      runTranslation: vi.fn(async () => {
        calls.push("translation");
        return { translated: 2, total: 2, provider: "test" };
      }),
    };

    const result = await processAutomatedFeedbackRun(env, {
      runId: 42,
      progressPrefix: "scheduled-store",
    }, deps);

    expect(calls).toEqual(["analysis", "memory", "translation"]);
    expect(deps.runAnalysis).toHaveBeenCalledWith(env, {
      runId: 42,
      progressKey: "scheduled-store-analyze-42",
    });
    expect(deps.runTranslation).toHaveBeenCalledWith(env, {
      runId: 42,
      progressKey: "scheduled-store-translate-42",
      locale: DEFAULT_TRANSLATION_LOCALE,
    });
    expect(result).toEqual({
      analysis: { analyzed: 2, total: 2, provider: "test" },
      memory: { run_id: 42, comments: 2, subtopics: 1, evidence: 2, provider: "test", model: "test-model" },
      translation: { translated: 2, total: 2, provider: "test" },
    });
  });

  test("can process pending comments without a run id for scheduled recovery", async () => {
    const env = {} as any;
    const deps = {
      runAnalysis: vi.fn(async () => ({ analyzed: 1, total: 1, provider: "test" })),
      discoverAndStoreRunMemory: vi.fn(async () => ({ run_id: 0, comments: 0, subtopics: 0, evidence: 0, provider: "test", model: "test-model" })),
      runTranslation: vi.fn(async () => ({ translated: 1, total: 1, provider: "test" })),
    };

    await processScheduledPendingFeedback(env, {
      progressPrefix: "scheduled-pending",
      progressSuffix: "2026-07-06",
      translationLimit: 500,
    }, deps);

    expect(deps.runAnalysis).toHaveBeenCalledWith(env, {
      progressKey: "scheduled-pending-analyze-2026-07-06",
    });
    expect(deps.runTranslation).toHaveBeenCalledWith(env, {
      progressKey: "scheduled-pending-translate-2026-07-06",
      locale: DEFAULT_TRANSLATION_LOCALE,
      limit: 500,
    });
    expect(deps.discoverAndStoreRunMemory).not.toHaveBeenCalled();
  });
});
