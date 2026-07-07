import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./Dashboard.jsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../api/client.js", import.meta.url), "utf8");

test("Dashboard exposes an HTML report export modal for Store and Facebook", () => {
  assert.match(apiSource, /exportReportHtmlUrl/);
  assert.match(apiSource, /\/api\/report\/html/);
  assert.match(source, /const \[reportDialogOpen, setReportDialogOpen\]/);
  assert.match(source, /function ReportExportDialog/);
  assert.match(source, /report-export-warning/);
  assert.match(source, /Việc xuất report sẽ mất kha khá thời gian/);
  assert.match(source, /gom comment và mention/);
  assert.match(source, /gọi LLM phân tích và viết HTML/);
  assert.match(source, /group: "store"/);
  assert.match(source, /group: "facebook"/);
  assert.match(source, /Xuất report HTML/);
  assert.match(source, /Store report/);
  assert.match(source, /Facebook report/);
  assert.match(source, /exportReportHtmlUrl/);
});
