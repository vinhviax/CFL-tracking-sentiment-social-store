// Ported from backend/app/services/csv_ingest.py — same format contract:
// UTF-16 LE w/ BOM, TAB-delimited, only columns A-E used, multi-line quoted fields.
import type { Env } from "../types";

export interface ParsedRow {
  source: string;
  postPublished: string;
  postMessage: string;
  createdDate: string;
  commentMessage: string;
  legacyTopic: string | null;
}

const EMPTY_MARKERS = new Set(["", "...", ".", "-"]);
const CSV_POST_INSERT_BATCH_SIZE = 250;
const CSV_COMMENT_INSERT_BATCH_SIZE = 250;
/** Rows hashed per await, so a big export does not hold N pending digests at once. */
const CSV_HASH_CHUNK_SIZE = 2000;
/** Existing dedupe hashes read per D1 page while scanning the upload's date window. */
const CSV_DEDUPE_SCAN_PAGE_SIZE = 5000;
/**
 * Upload ceiling. Above this a single Worker invocation runs out of memory decoding
 * the file long before it runs out of subrequests, so fail with an actionable message
 * instead of a raw runtime error.
 */
const CSV_MAX_IMPORTABLE_ROWS = 60000;
const FACEBOOK_CSV_SOURCE_TYPES = ["fb_page", "fb_group_csv"] as const;

export function getCsvPostInsertChunkSize(): number {
  return CSV_POST_INSERT_BATCH_SIZE;
}

export function getCsvCommentInsertChunkSize(): number {
  return CSV_COMMENT_INSERT_BATCH_SIZE;
}

export function getCsvMaxImportableRows(): number {
  return CSV_MAX_IMPORTABLE_ROWS;
}

function normalizeIdentityPart(value?: string | null): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isGroupSource(source: string): boolean {
  return source.trim().toLowerCase() === "group";
}

function isFanpageSource(source: string): boolean {
  return source.trim().toLowerCase() === "fanpage";
}

function isFacebookCsvSource(source: string): boolean {
  return isFanpageSource(source) || isGroupSource(source);
}

export function sourceTypeForCsvRow(row: Partial<ParsedRow>): "fb_page" | "fb_group_csv" | null {
  const source = String(row.source || "");
  if (isFanpageSource(source)) return "fb_page";
  if (isGroupSource(source)) return "fb_group_csv";
  return null;
}

export function filterFacebookCsvRows(rows: ParsedRow[]): ParsedRow[] {
  return rows.filter((row) => isFacebookCsvSource(row.source));
}

export function filterGroupCsvRows(rows: ParsedRow[]): ParsedRow[] {
  return rows.filter((row) => isGroupSource(row.source));
}

export function getFacebookCsvSourceCounts(rows: ParsedRow[]) {
  const fanpageRows = rows.filter((row) => isFanpageSource(row.source)).length;
  const groupRows = rows.filter((row) => isGroupSource(row.source)).length;
  const importableRows = fanpageRows + groupRows;
  return {
    fanpage_rows: fanpageRows,
    group_rows: groupRows,
    importable_rows: importableRows,
    skipped_rows: rows.length - importableRows,
  };
}

export function validateCsvGroupImport(opts: { totalRows: number; groupRows: number; freshRows: number }): void {
  if (opts.groupRows === 0) {
    throw new Error("CSV Facebook Group khong co dong Group hop le o cot A.");
  }
  if (opts.freshRows === 0) {
    throw new Error("CSV Facebook Group khong co comment Group moi de nhap; tat ca da ton tai hoac bi trung trong file.");
  }
}

export function validateFacebookCsvSize(importableRows: number): void {
  if (importableRows > CSV_MAX_IMPORTABLE_ROWS) {
    throw new Error(
      `CSV Facebook co ${importableRows} dong hop le, vuot gioi han ${CSV_MAX_IMPORTABLE_ROWS} dong moi lan nap. ` +
        "Hay chia file thanh nhieu phan nho hon roi nap lan luot; nap trung lap la an toan vi comment da co se bi bo qua."
    );
  }
}

export function validateFacebookCsvImport(opts: { totalRows: number; importableRows: number; freshRows: number }): void {
  if (opts.importableRows === 0) {
    throw new Error("CSV Facebook khong co dong Fanpage hoac Group hop le o cot A.");
  }
  if (opts.freshRows === 0) {
    throw new Error("CSV Facebook khong co comment Facebook moi de nhap; tat ca da ton tai hoac bi trung trong file.");
  }
}

function buildCsvRunNote(filename: string, stats: {
  totalRows: number;
  fanpageRows: number;
  groupRows: number;
  skippedRows: number;
  duplicateRows: number;
}): string | null {
  if (!filename && stats.skippedRows === 0 && stats.duplicateRows === 0) return null;
  return JSON.stringify({
    text: filename || "Facebook CSV",
    filename: filename || null,
    total_rows: stats.totalRows,
    fanpage_rows: stats.fanpageRows,
    group_rows: stats.groupRows,
    importable_rows: stats.fanpageRows + stats.groupRows,
    skipped_non_facebook: stats.skippedRows,
    duplicate_rows: stats.duplicateRows,
  });
}

function decodeCsvBytes(raw: ArrayBuffer): string {
  // Known format: UTF-16 LE with BOM. Fall back to UTF-8 if that yields no tabs
  // (e.g. a user re-saves the export as UTF-8 CSV).
  try {
    const utf16 = new TextDecoder("utf-16le").decode(raw);
    if (utf16.includes("\t")) return utf16;
  } catch {
    /* fall through */
  }
  return new TextDecoder("utf-8").decode(raw);
}

/** Minimal TAB-delimited CSV parser supporting quoted fields with embedded tabs/newlines. */
function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    started = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (ch === "\t") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (started && (field !== "" || row.length > 0)) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseRows(raw: ArrayBuffer): ParsedRow[] {
  const text = decodeCsvBytes(raw);
  const rawRows = parseTsv(text);
  const rows: ParsedRow[] = [];
  let headerSeen = false;

  for (const cols of rawRows) {
    if (cols.length < 5) continue;
    const a = (cols[0] || "").trim();
    const b = (cols[1] || "").trim();
    const c = cols[2] || "";
    const d = (cols[3] || "").trim();
    const e = cols[4] || "";

    if (!headerSeen) {
      headerSeen = true;
      if (a.toLowerCase() === "source") continue; // skip header row
    }
    rows.push({ source: a, postPublished: b, postMessage: c, createdDate: d, commentMessage: e, legacyTopic: null });
  }
  return rows;
}

export function buildFacebookCsvPostExternalId(row: Partial<ParsedRow>): string {
  const sourceType = sourceTypeForCsvRow(row) || "facebook_csv";
  const prefix = sourceType === "fb_page" ? "fanpage_csv" : sourceType === "fb_group_csv" ? "group_csv" : "facebook_csv";
  const key = [
    sourceType,
    normalizeIdentityPart(row.postPublished),
    normalizeIdentityPart(row.postMessage),
  ].join("|");
  return `${prefix}:${stableHash(key)}`;
}

export function buildGroupCsvPostExternalId(row: Partial<ParsedRow>): string {
  return buildFacebookCsvPostExternalId({ ...row, source: row.source || "Group" });
}

export function buildFacebookCsvDedupeKey(row: Partial<ParsedRow>): string {
  return [
    buildFacebookCsvPostExternalId(row),
    normalizeIdentityPart(row.createdDate),
    normalizeIdentityPart(row.commentMessage),
  ].join("|");
}

export function buildGroupCsvDedupeKey(row: Partial<ParsedRow>): string {
  return buildFacebookCsvDedupeKey({ ...row, source: row.source || "Group" });
}

function parseVnDate(value: string): string | null {
  const v = (value || "").trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h = "00", mi = "00", s = "00"] = m;
  const pad = (x: string) => x.padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
}

export function getCsvDateRange(rows: ParsedRow[]): { data_start_date: string | null; data_end_date: string | null } {
  const dates = rows
    .map((row) => parseVnDate(row.createdDate)?.slice(0, 10) || null)
    .filter((value): value is string => Boolean(value))
    .sort();
  return {
    data_start_date: dates[0] || null,
    data_end_date: dates.at(-1) || null,
  };
}

/** Shift a YYYY-MM-DD day key by whole days, used to pad the dedupe scan window. */
function shiftDayKey(dayKey: string, days: number): string {
  const shifted = new Date(`${dayKey}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Load the dedupe hashes that could collide with this upload.
 *
 * Sending the upload's own hashes back as bound parameters costs one D1 read per ~45
 * rows (D1 caps bound parameters near 90, and each row carries a current plus a legacy
 * hash), which exhausted the Worker subrequest budget around 30k rows. Scanning the
 * Facebook comments already stored inside the upload's date window costs a handful of
 * paged reads instead, bounded by overlapping history rather than by file size.
 *
 * Both hash formats live in the same `dedupe_hash` column, so the scan covers legacy
 * rows too. `created_at` is NULL when the date column could not be parsed and cannot be
 * filtered by range, so those rows are always included. The window is padded a day on
 * each side because CSV rows are stored as Bangkok local time while the Graph API ingest
 * stores UTC.
 */
export async function loadExistingCsvHashes(
  db: Env["DB"],
  range: { data_start_date: string | null; data_end_date: string | null }
): Promise<Set<string>> {
  const sourcePlaceholders = FACEBOOK_CSV_SOURCE_TYPES.map(() => "?").join(",");
  const params: unknown[] = [...FACEBOOK_CSV_SOURCE_TYPES];
  let where = `source_type IN (${sourcePlaceholders})`;

  if (range.data_start_date && range.data_end_date) {
    where += ` AND (created_at IS NULL OR (created_at >= ? AND created_at < ?))`;
    params.push(`${shiftDayKey(range.data_start_date, -1)}T00:00:00`, `${shiftDayKey(range.data_end_date, 2)}T00:00:00`);
  }

  const existing = new Set<string>();
  let afterId = 0;
  for (;;) {
    const res = await db
      .prepare(
        `SELECT id, dedupe_hash FROM comments WHERE ${where} AND id > ? ORDER BY id LIMIT ${CSV_DEDUPE_SCAN_PAGE_SIZE}`
      )
      .bind(...params, afterId)
      .all<{ id: number; dedupe_hash: string }>();
    const rows = res.results || [];
    for (const row of rows) existing.add(row.dedupe_hash);
    if (rows.length < CSV_DEDUPE_SCAN_PAGE_SIZE) break;
    afterId = rows[rows.length - 1].id;
  }
  return existing;
}

/**
 * Load every post this ingest could reuse, keyed as `sourceType|externalId`.
 *
 * Same reasoning as loadExistingCsvHashes: looking posts up by `external_id IN (...)`
 * costs one read per 90 candidates, which scales with the file. CSV post ids are
 * deterministic and prefixed, so the whole set can be paged in regardless of file size —
 * and there are only ever as many CSV posts as distinct post texts ever uploaded.
 */
export async function loadCsvPostIds(db: Env["DB"]): Promise<Map<string, number>> {
  const cache = new Map<string, number>();
  let afterId = 0;
  for (;;) {
    const res = await db
      .prepare(
        `SELECT id, source_type, external_id FROM posts
         WHERE source_type IN (?,?)
           AND (external_id LIKE 'fanpage_csv:%' OR external_id LIKE 'group_csv:%')
           AND id > ?
         ORDER BY id LIMIT ${CSV_DEDUPE_SCAN_PAGE_SIZE}`
      )
      .bind(...FACEBOOK_CSV_SOURCE_TYPES, afterId)
      .all<{ id: number; source_type: string; external_id: string }>();
    const rows = res.results || [];
    for (const row of rows) cache.set(`${row.source_type}|${row.external_id}`, row.id);
    if (rows.length < CSV_DEDUPE_SCAN_PAGE_SIZE) break;
    afterId = rows[rows.length - 1].id;
  }
  return cache;
}

async function hashText(value: string): Promise<string> {
  const key = value.trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function legacyDedupeHash(source: string, created: string, message: string): Promise<string> {
  return hashText(`${source.trim()}|${created.trim()}|${message.trim()}`);
}

function isEmptyComment(msg: string): boolean {
  return EMPTY_MARKERS.has(msg.trim().toLowerCase()) || msg.trim().length < 2;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function filterFreshUniqueHashes<T extends { hash: string }>(items: T[], existing: Set<string>): T[] {
  const seen = new Set<string>(existing);
  const fresh: T[] = [];
  for (const item of items) {
    if (seen.has(item.hash)) continue;
    seen.add(item.hash);
    fresh.push(item);
  }
  return fresh;
}

export interface IngestRunRow {
  id: number;
  source_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_fetched: number;
  rows_new: number;
  note: string | null;
  error: string | null;
  data_start_date?: string | null;
  data_end_date?: string | null;
}

export async function ingestCsv(env: Env, raw: ArrayBuffer, filename = ""): Promise<IngestRunRow> {
  const db = env.DB;
  const startedAt = new Date().toISOString();

  let runId: number | null = null;
  let rowsCount = 0;
  let newCount = 0;
  let error: string | null = null;
  let note: string | null = null;
  let dataRange: { data_start_date: string | null; data_end_date: string | null } = {
    data_start_date: null,
    data_end_date: null,
  };

  try {
    const allRows = parseRows(raw);
    const sourceCounts = getFacebookCsvSourceCounts(allRows);
    const rows = filterFacebookCsvRows(allRows);
    rowsCount = rows.length;
    validateFacebookCsvImport({ totalRows: allRows.length, importableRows: rows.length, freshRows: rows.length });
    validateFacebookCsvSize(rows.length);

    // Resolve dedupe hashes for Fanpage/Group CSV rows only. Columns after E are deliberately ignored;
    // LLM analysis remains the source of truth for topic/sentiment labels.
    const withHash: { row: ParsedRow; hash: string; legacyHash: string }[] = [];
    for (const part of chunk(rows, CSV_HASH_CHUNK_SIZE)) {
      const hashed = await Promise.all(
        part.map(async (r) => ({
          row: r,
          hash: await hashText(buildFacebookCsvDedupeKey(r)),
          legacyHash: await legacyDedupeHash(sourceTypeForCsvRow(r) === "fb_group_csv" ? "Group" : "Fanpage", r.createdDate, r.commentMessage || ""),
        }))
      );
      for (const item of hashed) withHash.push(item);
    }

    // Read the hashes already stored in this upload's date window, instead of asking D1
    // about each row's hashes — see loadExistingCsvHashes for why.
    const existing = await loadExistingCsvHashes(db, getCsvDateRange(rows));

    const seen = new Set<string>(existing);
    const fresh = [];
    for (const item of withHash) {
      if (seen.has(item.hash) || seen.has(item.legacyHash)) continue;
      seen.add(item.hash);
      seen.add(item.legacyHash);
      fresh.push(item);
    }
    validateFacebookCsvImport({ totalRows: allRows.length, importableRows: rows.length, freshRows: fresh.length });
    dataRange = getCsvDateRange(fresh.map((item) => item.row));
    const duplicateRows = withHash.length - fresh.length;
    note = buildCsvRunNote(filename, {
      totalRows: allRows.length,
      fanpageRows: sourceCounts.fanpage_rows,
      groupRows: sourceCounts.group_rows,
      skippedRows: sourceCounts.skipped_rows,
      duplicateRows,
    });

    const runInsert = await db
      .prepare(
        `INSERT INTO ingest_runs (source_type, started_at, status, note) VALUES ('facebook_csv', ?, 'running', ?)`
      )
      .bind(startedAt, note)
      .run();
    runId = runInsert.meta.last_row_id as number;

    // Resolve/create posts. CSV rows have no Facebook post ID, so use a stable
    // source-local external_id from columns B/C and reuse it across uploads.
    const postCache = await loadCsvPostIds(db);
    const postRows = new Map<string, { externalId: string; sourceType: "fb_page" | "fb_group_csv"; publishedAt: string | null; message: string }>();
    for (const { row } of fresh) {
      const pmsg = (row.postMessage || "").trim();
      const published = (row.postPublished || "").trim();
      if (!pmsg && !published) continue;
      const sourceType = sourceTypeForCsvRow(row);
      if (!sourceType) continue;
      const externalId = buildFacebookCsvPostExternalId(row);
      const postKey = `${sourceType}|${externalId}`;
      if (!postRows.has(postKey)) {
        postRows.set(postKey, { externalId, sourceType, publishedAt: parseVnDate(row.postPublished), message: pmsg });
      }
    }

    const postCandidates = [...postRows.values()];
    const postsToInsert = postCandidates.filter((p) => !postCache.has(`${p.sourceType}|${p.externalId}`));
    for (const c of chunk(postsToInsert, getCsvPostInsertChunkSize())) {
      const stmts = c.map((p) =>
        db
          .prepare(`INSERT INTO posts (source_type, external_id, published_at, message) VALUES (?, ?, ?, ?)`)
          .bind(p.sourceType, p.externalId, p.publishedAt, p.message)
      );
      const results = await db.batch(stmts);
      results.forEach((r, idx) => postCache.set(`${c[idx].sourceType}|${c[idx].externalId}`, r.meta.last_row_id as number));
    }

    // Insert new comments.
    for (const c of chunk(fresh, getCsvCommentInsertChunkSize())) {
      const stmts = c.map(({ row, hash }) => {
        const pmsg = (row.postMessage || "").trim();
        const published = (row.postPublished || "").trim();
        const sourceType = sourceTypeForCsvRow(row);
        if (!sourceType) throw new Error("Invalid Facebook CSV source.");
        const externalId = pmsg || published ? buildFacebookCsvPostExternalId(row) : null;
        const postId = externalId ? postCache.get(`${sourceType}|${externalId}`) ?? null : null;
        const msg = row.commentMessage || "";
        return db
          .prepare(
            `INSERT INTO comments
              (post_id, source_type, created_at, message, legacy_topic, dedupe_hash, ingest_run_id, skipped_analysis)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            postId,
            sourceType,
            parseVnDate(row.createdDate),
            msg,
            null,
            hash,
            runId,
            isEmptyComment(msg) ? 1 : 0
          );
      });
      await db.batch(stmts);
      newCount += c.length;
    }
  } catch (e: any) {
    error = e.message || String(e);
    if (runId != null) {
      await db
        .prepare(`UPDATE ingest_runs SET status=?, rows_fetched=?, rows_new=?, error=?, finished_at=? WHERE id=?`)
        .bind("failed", rowsCount, newCount, error, new Date().toISOString(), runId)
        .run();
    }
    throw new Error(error || "CSV ingest failed.");
  }

  if (runId == null) throw new Error("CSV ingest run was not created.");

  const finishedAt = new Date().toISOString();
  const status = "done";
  await db
    .prepare(`UPDATE ingest_runs SET status=?, rows_fetched=?, rows_new=?, error=?, finished_at=? WHERE id=?`)
    .bind(status, rowsCount, newCount, error, finishedAt, runId)
    .run();

  return {
    id: runId,
    source_type: "facebook_csv",
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    rows_fetched: rowsCount,
    rows_new: newCount,
    note,
    error,
    ...dataRange,
  };
}
