import type { Env } from "../types";
import { runAnalysis } from "./analysis";
import { discoverAndStoreRunMemory } from "./taxonomyMemory";
import { DEFAULT_TRANSLATION_LOCALE, runTranslation } from "./translation";

type AnalysisRunner = typeof runAnalysis;
type MemoryRunner = typeof discoverAndStoreRunMemory;
type TranslationRunner = typeof runTranslation;

interface AutomatedProcessingDeps {
  runAnalysis: AnalysisRunner;
  discoverAndStoreRunMemory: MemoryRunner;
  runTranslation: TranslationRunner;
}

const defaultDeps: AutomatedProcessingDeps = {
  runAnalysis,
  discoverAndStoreRunMemory,
  runTranslation,
};

export async function processAutomatedFeedbackRun(
  env: Env,
  opts: {
    runId: number;
    progressPrefix: string;
    locale?: string;
  },
  deps: AutomatedProcessingDeps = defaultDeps
) {
  const locale = opts.locale || DEFAULT_TRANSLATION_LOCALE;
  const analysis = await deps.runAnalysis(env, {
    runId: opts.runId,
    progressKey: `${opts.progressPrefix}-analyze-${opts.runId}`,
  });
  const memory = await deps.discoverAndStoreRunMemory(env, {
    runId: opts.runId,
  });
  const translation = await deps.runTranslation(env, {
    runId: opts.runId,
    progressKey: `${opts.progressPrefix}-translate-${opts.runId}`,
    locale,
  });
  return { analysis, memory, translation };
}

export async function processScheduledPendingFeedback(
  env: Env,
  opts: {
    progressPrefix: string;
    progressSuffix?: string;
    locale?: string;
    translationLimit?: number;
  },
  deps: AutomatedProcessingDeps = defaultDeps
) {
  const locale = opts.locale || DEFAULT_TRANSLATION_LOCALE;
  const suffix = opts.progressSuffix || new Date().toISOString().slice(0, 10);
  const analysis = await deps.runAnalysis(env, {
    progressKey: `${opts.progressPrefix}-analyze-${suffix}`,
  });
  const translation = await deps.runTranslation(env, {
    progressKey: `${opts.progressPrefix}-translate-${suffix}`,
    locale,
    limit: opts.translationLimit ?? 1000,
  });
  return { analysis, translation };
}
