import { addTopicFilter } from "./topicScope";

export type CommentFilterQuery = Record<string, string | undefined>;

export const EXPORTABLE_SOURCE_TYPES = ["store", "fb_page", "fb_group_csv"] as const;

export function parseSourceTypes(value?: string): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => (EXPORTABLE_SOURCE_TYPES as readonly string[]).includes(item));
}

function dateKey(value?: string | null) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function addDateFilter(
  where: string[],
  params: any[],
  column: string,
  operator: ">=" | "<=",
  value?: string
) {
  const key = dateKey(value);
  if (!key) return;
  where.push(`substr(${column}, 1, 10) ${operator} ?`);
  params.push(key);
}

export function parseSubtopicKeys(value?: string) {
  return String(value || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export interface CommentFilterResult {
  where: string[];
  params: any[];
  error?: string;
}

/**
 * Builds the shared WHERE clause + bind params for comment listing and export,
 * so both surfaces always apply identical filtering. Mirrors the semantics of
 * GET /api/comments query parameters.
 */
export function buildCommentFilters(q: CommentFilterQuery): CommentFilterResult {
  const where: string[] = [];
  const params: any[] = [];

  if (q.source) { where.push("c.source_type = ?"); params.push(q.source); }
  if (q.sources) {
    const sourceTypes = parseSourceTypes(q.sources);
    if (sourceTypes.length) {
      where.push(`c.source_type IN (${sourceTypes.map(() => "?").join(",")})`);
      params.push(...sourceTypes);
    }
  }
  if (q.group === "store") where.push("c.source_type = 'store'");
  if (q.group === "facebook") where.push("c.source_type IN ('fb_page','fb_group_csv')");
  if (q.post_id) { where.push("c.post_id = ?"); params.push(Number(q.post_id)); }
  if (q.store) { where.push("c.store = ?"); params.push(q.store); }
  if (q.q) { where.push("(c.message LIKE ? OR t.message_translated LIKE ?)"); params.push(`%${q.q}%`, `%${q.q}%`); }
  addDateFilter(where, params, "c.created_at", ">=", q.from);
  addDateFilter(where, params, "c.created_at", "<=", q.to);
  addTopicFilter(where, params, q.topic);
  if (q.subtopic) {
    const subtopicKeys = parseSubtopicKeys(q.subtopic);
    if (!subtopicKeys.length) return { where, params, error: "Invalid subtopic filter" };
    const placeholders = subtopicKeys.map(() => "?").join(",");
    where.push(`EXISTS (
      SELECT 1 FROM comment_subtopics cs
      JOIN taxonomy_subtopics st ON st.id = cs.subtopic_id
      WHERE cs.comment_id = c.id AND st.key IN (${placeholders})
    )`);
    params.push(...subtopicKeys);
  }
  if (q.sentiment) { where.push("a.sentiment = ?"); params.push(q.sentiment); }
  if (q.urgency) { where.push("a.urgency = ?"); params.push(q.urgency); }

  return { where, params };
}
