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
