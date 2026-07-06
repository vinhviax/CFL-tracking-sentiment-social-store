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
  assert.match(source, /enqueueTrackedJobs/);
  assert.match(source, /auto\.analysis_progress_key/);
  assert.match(source, /auto\.translation_progress_key/);
  assert.match(source, /unknownTries/);
  assert.doesNotMatch(source, /\["done", "failed", "unknown"\]/);
  assert.match(source, /uploadCsv\(file\)[\s\S]*trackAutoProcessing\(run\)/);
  assert.match(source, /ingestSensorTower\(stRange\)[\s\S]*trackAutoProcessing\(run\)/);
  assert.match(source, /ingestFacebook\(\{[\s\S]*since: stRange\.start_date[\s\S]*trackAutoProcessing\(run\)/);
  assert.doesNotMatch(source, /ingestSensorTower\(stRange\)[\s\S]{0,100}startAnalyze\(run\)/);
  assert.doesNotMatch(source, /ingestFacebook\(\{[\s\S]{0,200}startAnalyze\(run\)/);
});

test("Facebook Fanpage ingest submits the selected date range", () => {
  assert.match(source, /const FACEBOOK_POST_LIMIT = 50/);
  assert.match(source, /ingestFacebook\(\{\s*since: stRange\.start_date/);
  assert.match(source, /until: stRange\.end_date/);
  assert.match(source, /post_limit: FACEBOOK_POST_LIMIT/);
  assert.doesNotMatch(source, /ingestFacebook\(\{\}\)/);
});

test("Ingest Settings always renders latest data status for Store, Fanpage, and Group", () => {
  assert.match(source, /function SourceStatusStrip/);
  assert.match(source, /ingestStatus\?\.source_status/);
  assert.match(source, /source-status-strip/);
  assert.match(source, /Store/);
  assert.match(source, /Fanpage/);
  assert.match(source, /Group CSV/);
  assert.match(source, /loadIngestStatus/);
});

test("processing area tracks multiple queued jobs instead of one overwritten key", () => {
  assert.match(source, /const \[trackedJobs, setTrackedJobs\]/);
  assert.match(source, /function enqueueTrackedJobs\(jobs\)/);
  assert.match(source, /const loadTrackedJobs = useCallback/);
  assert.match(source, /listProcessingJobs/);
  assert.match(source, /trackedJobs\.map/);
  assert.match(source, /TrackedProgressJob/);
  assert.doesNotMatch(source, /const \[progressKey, setProgressKey\]/);
  assert.doesNotMatch(source, /const \[translateKey, setTranslateKey\]/);
});

test("processing queue jobs can be cancelled from each tracked row", () => {
  assert.match(source, /cancelProcessingJob/);
  assert.match(source, /const \[cancellingJobIds, setCancellingJobIds\]/);
  assert.match(source, /function cancelTrackedJob\(job\)/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /cancelProcessingJob\(job\.id\)/);
  assert.match(source, /id: job\.id/);
  assert.match(source, /status: job\.status/);
  assert.match(source, /className="btn btn-danger progress-cancel-button"/);
  assert.match(source, /onCancel=\{cancelTrackedJob\}/);
});

test("tracked processing rows show recent LLM batch logs", () => {
  assert.match(source, /listProcessingJobLogs/);
  assert.match(source, /function useProcessingLogs\(jobId/);
  assert.match(source, /function ProcessingLogList/);
  assert.match(source, /className="llm-log-list"/);
  assert.match(source, /formatLogDuration/);
  assert.match(source, /log\.provider/);
  assert.match(source, /log\.batch_index/);
});

test("Ingest Settings exposes LLM Agent configuration for reasoning and simple slots", () => {
  assert.match(source, /getLlmAgentConfig/);
  assert.match(source, /saveLlmAgentConfig/);
  assert.match(source, /function LlmAgentConfigDialog/);
  assert.match(source, /Cấu hình LLM Agent/);
  assert.match(source, /reasoning/);
  assert.match(source, /simple/);
  assert.match(source, /providerOptions/);
  assert.match(source, /api_key/);
  assert.match(source, /endpoint_url/);
});

test("manual run translation does not cap large ingest runs", () => {
  assert.match(source, /runTranslate\(\{ run_id: target\.id, locale: "zh-CN" \}\)/);
  assert.doesNotMatch(source, /runTranslate\(\{ run_id: target\.id, locale: "zh-CN", limit: 300 \}\)/);
});

test("CSV preview makes Facebook Group filtering visible before upload", () => {
  assert.match(source, /preview\.group_rows/);
  assert.match(source, /preview\.skipped_non_group_rows/);
  assert.match(source, /preview\.group_rows === 0/);
  assert.match(source, /preview\.data_start_date/);
  assert.match(source, /preview\.data_end_date/);
});

test("ingest history prefers the requested pull range when it is available", () => {
  assert.match(source, /run\.source_type === "fb_page"/);
  assert.match(source, /note\.start_date \|\| note\.end_date/);
  assert.match(source, /run\.data_start_date/);
  assert.match(source, /run\.data_end_date/);
  assert.ok(
    source.indexOf('run.source_type === "fb_page"') <
      source.indexOf("note.start_date || note.end_date") &&
      source.indexOf("note.start_date || note.end_date") <
      source.indexOf("run.data_start_date || run.data_end_date")
  );
});

test("ingest history can delete a run with an explicit confirmation", () => {
  assert.match(source, /deleteIngestRun/);
  assert.match(source, /function deleteRun\(run\)/);
  assert.match(source, /window\.prompt/);
  assert.match(source, /answer !== "XOA"/);
  assert.match(source, /deleteIngestRun\(run\.id\)/);
  assert.match(source, /className="btn btn-danger run-action-button"/);
});
