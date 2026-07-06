import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./IngestSettings.jsx", import.meta.url), "utf8");

test("ingest history uses a compact horizontal action group", () => {
  assert.match(source, /className="run-actions-head"/);
  assert.match(source, /className="run-actions-cell"/);
  assert.match(source, /className="run-action-group"/);
  assert.match(source, /className="btn btn-secondary run-action-button"/);
  assert.match(source, /run-action-button" onClick=\{\(\) => startAnalyze\(run\)\}/);
  assert.match(source, /run-action-button" onClick=\{\(\) => startTranslate\(run\)\}/);
});

test("manual ingest follows the automatic processing queue returned by the Worker", () => {
  assert.match(source, /function trackAutoProcessing\(run\)/);
  assert.match(source, /run\?\.auto_processing/);
  assert.match(source, /setProgressKey\(auto\.analysis_progress_key\)/);
  assert.match(source, /setQueuedTranslateKey\(auto\.translation_progress_key \|\| null\)/);
  assert.match(source, /unknownTries/);
  assert.doesNotMatch(source, /\["done", "failed", "unknown"\]/);
  assert.match(source, /uploadCsv\(file\)[\s\S]*trackAutoProcessing\(run\)/);
  assert.match(source, /ingestSensorTower\(stRange\)[\s\S]*trackAutoProcessing\(run\)/);
  assert.match(source, /ingestFacebook\(\{\}\)[\s\S]*trackAutoProcessing\(run\)/);
  assert.doesNotMatch(source, /ingestSensorTower\(stRange\)[\s\S]{0,100}startAnalyze\(run\)/);
  assert.doesNotMatch(source, /ingestFacebook\(\{\}\)[\s\S]{0,100}startAnalyze\(run\)/);
});

test("CSV preview makes Facebook Group filtering visible before upload", () => {
  assert.match(source, /preview\.group_rows/);
  assert.match(source, /preview\.skipped_non_group_rows/);
  assert.match(source, /preview\.group_rows === 0/);
  assert.match(source, /preview\.data_start_date/);
  assert.match(source, /preview\.data_end_date/);
});

test("ingest history prefers the actual comment date range", () => {
  assert.match(source, /run\.data_start_date/);
  assert.match(source, /run\.data_end_date/);
  assert.match(source, /Dữ liệu:/);
});

test("ingest history can delete a run with an explicit confirmation", () => {
  assert.match(source, /deleteIngestRun/);
  assert.match(source, /function deleteRun\(run\)/);
  assert.match(source, /window\.prompt/);
  assert.match(source, /answer !== "XOA"/);
  assert.match(source, /deleteIngestRun\(run\.id\)/);
  assert.match(source, /className="btn btn-danger run-action-button"/);
});
