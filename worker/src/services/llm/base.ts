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

export interface LLMProvider {
  name: string;
  model: string;
  /** Ask for a JSON response (array/object). Provider may enforce JSON mode. */
  completeJson(system: string, user: string): Promise<string>;
  /** Ask for free-form text (no JSON mode) — used for the insight summary. */
  completeText(system: string, user: string): Promise<string>;
}

export { TOPICS };
