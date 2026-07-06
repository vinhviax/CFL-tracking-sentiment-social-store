import type { Classification, CommentInput } from "./base";
import { rankTopicsByKeywords } from "../topicKeywords";

const NEG_RE = /lag|giật|văng|lỗi|treo|hút máu|không hoạt động|khong hoat dong|không phản hồi|khong phan hoi|không ăn|khong an|rác|tệ|chán|xấu|nát|dở|gà|kém|thất vọng|bực|\bbug\b|crash|\bhack\b|cheat|scam|worst|terrible|awful|p2w|unplayable|toxic/i;
const POS_RE = /mượt|đỉnh|hay|cuốn|vui|thích|tuyệt|ổn|ngon|tốt|yêu|good|great|nice|love|best|fun|awesome|perfect|amazing|đẹp|hài lòng|ủng hộ/i;
const HIGH_URGENCY_RE = /mất tiền|mất acc|mất nick|không vào được|kh vào|scam|lừa đảo|bị khóa|hack tràn lan|trừ tiền|nạp không nhận|lag không chơi được/i;

function countMatches(re: RegExp, text: string): number {
  const m = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
  return m ? m.length : 0;
}

function sentimentOf(text: string, rating?: number | null): string {
  if (rating != null) {
    if (rating <= 2) return "negative";
    if (rating >= 4) return "positive";
  }
  const neg = countMatches(NEG_RE, text);
  const pos = countMatches(POS_RE, text);
  if (neg > pos) return "negative";
  if (pos > neg) return "positive";
  return "neutral";
}

function topicsOf(text: string): string[] {
  return rankTopicsByKeywords(text);
}

export function classifyFallback(item: CommentInput): Classification {
  const text = item.message || "";
  const topics = topicsOf(text);
  const main = topics[0] || (text.length > 3 ? "gameplay" : "other");
  const subs = topics.slice(1, 3);
  const sentiment = sentimentOf(text, item.rating);
  const urgency = HIGH_URGENCY_RE.test(text)
    ? "high"
    : sentiment === "negative" && topics.length > 0
      ? "medium"
      : "none";
  return {
    id: item.id,
    topic_main: main,
    topics_sub: subs,
    sentiment,
    urgency,
    summary: "",
    other_suggested: null,
    confidence: 0.35,
  };
}
