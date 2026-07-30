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
  assert.match(source, /report-export-warning/);
  assert.match(source, /reportExportWarningTitle/);
  assert.match(source, /reportExportTimeWarning/);
  assert.match(source, /reportExportWorkWarning/);
  assert.match(source, /reportExportCloseHint/);
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

test("workspace exposes an Excel export dialog with sources, date range and topic", () => {
  assert.match(source, /exportUrl,/);
  assert.match(source, /getIngestStatus,/);
  assert.match(source, /excelExport: "Xuất Excel"/);
  assert.match(source, /excelExport: "导出 Excel"/);
  // header button opens the dialog rather than linking directly
  assert.match(source, /onClick=\{\(\) => setExcelDialogOpen\(true\)\}/);
  assert.match(source, /section === "data" && \(/);
  // dialog component and wiring
  assert.match(source, /function ExcelExportDialog\(/);
  assert.match(source, /<ExcelExportDialog/);
  assert.match(source, /const \[excelDialogOpen, setExcelDialogOpen\] = useState\(false\)/);
  // sources multi-select
  assert.match(source, /EXCEL_SOURCE_OPTIONS/);
  assert.match(source, /value: "store"/);
  assert.match(source, /value: "fb_page"/);
  assert.match(source, /value: "fb_group_csv"/);
  assert.match(source, /type="checkbox"/);
  // latest-data-date note
  assert.match(source, /excelLatestNote/);
  assert.match(source, /getIngestStatus\(\)\.then\(setIngestStatus\)/);
  assert.match(source, /latestBySource/);
  // topic picker + export href with sources
  assert.match(source, /sources: selectedSources\.join\(","\)/);
  assert.match(source, /topic: topicMode === "topic" \? topic : ""/);
  assert.match(source, /labels\.excelNoSource/);
});

test("workspace supports multi-topic scoped insight and topic report export", () => {
  assert.match(source, /reportTopicMode/);
  assert.match(source, /reportTopic/);
  assert.match(source, /reportTopicModeAll/);
  assert.match(source, /reportTopicModeTopic/);
  assert.match(source, /parseTopicSelection/);
  assert.match(source, /joinTopicSelection/);
  assert.match(source, /topicLabelForKeys/);
  assert.match(source, /selectedTopicKeys/);
  assert.match(source, /reportTopicKeys/);
  assert.match(source, /addTopicFilter/);
  assert.match(source, /removeTopicFilter/);
  assert.match(source, /addReportTopic/);
  assert.match(source, /removeReportTopic/);
  assert.match(source, /className="topic-chip-list"/);
  assert.match(source, /className="topic-chip"/);
  assert.match(source, /topic: reportTopicMode === "topic" \? reportTopic : ""/);
  assert.match(source, /setReportTopicMode\(filters\.topic \? "topic" : "all"\)/);
  assert.match(source, /setReportTopic\(filters\.topic \|\| ""\)/);
  assert.match(source, /selectedTopicLabel/);
  assert.match(source, /insightScopeTopic/);
  assert.match(source, /generateInsight\(\{ filters: aggregateParams, prompt: insightPrompt, lang \}\)/);
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
test("saved insights archive is collapsible and supports deleting individual items", () => {
  assert.match(source, /deleteSavedInsight/);
  assert.match(source, /expandedArchiveId/);
  assert.match(source, /toggleArchiveItem/);
  assert.match(source, /deleteSavedArchive/);
  assert.match(source, /archive-item-summary/);
  assert.match(source, /archive-delete-button/);
  assert.ok(source.indexOf("archive-item-summary") < source.indexOf("<InsightMarkdown text={item.summary}"));
});

test("switching tab/group/filters shows loading again instead of the previous selection's stale data", () => {
  // loadData used to leave overview/comments untouched while the new fetch was in
  // flight, so a stale overview.total_comments===0 from the prior tab briefly (or
  // permanently, on a slow request) rendered "no data" instead of "loading".
  const loadDataBody = source.slice(source.indexOf("const loadData = useCallback"), source.indexOf("Promise.all(["));
  assert.match(loadDataBody, /setOverview\(null\)/);
  assert.match(loadDataBody, /setComments\(null\)/);
});

test("a slower request for the tab the user just left cannot overwrite the newer one's data", () => {
  // Without this guard, switching tabs quickly could still flash stale "no data"
  // between the new loading state and the new tab's real data, if the abandoned
  // tab's request happened to resolve after the new one started.
  assert.match(source, /const loadRequestId = useRef\(0\);/);
  assert.match(source, /const requestId = \+\+loadRequestId\.current;/);
  const thenStart = source.indexOf(".then(([ov,");
  const catchStart = source.indexOf(".catch(", thenStart);
  const loadDataEnd = source.indexOf("}, [aggregateParams, hierarchyParams, params, group, subtab]);", catchStart);
  assert.match(source.slice(thenStart, catchStart), /if \(loadRequestId\.current !== requestId\) return;/);
  assert.match(source.slice(catchStart, loadDataEnd), /if \(loadRequestId\.current !== requestId\) return;/);
});
