import axios from "axios";
import { ADMIN_HEADER, getAdminKey } from "../utils/adminSession.js";
import { BYO_HEADER, byoHeaderValue } from "../utils/llmSession.js";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "http://localhost:8000",
});

// A bring-your-own-key provider is chosen in the browser and never stored server
// side, so every request that might reach an LLM has to carry it. Attaching it in
// one interceptor keeps that out of each call site — including the polling GETs,
// which are what drain the processing queue.
api.interceptors.request.use((config) => {
  const value = byoHeaderValue(config.url);
  if (value) config.headers[BYO_HEADER] = value;
  // The Worker rejects the Ingest tab's writes without this. Sent on every request
  // rather than only the writes, so /api/admin/status can confirm on load that the key
  // this tab still holds is the current one.
  const adminKey = getAdminKey();
  if (adminKey) config.headers[ADMIN_HEADER] = adminKey;
  return config;
});

export const getHealth = () => api.get("/api/health").then((r) => r.data);
export const getAdminStatus = () => api.get("/api/admin/status").then((r) => r.data);
export const unlockAdmin = (password) =>
  api.post("/api/admin/unlock", { password }).then((r) => r.data);
export const getMeta = () => api.get("/api/meta").then((r) => r.data);
export const getLlmAgentConfig = () =>
  api.get("/api/llm-config").then((r) => r.data);
export const saveLlmAgentConfig = (slot, payload) =>
  api.put(`/api/llm-config/${slot}`, payload).then((r) => r.data);

export const getOverview = (params) =>
  api.get("/api/stats/overview", { params }).then((r) => r.data);
export const getTrend = (params) =>
  api.get("/api/stats/trend", { params }).then((r) => r.data);
export const getInsightsSummary = (params) =>
  api.get("/api/insights/summary", { params }).then((r) => r.data);
export const getInsightPrompt = () =>
  api.get("/api/insights/prompt").then((r) => r.data);
export const saveInsightPrompt = (payload) =>
  api.put("/api/insights/prompt", payload).then((r) => r.data);
export const generateInsight = (payload) =>
  api.post("/api/insights/generate", payload).then((r) => r.data);
export const saveInsight = (payload) =>
  api.post("/api/insights/save", payload).then((r) => r.data);
export const listSavedInsights = (params) =>
  api.get("/api/insights/saved", { params }).then((r) => r.data);
export const deleteSavedInsight = (id) =>
  api.delete(`/api/insights/saved/${id}`).then((r) => r.data);
export const getTopicRanking = (params) =>
  api.get("/api/stats/topic-ranking", { params }).then((r) => r.data);
export const getSubtopicRanking = (params) =>
  api.get("/api/stats/subtopic-ranking", { params }).then((r) => r.data);
export const getSubtopics = (params) =>
  api.get("/api/stats/subtopics", { params }).then((r) => r.data);
export const getTokenUsage = (params) =>
  api.get("/api/stats/token-usage", { params }).then((r) => r.data);

export const listComments = (params) =>
  api.get("/api/comments", { params }).then((r) => r.data);
export const updateCommentAnalysis = (id, payload) =>
  api.patch(`/api/comments/${id}/analysis`, payload).then((r) => r.data);

export const listRuns = (params) =>
  api.get("/api/runs", { params }).then((r) => r.data);
export const getRun = (id) => api.get(`/api/runs/${id}`).then((r) => r.data);
export const deleteIngestRun = (id) =>
  api.delete(`/api/runs/${id}`).then((r) => r.data);

export const listPosts = (params) =>
  api.get("/api/posts", { params }).then((r) => r.data);

export const getStoreBreakdown = (params) =>
  api.get("/api/stats/store", { params }).then((r) => r.data);

export const previewCsv = (file) => {
  const form = new FormData();
  form.append("file", file);
  return api
    .post("/api/ingest/preview-csv", form, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

export const uploadCsv = (file) => {
  const form = new FormData();
  form.append("file", file);
  return api
    .post("/api/ingest/upload-csv", form, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

export const ingestSensorTower = (payload) =>
  api.post("/api/ingest/sensortower", payload).then((r) => r.data);

export const ingestFacebook = (payload) =>
  api.post("/api/ingest/facebook", payload).then((r) => r.data);
export const getIngestStatus = () =>
  api.get("/api/ingest/status").then((r) => r.data);

export const runAnalyze = (payload) =>
  api.post("/api/analyze/run", payload).then((r) => r.data);

export const getAnalyzeProgress = (progressKey) =>
  api.get(`/api/analyze/progress/${progressKey}`).then((r) => r.data);

export const runTranslate = (payload) =>
  api.post("/api/translate/run", payload).then((r) => r.data);

export const getTranslateProgress = (progressKey) =>
  api.get(`/api/translate/progress/${progressKey}`).then((r) => r.data);

export const listProcessingJobs = (params) =>
  api.get("/api/processing/jobs", { params }).then((r) => r.data);

export const listProcessingJobLogs = (id, params) =>
  api.get(`/api/processing/jobs/${id}/logs`, { params }).then((r) => r.data);

export const cancelProcessingJob = (id) =>
  api.post(`/api/processing/jobs/${id}/cancel`).then((r) => r.data);

export const exportUrl = (params) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null && v !== ""))
  ).toString();
  const base = import.meta.env.VITE_API_BASE || "http://localhost:8000";
  return `${base}/api/export${qs ? `?${qs}` : ""}`;
};

export const exportReportHtmlUrl = (params) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null && v !== ""))
  ).toString();
  const base = import.meta.env.VITE_API_BASE || "http://localhost:8000";
  return `${base}/api/report/html${qs ? `?${qs}` : ""}`;
};

export default api;
