import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./IngestSettings.jsx", import.meta.url), "utf8");

test("ingest history uses a compact horizontal action group", () => {
  assert.match(source, /className="run-actions-head"/);
  assert.match(source, /className="run-actions-cell"/);
  assert.match(source, /className="run-action-group"/);
  assert.match(source, /className="btn btn-secondary run-action-button"/);
  assert.match(source, /run-action-button"[^>]*onClick=\{\(\) => startAnalyze\(run\)\}/);
  assert.match(source, /run-action-button"[^>]*onClick=\{\(\) => startTranslate\(run\)\}/);
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
  assert.match(source, /ingestFacebook\(\{\s*since: stRange\.start_date/);
  assert.match(source, /until: stRange\.end_date/);
  assert.doesNotMatch(source, /FACEBOOK_POST_LIMIT/);
  assert.doesNotMatch(source, /post_limit:/);
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
  assert.match(source, /sourceStatusDate\(row\)/);
  assert.doesNotMatch(source, /row\.latest_data_date \|\| row\.cursor_date/);
});

test("source status uses the latest pull end date when a source has been pulled through a newer date", () => {
  assert.match(source, /function sourceStatusDate\(row\)/);
  assert.match(source, /row\.latest_run\?\.note/);
  assert.match(source, /note\.end_date/);
  assert.match(source, /row\.latest_data_date/);
  assert.ok(
    source.indexOf("note.end_date") < source.indexOf("return row.latest_data_date")
  );
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

test("failed processing queue jobs can still be cancelled from the queue view", () => {
  assert.match(source, /function canCancelTrackedJob\(job, progress\)/);
  assert.match(source, /!\["done", "cancelled"\]\.includes\(progress\.status\)/);
  assert.doesNotMatch(source, /!\["done", "failed", "cancelled"\]\.includes\(progress\.status\)/);
  assert.match(source, /const canCancel = canCancelTrackedJob\(job, progress\)/);
});

test("ingest history action labels switch to rerun after completed processing", () => {
  assert.match(source, /function analysisRunActionLabel\(run\)/);
  assert.match(source, /run\.analysis_status === "done" \? "Phân tích lại" : "Phân tích"/);
  assert.match(source, /function translationRunActionLabel\(run\)/);
  assert.match(source, /run\.translation_status === "done" \? "Dịch lại" : "Dịch"/);
  assert.match(source, /analysisRunActionLabel\(run\)/);
  assert.match(source, /translationRunActionLabel\(run\)/);
});

test("tracked processing rows show recent LLM batch logs", () => {
  assert.match(source, /listProcessingJobLogs/);
  assert.match(source, /function useProcessingLogs\(jobId/);
  assert.match(source, /function ProcessingLogList/);
  assert.match(source, /className="llm-log-list"/);
  assert.match(source, /formatLogDuration/);
  assert.match(source, /function formatLogModel\(model\)/);
  assert.match(source, /log\.provider/);
  assert.match(source, /log\.batch_index/);
  assert.match(source, /formatLogModel\(log\.model\)/);
  assert.doesNotMatch(source, /` · \$\{log\.model\}`/);
});

test("a queued job that has not been claimed says so instead of showing 0/0 comment", () => {
  // The old view rendered "Đang chờ phân tích ... 0/0 comment" with no logs for a job
  // that was simply behind others in the queue, which read as a hung job.
  assert.match(source, /processingJobPhase\(progress, logs\)/);
  assert.match(source, /caption=\{processingJobCaption\(progress, phase\)\}/);
  assert.match(source, /note=\{processingJobNote\(phase\)\}/);
  assert.match(source, /Đang xếp hàng, chưa tới lượt/);
  assert.match(source, /Tạm dừng giữa lượt/);
  assert.match(source, /chưa có tiến triển mới/);
  assert.match(source, /task đang chờ tới lượt/);
});

test("a job started from a comment list is not labelled as run #null", () => {
  assert.match(source, /if \(!run\?\.id\) return "Task lẻ theo danh sách comment";/);
  assert.doesNotMatch(source, /run: job\.run \|\| \{ id: job\.run_id \}/);
});

test("completed tracked processing rows are removed from the queue view", () => {
  assert.match(source, /function hideCompletedTrackedJob\(job\)/);
  assert.match(source, /if \(progress\?\.status !== "done"\) return;/);
  assert.match(source, /setTimeout\(\(\) => onDone\?\.\(/);
  assert.match(source, /onDone=\{hideCompletedTrackedJob\}/);
  assert.match(source, /item\.progressKey !== job\.progressKey/);
});

test("Ingest Settings exposes LLM Agent configuration for reasoning and simple slots", () => {
  assert.match(source, /getLlmAgentConfig/);
  assert.match(source, /saveLlmAgentConfig/);
  assert.match(source, /function LlmAgentConfigDialog/);
  assert.match(source, /Cấu hình LLM Agent/);
  assert.match(source, /reasoning/);
  assert.match(source, /simple/);
});

test("the provider list comes from the server catalog rather than a hardcoded array", () => {
  // A local list would drift from what the worker will accept, and the old one held
  // provider ids the worker no longer knows.
  assert.doesNotMatch(source, /providerOptions/);
  assert.match(source, /const providers = llmConfig\?\.providers \|\| \[\]/);
  assert.match(source, /providers\.map\(\(option\) => \(/);
  assert.match(source, /providers\.find\(\(p\) => p\.id === form\.provider\)/);
});

test("the override toggle is gone; a slot is just a provider plus a model", () => {
  assert.doesNotMatch(source, /Bật override/);
  assert.doesNotMatch(source, /form\.enabled/);
  assert.doesNotMatch(source, /enabled: form\.enabled/);
});

test("changing provider moves the model to one that provider actually offers", () => {
  // The old form left the previous model in place, so saving after switching
  // provider stored a combination that could not work.
  assert.match(source, /const selectProvider = \(providerId\) =>/);
  assert.match(source, /model: next\?\.models\?\.length \? next\.models\[0\]/);
  assert.match(source, /onChange=\{\(event\) => selectProvider\(event\.target\.value\)\}/);
});

test("model is a dropdown for catalog providers and free text only for own-key ones", () => {
  assert.match(source, /spec\?\.models\?\.length \? \(/);
  assert.match(source, /spec\.model_options\.map/);
  assert.match(source, /placeholder="Tên model của bạn"/);
});

test("endpoint and API key inputs appear only for the providers that need them", () => {
  assert.match(source, /spec\?\.needs_endpoint && \(/);
  assert.match(source, /spec\?\.needs_api_key && \(/);
  // No endpoint is ever rendered for a stock provider — the server does not send one.
  assert.doesNotMatch(source, /maskLlmEndpoint/);
});

test("model names are shown without their namespace", () => {
  assert.match(source, /function formatConfigModelName\(model\)/);
  assert.match(source, /formatConfigModelName\(form\.model\)/);
  assert.match(source, /model_label/);
});

test("own-key providers are held in sessionStorage and never saved to the server", () => {
  assert.match(source, /getByoConfig, setByoConfig/);
  assert.match(source, /function saveLlmSessionSlot\(slot, config\)/);
  assert.match(source, /setByoConfig\(slot, config\)/);
  // Picking a stored provider must drop the tab's own-key config, or the request
  // header would keep overriding the selection just saved.
  assert.match(source, /setByoConfig\(slot, null\)/);
  assert.match(source, /Không lưu lên hệ thống/);
  assert.match(source, /Chỉ trong tab này/);
  assert.ok(source.indexOf("if (spec?.byo) {") < source.indexOf("onSave(slot, { provider: form.provider, model: form.model })"));
});

test("manual run translation does not cap large ingest runs", () => {
  assert.match(source, /runTranslate\(\{ run_id: target\.id, locale: "zh-CN"/);
  assert.doesNotMatch(source, /runTranslate\([^)]*limit:/);
});

test("CSV preview makes Fanpage and Group Facebook CSV rows visible before upload", () => {
  assert.match(source, /Upload CSV \(Facebook\)/);
  assert.match(source, /preview\.fanpage_rows/);
  assert.match(source, /preview\.group_rows/);
  assert.match(source, /preview\.importable_rows/);
  assert.match(source, /preview\.skipped_non_group_rows/);
  assert.match(source, /preview\.importable_rows === 0/);
  assert.match(source, /preview\.data_start_date/);
  assert.match(source, /preview\.data_end_date/);
  assert.match(source, /row\.post_published_date/);
  assert.match(source, /row\.post_message/);
  assert.ok(source.indexOf("Post Published") < source.indexOf("Comment Message"));
  assert.doesNotMatch(source, /Không có dòng Group để nạp/);
});

test("ingest history prefers the requested pull range when it is available", () => {
  assert.match(source, /run\.source_type === "fb_page"/);
  assert.match(source, /run\.source_type === "store"/);
  assert.match(source, /note\.start_date \|\| note\.end_date/);
  assert.match(source, /run\.data_start_date/);
  assert.match(source, /run\.data_end_date/);
  assert.ok(
    source.indexOf('run.source_type === "fb_page"') <
      source.indexOf('run.source_type === "store"') &&
      source.indexOf('run.source_type === "store"') <
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

test("ingest history shows token spend under each run's analysis and translation cells", () => {
  assert.match(source, /function TokenUsageNote\(/);
  assert.match(source, /<TokenUsageNote usage=\{run\.analysis_tokens\}/);
  assert.match(source, /<TokenUsageNote usage=\{run\.translation_tokens\}/);
  // the note sits below the existing status badge, not replacing it
  assert.match(source, /className="run-cell-stack"/);
  assert.ok(source.indexOf("<ProcessingBadge status={run.analysis_status}") < source.indexOf("<TokenUsageNote usage={run.analysis_tokens}"));
  // "chưa ghi nhận" rather than a zero, so pre-token-capture runs are not read as free
  assert.match(source, /Token: chưa ghi nhận/);
});

test("ingest history has a date-filtered token total broken down by model", () => {
  assert.match(source, /function TokenUsagePanel\(/);
  assert.match(source, /<TokenUsagePanel/);
  assert.match(source, /getTokenUsage,/);
  assert.match(source, /const \[tokenRange, setTokenRange\] = useState\(\(\) => defaultTokenRange\(\)\)/);
  assert.match(source, /function defaultTokenRange\(\)/);
  assert.match(source, /getTokenUsage\(\{ from: tokenRange\.from, to: tokenRange\.to \}\)/);
  // both bounds required, so the filter never silently totals all history
  assert.match(source, /if \(!tokenRange\.from \|\| !tokenRange\.to\) return;/);
  // panel sits beside the source pills in a shared toolbar
  assert.match(source, /className="run-toolbar"/);
  assert.ok(source.indexOf("RUN_SOURCE_FILTERS.map") < source.indexOf("<TokenUsagePanel"));
  // reprocessing a run refreshes the totals too
  assert.match(source, /loadTokenUsage\(\);\s*\}, \[loadRuns, loadIngestStatus, loadTokenUsage\]\)/);
});

test("a finished job whose tokens belong to an ad-hoc task says so instead of rendering blank", () => {
  // Three ways a run can have no token figure, and they used to collapse into two
  // renderings: real numbers, "chưa ghi nhận", or an empty cell that looked like
  // nothing had run. A run translated by a comment_ids task (run_id NULL) has no
  // batches attributed to it, so it landed in the empty case.
  assert.match(source, /function TokenUsageNote\(\{ usage, processed \}\)/);
  assert.match(source, /if \(!processed\) return null;/);
  assert.match(source, /Token: thuộc task lẻ/);
  assert.match(source, /processed=\{run\.analysis_status === "done"\}/);
  assert.match(source, /processed=\{run\.translation_status === "done"\}/);
});

test("the Ingest tab opens read-only and asks the Worker which mode the tab is in", () => {
  assert.match(source, /function useAdminLock\(\)/);
  assert.match(source, /getAdminStatus\(\)/);
  // Unknown state must render as read-only, so a viewer never sees usable controls flash.
  assert.match(source, /readOnly: !status \|\| \(status\.lock_enabled && !status\.authorized\)/);
  assert.match(source, /<AdminLockBar lock=\{adminLock\} \/>/);
  assert.match(source, /const readOnly = adminLock\.readOnly;/);
});

test("a rotated password drops the dead key instead of resending it forever", () => {
  assert.match(source, /if \(next\.lock_enabled && !next\.authorized\) clearAdminKey\(\);/);
  assert.match(source, /setAdminKey\(password\)/);
  assert.match(source, /const lock = useCallback\(\(\) => \{\s*clearAdminKey\(\);/);
});

test("a Worker with no admin API is treated as unlocked, not as a lockout", () => {
  assert.match(source, /\.catch\(\(\) => \{[\s\S]*lock_enabled: false, authorized: true, unknown: true/);
  assert.match(source, /Worker chưa có API khóa quản trị/);
});

test("an unlocked deployment says plainly that anyone with the link can write", () => {
  assert.match(source, /admin-lock-open/);
  assert.match(source, /Chưa đặt mật khẩu quản trị/);
  assert.match(source, /wrangler secret put ADMIN_PASSWORD/);
});

test("every write control on the Ingest tab is disabled in read-only mode", () => {
  // The Worker is the real boundary; these only stop a viewer from firing a request
  // that would come back 401. Each one is listed so a new control cannot be added
  // without this test being looked at.
  assert.match(source, /const READ_ONLY_HINT = /);
  // CSV upload
  assert.match(source, /if \(readOnly \|\| !selectedFile\) return;/);
  assert.match(source, /onClick=\{\(\) => \{ if \(!readOnly\) fileRef\.current\?\.click\(\); \}\}/);
  assert.match(source, /disabled=\{uploading \|\| readOnly \|\| preview\.importable_rows === 0\}/);
  // pulls
  assert.match(source, /disabled=\{stBusy \|\| readOnly\}/);
  assert.match(source, /disabled=\{fbBusy \|\| readOnly\}/);
  // per-run re-analyse / re-translate / delete
  assert.match(source, /run-action-button" disabled=\{readOnly\}[^>]*onClick=\{\(\) => startAnalyze\(run\)\}/);
  assert.match(source, /run-action-button" disabled=\{readOnly\}[^>]*onClick=\{\(\) => startTranslate\(run\)\}/);
  assert.match(source, /disabled=\{readOnly \|\| deletingRunId === run\.id\}/);
  // queue cancel
  assert.match(source, /disabled=\{cancelling \|\| readOnly\}/);
  // LLM agent config: readable, not writable
  assert.match(source, /<fieldset className="llm-config-grid" disabled=\{readOnly\}>/);
  assert.match(source, /disabled=\{saving \|\| !byoReady \|\| readOnly\}/);
});
