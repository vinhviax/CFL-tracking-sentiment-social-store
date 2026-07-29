import { isSentiment, isTopic, isUrgency, TOPICS } from "../../taxonomy";

export interface CommentInput {
  id: number;
  message: string;
  context?: string | null; // parent post metadata/message, for context
  rating?: number | null;  // store reviews: 1..5
}

export interface Classification {
  id: number;
  topic_main: string;
  topics_sub: string[];
  sentiment: string;
  urgency: string;
  summary: string;
  other_suggested: string | null;
  confidence: number;
}

/** Validate + coerce a raw parsed record into a safe Classification, same rules as the Pydantic model. */
export function validateClassification(raw: any): Classification | null {
  if (typeof raw?.id !== "number") return null;
  const topic_main = isTopic(raw.topic_main) ? raw.topic_main : "other";
  const topics_sub = Array.isArray(raw.topics_sub)
    ? raw.topics_sub.filter((t: string) => isTopic(t)).slice(0, 2)
    : [];
  const sentiment = isSentiment(String(raw.sentiment || "").toLowerCase())
    ? String(raw.sentiment).toLowerCase()
    : "neutral";
  const urgency = isUrgency(String(raw.urgency || "none").toLowerCase())
    ? String(raw.urgency).toLowerCase()
    : "none";
  return {
    id: raw.id,
    topic_main,
    topics_sub,
    sentiment,
    urgency,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    other_suggested: typeof raw.other_suggested === "string" ? raw.other_suggested : null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
  };
}

/** Token counts for one LLM call, normalised across providers. Absent when the provider does not report them. */
export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * Sum two usage records, treating a missing side as "nothing to add" rather than
 * as zero. Returns undefined only when neither side reported anything, so a
 * provider that never reports usage stays distinguishable from one that used 0 tokens.
 */
export function addUsage(a?: LLMUsage, b?: LLMUsage): LLMUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  };
}

export interface LLMResult {
  content: string;
  /**
   * Undefined when the upstream response carried no usage — notably an
   * OpenAI-compatible proxy streaming without `stream_options.include_usage`.
   * Callers must treat missing usage as unknown, never as zero.
   */
  usage?: LLMUsage;
}

export interface LLMProvider {
  name: string;
  model: string;
  /**
   * Ask for a JSON response (array/object). Provider may enforce JSON mode.
   *
   * Usage is returned per call rather than stashed on the provider because one
   * provider instance serves LLM_BATCH_CONCURRENCY concurrent batches; a shared
   * `lastUsage` field would attribute tokens to whichever batch finished last.
   */
  completeJson(system: string, user: string): Promise<LLMResult>;
  /** Ask for free-form text (no JSON mode) — used for the insight summary. */
  completeText(system: string, user: string): Promise<LLMResult>;
}

export { TOPICS };
