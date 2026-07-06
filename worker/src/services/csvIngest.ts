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

export function filterGroupCsvRows(rows: ParsedRow[]): ParsedRow[] {
  return rows.filter((row) => isGroupSource(row.source));
}

export function validateCsvGroupImport(opts: { totalRows: number; groupRows: number; freshRows: number }): void {
  if (opts.groupRows === 0) {
    throw new Error("CSV Facebook Group khong co dong Group hop le o cot A.");
  }
  if (opts.freshRows === 0) {
    throw new Error("CSV Facebook Group khong co comment Group moi de nhap; tat ca da ton tai hoac bi trung trong file.");
  }
}

function buildCsvRunNote(filename: string, stats: { totalRows: number; groupRows: number; skippedNonGroup: number; duplicateRows: number }): string | null {
  if (!filename && stats.skippedNonGroup === 0 && stats.duplicateRows === 0) return null;
  return JSON.stringify({
    text: filename || "Facebook Group CSV",
    filename: filename || null,
    total_rows: stats.totalRows,
    group_rows: stats.groupRows,
    skipped_non_group: stats.skippedNonGroup,
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
    const f = cols.length > 5 ? (cols[5] || "").trim() : null;

    if (!headerSeen) {
      headerSeen = true;
      if (a.toLowerCase() === "source") continue; // skip header row
    }
    rows.push({ source: a, postPublished: b, postMessage: c, createdDate: d, commentMessage: e, legacyTopic: f });
  }
  return rows;
}

export function buildGroupCsvPostExternalId(row: Partial<ParsedRow>): string {
  const key = [
    normalizeIdentityPart(row.postPublished),
    normalizeIdentityPart(row.postMessage),
  ].join("|");
  return `group_csv:${stableHash(key)}`;
}

export function buildGroupCsvDedupeKey(row: Partial<ParsedRow>): string {
  return [
    buildGroupCsvPostExternalId(row),
    normalizeIdentityPart(row.createdDate),
    normalizeIdentityPart(row.commentMessage),
  ].join("|");
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
    const rows = filterGroupCsvRows(allRows);
    rowsCount = rows.length;
    validateCsvGroupImport({ totalRows: allRows.length, groupRows: rows.length, freshRows: rows.length });

    // Resolve dedupe hashes for Group rows only. Fanpage rows from mixed CSV exports are ignored.
    const withHash = await Promise.all(
      rows.map(async (r) => ({
        row: r,
        hash: await hashText(buildGroupCsvDedupeKey(r)),
        legacyHash: await legacyDedupeHash("Group", r.createdDate, r.commentMessage || ""),
      }))
    );

    // Fetch existing hashes once instead of one SELECT per row.
    const existing = new Set<string>();
    for (const c of chunk(withHash, 90)) {
      const hashes = c.flatMap((x) => [x.hash, x.legacyHash]);
      const placeholders = hashes.map(() => "?").join(",");
      const res = await db
        .prepare(`SELECT dedupe_hash FROM comments WHERE dedupe_hash IN (${placeholders})`)
        .bind(...hashes)
        .all<{ dedupe_hash: string }>();
      for (const row of res.results) existing.add(row.dedupe_hash);
    }

    const seen = new Set<string>(existing);
    const fresh = [];
    for (const item of withHash) {
      if (seen.has(item.hash) || seen.has(item.legacyHash)) continue;
      seen.add(item.hash);
      seen.add(item.legacyHash);
      fresh.push(item);
    }
    validateCsvGroupImport({ totalRows: allRows.length, groupRows: rows.length, freshRows: fresh.length });
    dataRange = getCsvDateRange(fresh.map((item) => item.row));
    const duplicateRows = withHash.length - fresh.length;
    note = buildCsvRunNote(filename, {
      totalRows: allRows.length,
      groupRows: rows.length,
      skippedNonGroup: allRows.length - rows.length,
      duplicateRows,
    });

    const runInsert = await db
      .prepare(
        `INSERT INTO ingest_runs (source_type, started_at, status, note) VALUES ('fb_group_csv', ?, 'running', ?)`
      )
      .bind(startedAt, note)
      .run();
    runId = runInsert.meta.last_row_id as number;

    // Resolve/create posts. CSV Group has no Facebook post ID, so use a stable
    // source-local external_id from columns B/C and reuse it across uploads.
    const postCache = new Map<string, number>();
    const postRows = new Map<string, { externalId: string; sourceType: string; publishedAt: string | null; message: string }>();
    for (const { row } of fresh) {
      const pmsg = (row.postMessage || "").trim();
      const published = (row.postPublished || "").trim();
      if (!pmsg && !published) continue;
      const externalId = buildGroupCsvPostExternalId(row);
      if (!postRows.has(externalId)) {
        postRows.set(externalId, { externalId, sourceType: "fb_group_csv", publishedAt: parseVnDate(row.postPublished), message: pmsg });
      }
    }

    const postCandidates = [...postRows.values()];
    for (const c of chunk(postCandidates, 90)) {
      const placeholders = c.map(() => "?").join(",");
      const res = await db
        .prepare(`SELECT id, external_id FROM posts WHERE source_type='fb_group_csv' AND external_id IN (${placeholders})`)
        .bind(...c.map((p) => p.externalId))
        .all<{ id: number; external_id: string }>();
      for (const row of res.results) postCache.set(row.external_id, row.id);
    }

    const postsToInsert = postCandidates.filter((p) => !postCache.has(p.externalId));
    for (const c of chunk(postsToInsert, 50)) {
      const stmts = c.map((p) =>
        db
          .prepare(`INSERT INTO posts (source_type, external_id, published_at, message) VALUES (?, ?, ?, ?)`)
          .bind(p.sourceType, p.externalId, p.publishedAt, p.message)
      );
      const results = await db.batch(stmts);
      results.forEach((r, idx) => postCache.set(c[idx].externalId, r.meta.last_row_id as number));
    }

    // Insert new comments.
    for (const c of chunk(fresh, 100)) {
      const stmts = c.map(({ row, hash }) => {
        const pmsg = (row.postMessage || "").trim();
        const published = (row.postPublished || "").trim();
        const postKey = pmsg || published ? buildGroupCsvPostExternalId(row) : null;
        const postId = postKey ? postCache.get(postKey) ?? null : null;
        const msg = row.commentMessage || "";
        return db
          .prepare(
            `INSERT INTO comments
              (post_id, source_type, created_at, message, legacy_topic, dedupe_hash, ingest_run_id, skipped_analysis)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            postId,
            "fb_group_csv",
            parseVnDate(row.createdDate),
            msg,
            row.legacyTopic,
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
    source_type: "fb_group_csv",
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
