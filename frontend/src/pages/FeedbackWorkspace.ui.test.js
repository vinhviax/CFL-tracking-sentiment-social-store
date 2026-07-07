import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./FeedbackWorkspace.jsx", import.meta.url), "utf8");

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
  assert.match(source, /updateCommentAnalysis\(selected\.id/);
  assert.match(source, /className="manual-review-card"/);
  assert.match(source, /value=\{manualReviewTopic\}/);
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
