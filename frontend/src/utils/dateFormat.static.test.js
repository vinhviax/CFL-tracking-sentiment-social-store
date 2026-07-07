import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const srcDir = fileURLToPath(new URL("../", import.meta.url));

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

test("frontend date UI does not use browser-locale date formatting", () => {
  const files = listFiles(srcDir).filter((file) => /\.(jsx|js)$/.test(file) && !file.endsWith(".test.js"));
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const nonDatePickerSource = files
    .filter((file) => !file.endsWith("DateTextInput.jsx"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  assert.doesNotMatch(nonDatePickerSource, /type="date"/);
  assert.doesNotMatch(source, /toLocaleDateString\("vi-VN"\)/);
  assert.doesNotMatch(source, /new Date\([^)]*\)\.toLocaleString\("vi-VN"\)/);
});
