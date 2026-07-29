// Client-side preview of a Facebook CSV export, so dropping a file costs no upload.
//
// This is a deliberate port of worker/src/services/csvIngest.ts (decodeCsvBytes,
// parseTsv, parseRows, parseVnDate). The worker still parses the file itself on
// upload — a preview computed in the browser can never be trusted for ingest — so
// the two must agree. If the export format changes, change both; the shape is
// pinned by facebookCsv.test.js, which mirrors the worker's own parser tests.
//
// Format contract: UTF-16 LE with BOM, TAB-delimited, only columns A-E are used,
// quoted fields may contain tabs and newlines.

const SAMPLE_LIMIT = 10;
const SAMPLE_TEXT_LIMIT = 200;

function decodeCsvBytes(buffer) {
  try {
    const utf16 = new TextDecoder("utf-16le").decode(buffer);
    if (utf16.includes("\t")) return utf16;
  } catch {
    /* fall through to UTF-8 */
  }
  return new TextDecoder("utf-8").decode(buffer);
}

/** Minimal TAB-delimited parser supporting quoted fields with embedded tabs/newlines. */
function parseTsv(text) {
  const rows = [];
  let row = [];
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

export function parseRows(buffer) {
  const rawRows = parseTsv(decodeCsvBytes(buffer));
  const rows = [];
  let headerSeen = false;

  for (const cols of rawRows) {
    if (cols.length < 5) continue;
    const a = (cols[0] || "").trim();
    if (!headerSeen) {
      headerSeen = true;
      if (a.toLowerCase() === "source") continue;
    }
    rows.push({
      source: a,
      postPublished: (cols[1] || "").trim(),
      postMessage: cols[2] || "",
      createdDate: (cols[3] || "").trim(),
      commentMessage: cols[4] || "",
    });
  }
  return rows;
}

function sourceKind(source) {
  const value = String(source || "").trim().toLowerCase();
  if (value === "fanpage") return "fanpage";
  if (value === "group") return "group";
  return null;
}

/** dd/mm/yyyy or yyyy-mm-dd to a yyyy-mm-dd day key; null when unparseable. */
function parseDayKey(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Build the same payload the worker's /api/ingest/preview-csv used to return, so the
 * preview UI is unchanged.
 */
export function buildCsvPreview(buffer) {
  const rows = parseRows(buffer);
  const facebookRows = rows.filter((row) => sourceKind(row.source));
  const fanpageRows = rows.filter((row) => sourceKind(row.source) === "fanpage").length;
  const groupRows = rows.filter((row) => sourceKind(row.source) === "group").length;
  const importableRows = fanpageRows + groupRows;
  const skippedRows = rows.length - importableRows;

  const dayKeys = facebookRows
    .map((row) => parseDayKey(row.createdDate))
    .filter(Boolean)
    .sort();

  return {
    total_rows: rows.length,
    fanpage_rows: fanpageRows,
    group_rows: groupRows,
    importable_rows: importableRows,
    skipped_non_group_rows: skippedRows,
    skipped_non_facebook_rows: skippedRows,
    data_start_date: dayKeys[0] || null,
    data_end_date: dayKeys[dayKeys.length - 1] || null,
    sample: facebookRows.slice(0, SAMPLE_LIMIT).map((row) => ({
      source: row.source,
      post_published_date: row.postPublished,
      post_message: row.postMessage.slice(0, SAMPLE_TEXT_LIMIT),
      created_date: row.createdDate,
      comment_message: row.commentMessage.slice(0, SAMPLE_TEXT_LIMIT),
      legacy_topic: null,
    })),
  };
}

/** Read a dropped File and preview it without sending it anywhere. */
export async function previewCsvFile(file) {
  return buildCsvPreview(await file.arrayBuffer());
}
