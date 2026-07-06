import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./DateTextInput.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../index.css", import.meta.url), "utf8");

test("DateTextInput exposes a calendar picker button instead of plain text only", () => {
  assert.match(component, /type="date"/);
  assert.match(component, /showPicker/);
  assert.match(component, /aria-label="Chọn ngày"/);
  assert.match(component, /className="date-picker-button"/);
  assert.match(styles, /\.date-input/);
  assert.match(styles, /\.date-picker-button/);
});
