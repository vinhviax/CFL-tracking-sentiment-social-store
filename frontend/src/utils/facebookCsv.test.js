import assert from "node:assert/strict";
import test from "node:test";
import { buildCsvPreview, parseRows } from "./facebookCsv.js";

const HEADER = "Source\tPost Published Date\tPost Message\tCreated Date\tComment Message\tTopic";

function utf8(text) {
  return new TextEncoder().encode(text).buffer;
}

function utf16le(text) {
  // The real export is UTF-16 LE with a BOM, which is the branch that matters.
  const withBom = `﻿${text}`;
  const buf = new ArrayBuffer(withBom.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < withBom.length; i++) view.setUint16(i * 2, withBom.charCodeAt(i), true);
  return buf;
}

// Mirrors worker/src/services/csvIngest.test.js so a change to one parser that is
// not made to the other shows up as a failing test rather than a wrong preview.
test("parses columns A to E only and ignores source labels in later columns", () => {
  const csv = [
    HEADER,
    "Group\t6/7/2026 13:28\tAi cho minh xin 6 manh\t6/7/2026 15:07\tNgoc Phuong cho toi xin manh con voi\titem_skin",
    "Fanpage\t6/7/2026 14:00\tCHỈ CẦN comment nhận code\t6/7/2026 15:08\tVNG nay chiều ae thế\tpositive",
  ].join("\n");

  assert.deepEqual(parseRows(utf8(csv)), [
    {
      source: "Group",
      postPublished: "6/7/2026 13:28",
      postMessage: "Ai cho minh xin 6 manh",
      createdDate: "6/7/2026 15:07",
      commentMessage: "Ngoc Phuong cho toi xin manh con voi",
    },
    {
      source: "Fanpage",
      postPublished: "6/7/2026 14:00",
      postMessage: "CHỈ CẦN comment nhận code",
      createdDate: "6/7/2026 15:08",
      commentMessage: "VNG nay chiều ae thế",
    },
  ]);
});

test("reads the real UTF-16 LE export, not just a UTF-8 re-save", () => {
  const csv = [HEADER, "Group\t6/7/2026\tbai viet\t6/7/2026\tlag qua\ttopic"].join("\n");
  const preview = buildCsvPreview(utf16le(csv));
  assert.equal(preview.total_rows, 1);
  assert.equal(preview.group_rows, 1);
  assert.equal(preview.sample[0].comment_message, "lag qua");
});

test("keeps quoted fields containing tabs and newlines in one row", () => {
  const csv = [
    HEADER,
    'Fanpage\t6/7/2026\t"dong 1\ndong 2\tco tab"\t6/7/2026\t"comment\nnhieu dong"\ttopic',
  ].join("\n");

  const rows = parseRows(utf8(csv));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].postMessage, "dong 1\ndong 2\tco tab");
  assert.equal(rows[0].commentMessage, "comment\nnhieu dong");
});

test("unescapes a doubled quote inside a quoted field", () => {
  const csv = [HEADER, 'Group\t6/7/2026\t"noi ""nguyen van"" day"\t6/7/2026\tok\ttopic'].join("\n");
  assert.equal(parseRows(utf8(csv))[0].postMessage, 'noi "nguyen van" day');
});

test("counts Fanpage and Group rows and skips anything else", () => {
  const csv = [
    HEADER,
    "Group\t6/7/2026\tp\t6/7/2026\tlag\ttopic",
    "Fanpage\t6/7/2026\tp\t6/7/2026\tevent\ttopic",
    " group \t6/7/2026\tp\t6/7/2026\thack\ttopic",
    " fanpage \t6/7/2026\tp\t6/7/2026\tcode\ttopic",
    "Store\t6/7/2026\tp\t6/7/2026\tskip\ttopic",
  ].join("\n");

  const preview = buildCsvPreview(utf8(csv));
  assert.equal(preview.total_rows, 5);
  assert.equal(preview.fanpage_rows, 2);
  assert.equal(preview.group_rows, 2);
  assert.equal(preview.importable_rows, 4);
  assert.equal(preview.skipped_non_group_rows, 1);
});

test("reports the first and last comment date, ignoring unparseable ones", () => {
  const csv = [
    HEADER,
    "Fanpage\t\tp\t6/7/2026\tevent\ttopic",
    "Group\t\tp\t4/7/2026 08:30:00\thack\ttopic",
    "Group\t\tp\tbad date\tignored\ttopic",
  ].join("\n");

  const preview = buildCsvPreview(utf8(csv));
  assert.equal(preview.data_start_date, "2026-07-04");
  assert.equal(preview.data_end_date, "2026-07-06");
});

test("accepts an ISO created date as well as dd/mm/yyyy", () => {
  const csv = [HEADER, "Group\t\tp\t2026-07-15T10:00:00\tok\ttopic"].join("\n");
  const preview = buildCsvPreview(utf8(csv));
  assert.equal(preview.data_start_date, "2026-07-15");
});

test("drops the header row only when column A says Source", () => {
  const noHeader = ["Group\t6/7/2026\tp\t6/7/2026\tlag\ttopic"].join("\n");
  assert.equal(parseRows(utf8(noHeader)).length, 1);
  assert.equal(parseRows(utf8([HEADER, "Group\t6/7/2026\tp\t6/7/2026\tlag\ttopic"].join("\n"))).length, 1);
});

test("ignores rows with fewer than five columns", () => {
  const csv = [HEADER, "Group\t6/7/2026\tp", "Group\t6/7/2026\tp\t6/7/2026\tlag\ttopic"].join("\n");
  assert.equal(parseRows(utf8(csv)).length, 1);
});

test("caps the sample at ten rows and truncates long text", () => {
  const long = "x".repeat(500);
  const body = Array.from({ length: 15 }, () => `Group\t6/7/2026\t${long}\t6/7/2026\t${long}\ttopic`);
  const preview = buildCsvPreview(utf8([HEADER, ...body].join("\n")));
  assert.equal(preview.total_rows, 15);
  assert.equal(preview.sample.length, 10);
  assert.equal(preview.sample[0].post_message.length, 200);
  assert.equal(preview.sample[0].comment_message.length, 200);
});

test("an empty file previews as zero rows rather than throwing", () => {
  const preview = buildCsvPreview(utf8(""));
  assert.equal(preview.total_rows, 0);
  assert.equal(preview.importable_rows, 0);
  assert.equal(preview.data_start_date, null);
  assert.deepEqual(preview.sample, []);
});

test("handles CRLF line endings", () => {
  const csv = [HEADER, "Group\t6/7/2026\tp\t6/7/2026\tlag\ttopic"].join("\r\n");
  const rows = parseRows(utf8(csv));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].commentMessage, "lag");
});
