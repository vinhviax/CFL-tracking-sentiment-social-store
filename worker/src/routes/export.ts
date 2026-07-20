import { Hono } from "hono";
import * as XLSX from "xlsx";
import type { Env } from "../types";
import { LEGACY_TOPIC_LABELS_VI, SENTIMENT_LABELS_VI, TOPIC_LABELS_VI } from "../taxonomy";
import { buildCommentFilters, EXPORTABLE_SOURCE_TYPES, parseSourceTypes } from "../services/commentFilters";

export const exportRoute = new Hono<{ Bindings: Env }>();

// Worker builds the whole .xlsx in memory; cap rows to avoid OOM on huge ranges.
const MAX_EXPORT_ROWS = 50000;

const STORE_LABELS_VI: Record<string, string> = { gp: "Google Play", ios: "App Store" };
const SOURCE_LABELS_VI: Record<string, string> = {
  store: "Store",
  fb_page: "Facebook Page",
  fb_group_csv: "Facebook Group",
};
// Excel sheet names are capped at 31 chars and must be unique.
const SHEET_NAMES: Record<string, string> = {
  store: "Store",
  fb_page: "Fanpage",
  fb_group_csv: "Group",
};
const FILE_SCOPE_NAMES: Record<string, string> = {
  store: "Store",
  fb_page: "Fanpage",
  fb_group_csv: "Group",
};

const HEADERS = ["ID", "Nguồn", "Thời gian", "Quốc gia", "Chợ ứng dụng", "Nội dung",
  "Rating", "Chủ đề chính", "Chủ đề phụ", "Sentiment", "Mức độ khẩn cấp",
  "Tóm tắt", "Độ tin cậy", "Link post Facebook"];
const WIDE_COLS = new Set(["Nội dung", "Tóm tắt", "Link post Facebook"]);

function safeSlug(value: string) {
  return value.replace(/[^0-9A-Za-z]/g, "");
}

function rowToCells(r: any) {
  return [
    r.id,
    SOURCE_LABELS_VI[r.source_type] || r.source_type,
    r.created_at || "",
    r.country || "",
    r.store ? (STORE_LABELS_VI[r.store] || r.store) : "",
    r.message,
    r.rating ?? "",
    r.topic_main ? (TOPIC_LABELS_VI[r.topic_main] || LEGACY_TOPIC_LABELS_VI[r.topic_main] || r.topic_main) : "",
    r.topics_sub ? JSON.parse(r.topics_sub).map((t: string) => TOPIC_LABELS_VI[t] || LEGACY_TOPIC_LABELS_VI[t] || t).join(", ") : "",
    r.sentiment ? (SENTIMENT_LABELS_VI[r.sentiment] || r.sentiment) : "",
    r.urgency || "",
    r.summary || "",
    r.confidence != null ? Math.round(r.confidence * 100) / 100 : "",
    r.post_permalink || "",
  ];
}

// Resolve which source types the export should cover. `sources` (from the
// export dialog) wins; otherwise fall back to the legacy group/source params
// so existing callers keep working.
function resolveSources(q: Record<string, string | undefined>): string[] {
  const explicit = parseSourceTypes(q.sources);
  if (explicit.length) return explicit;
  if (q.group === "store") return ["store"];
  if (q.group === "facebook") return ["fb_page", "fb_group_csv"];
  if (q.source && (EXPORTABLE_SOURCE_TYPES as readonly string[]).includes(q.source)) return [q.source];
  return [...EXPORTABLE_SOURCE_TYPES];
}

exportRoute.get("/", async (c) => {
  const q = c.req.query();
  const lang = q.lang === "zh-CN" ? "zh-CN" : "vi";
  const sources = resolveSources(q);

  // Count across all selected sources first so we can reject oversized exports
  // before building anything in memory.
  const countFilter = buildCommentFilters({ ...q, sources: sources.join(","), source: undefined, group: undefined });
  if (countFilter.error) return c.json({ detail: countFilter.error }, 400);
  const countWhere = countFilter.where.length ? `WHERE ${countFilter.where.join(" AND ")}` : "";
  const countRow = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS total
       FROM comments c
       LEFT JOIN analyses a ON a.comment_id = c.id
       LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
       ${countWhere}`
    )
    .bind(lang, ...countFilter.params)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  if (total > MAX_EXPORT_ROWS) {
    return c.json(
      {
        detail: `Số dòng (${total}) vượt giới hạn xuất ${MAX_EXPORT_ROWS}. Vui lòng thu hẹp khoảng thời gian hoặc bớt nguồn/chủ đề.`,
      },
      413
    );
  }

  const wb = XLSX.utils.book_new();
  for (const src of sources) {
    const filter = buildCommentFilters({ ...q, source: src, sources: undefined, group: undefined });
    if (filter.error) return c.json({ detail: filter.error }, 400);
    const whereSql = filter.where.length ? `WHERE ${filter.where.join(" AND ")}` : "";
    const rows = await c.env.DB
      .prepare(
        `SELECT c.id, c.source_type, c.created_at, c.message, c.rating, c.country, c.store,
                p.permalink AS post_permalink,
                a.topic_main, a.topics_sub, a.sentiment, a.urgency, a.summary, a.confidence
         FROM comments c
         LEFT JOIN posts p ON p.id = c.post_id
         LEFT JOIN analyses a ON a.comment_id = c.id
         LEFT JOIN comment_translations t ON t.comment_id = c.id AND t.locale = ?
         ${whereSql}
         ORDER BY c.created_at DESC`
      )
      .bind(lang, ...filter.params)
      .all<any>();

    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows.results.map(rowToCells)]);
    ws["!cols"] = HEADERS.map((h) => ({ wch: WIDE_COLS.has(h) ? 60 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES[src] || src);
  }

  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const scope = sources.length === EXPORTABLE_SOURCE_TYPES.length
    ? "All"
    : sources.map((src) => FILE_SCOPE_NAMES[src] || src).join("-");
  const range = [q.from, q.to].filter(Boolean).map(safeSlug).join("-");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `CFL_Comments_${scope}_${range || stamp}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
