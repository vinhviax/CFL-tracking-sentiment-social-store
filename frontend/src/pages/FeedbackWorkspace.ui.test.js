import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./FeedbackWorkspace.jsx", import.meta.url), "utf8");

test("workspace exposes header HTML report export with source, date, and language options", () => {
  assert.match(source, /exportReportHtmlUrl/);
  assert.match(source, /reportDialogOpen/);
  assert.match(source, /aria-label="Xuất report HTML"/);
  assert.match(source, /Xuất report HTML/);
  assert.match(source, /report-export-header-button/);
  assert.match(source, /report-export-form/);
  assert.match(source, /value="all"/);
  assert.match(source, /value="store"/);
  assert.match(source, /value="facebook"/);
  assert.match(source, /useState\("all"\)/);
  assert.match(source, /lang: reportLang/);
  assert.match(source, /value="both"/);
  assert.match(source, /DateTextInput value=\{reportFrom\}/);
  assert.ok(source.indexOf("report-export-header-button") < source.indexOf("insight-workbench"));
});

test("Facebook comments show parent post context in the table and drawer", () => {
  assert.match(source, /function postContextLabel\(row\)/);
  assert.match(source, /row\.post\?\.message/);
  assert.match(source, /row\.post\?\.permalink/);
  assert.match(source, /<th>\{t\.post\}<\/th>/);
  assert.match(source, /postContextLabel\(row\)/);
  assert.match(source, /selected\.post/);
  assert.match(source, /href=\{selected\.post\.permalink\}/);
});

test("workspace supports human review of Other topic comments", () => {
  assert.match(source, /updateCommentAnalysis/);
  assert.match(source, /reviewOther/);
  assert.match(source, /function reviewOtherComments\(\)/);
  assert.match(source, /setFilters\(\(current\) => applyWorkspaceFilter\(current, "topic", "other"\)\)/);
  assert.match(source, /manualReviewTopic/);
  assert.match(source, /manualReviewNote/);
  assert.match(source, /updateCommentAnalysis\(selected\.id/);
  assert.match(source, /note: manualReviewNote/);
  assert.match(source, /className="manual-review-card"/);
  assert.match(source, /value=\{manualReviewTopic\}/);
  assert.match(source, /textarea/);
  assert.match(source, /value=\{manualReviewNote\}/);
});

test("drawer keeps Facebook post context visible while human reviews a topic", () => {
  assert.ok(source.indexOf("{selected.post &&") < source.indexOf("manual-review-card"));
  assert.match(source, /\{t\.postContext\}/);
  assert.match(source, /selected\.post\.message/);
});

test("comment drawer shortens provider-prefixed model names", () => {
  assert.match(source, /function formatModelName\(model\)/);
  assert.match(source, /formatModelName\(selected\.analysis\?\.model\)/);
  assert.doesNotMatch(source, /selected\.analysis\?\.model \|\| "â€”"/);
});
