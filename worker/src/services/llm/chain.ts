import type { LLMProvider, LLMResult, LLMUsage } from "./base";

/**
 * Try a chain of providers in order, in-process, before any caller gives up on the
 * LLM entirely.
 *
 * The chain exists because a single misconfigured provider used to take the whole
 * pipeline down to keyword classification without anything visibly failing: a wrong
 * model name returned 403 on every batch for twelve days. Retrying through the house
 * provider absorbs that class of mistake, and reporting the failures makes it visible
 * rather than silent.
 */
export interface ChainAttempt {
  provider: string;
  model: string;
  error: string;
}

export interface ChainOutcome {
  content: string;
  usage?: LLMUsage;
  /** Provider that actually produced the content — not necessarily the first choice. */
  provider: LLMProvider;
  /** Providers that errored before this one answered. Empty on a first-try success. */
  failures: ChainAttempt[];
}

export class AllProvidersFailedError extends Error {
  constructor(public failures: ChainAttempt[]) {
    const detail = failures.map((f) => `${f.provider}/${f.model}: ${f.error}`).join(" | ");
    super(detail || "Không có provider LLM khả dụng");
    this.name = "AllProvidersFailedError";
  }
}

async function runChain(
  chain: LLMProvider[],
  call: (provider: LLMProvider) => Promise<LLMResult>
): Promise<ChainOutcome> {
  const failures: ChainAttempt[] = [];
  for (const provider of chain) {
    try {
      const { content, usage } = await call(provider);
      return { content, usage, provider, failures };
    } catch (e: any) {
      failures.push({
        provider: provider.name,
        model: provider.model,
        error: e?.message || String(e),
      });
    }
  }
  throw new AllProvidersFailedError(failures);
}

export function completeJsonWithFallback(chain: LLMProvider[], system: string, user: string): Promise<ChainOutcome> {
  return runChain(chain, (provider) => provider.completeJson(system, user));
}

export function completeTextWithFallback(chain: LLMProvider[], system: string, user: string): Promise<ChainOutcome> {
  return runChain(chain, (provider) => provider.completeText(system, user));
}
