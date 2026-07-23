import { Hono } from "hono";
import type { Env } from "../types";
import { buildReportData, type ReportGroup } from "../services/reportData";
import { renderFeedbackReportBundleHtml } from "../services/reportHtml";
import type { ReportLanguage } from "../services/reportHtml";
import { isTopic } from "../taxonomy";
import { normalizeTopicParam, parseTopicKeys, topicFilenamePart } from "../services/topicScope";
import { parseSubtopicKeys } from "../services/commentFilters";

export const reportRoute = new Hono<{ Bindings: Env }>();

function isReportGroup(value: string): value is ReportGroup {
  return value === "store" || value === "facebook";
}

function reportGroups(value: string): ReportGroup[] | null {
  if (value === "all") return ["store", "facebook"];
  if (isReportGroup(value)) return [value];
  return null;
}

function reportLanguages(value: string): ReportLanguage[] | null {
  if (!value || value === "vi") return ["vi"];
  if (value === "zh-CN") return ["zh-CN"];
  if (value === "both") return ["vi", "zh-CN"];
  return null;
}

function datePart(value?: string | null) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "all";
}

function filenamePart(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

reportRoute.get("/html", async (c) => {
  const q = c.req.query();
  const groupParam = String(q.group || "");
  const groups = reportGroups(groupParam);
  if (!groups) {
    return c.json({ detail: "Invalid report group" }, 400);
  }
  const languages = reportLanguages(String(q.lang || "vi"));
  if (!languages) {
    return c.json({ detail: "Invalid report language" }, 400);
  }
  const topicKeys = parseTopicKeys(q.topic);
  if (topicKeys.some((key) => !isTopic(key))) {
    return c.json({ detail: "Invalid report topic" }, 400);
  }
  const topic = normalizeTopicParam(q.topic);
  const subtopic = parseSubtopicKeys(q.subtopic).join(",");

  const reports = [];
  for (const lang of languages) {
    for (const group of groups) {
      reports.push(await buildReportData(c.env, {
        group,
        from: q.from,
        to: q.to,
        lang,
        topic: topic || undefined,
        subtopic: subtopic || undefined,
        autoGenerateInsight: true,
      }));
    }
  }
  const html = renderFeedbackReportBundleHtml(reports);
  const groupName = groups.length > 1 ? "All" : groups[0] === "store" ? "Store" : "Facebook";
  const langName = languages.length > 1 ? "vi-zh" : languages[0] === "zh-CN" ? "zh" : "vi";
  const topicName = topic ? `_${filenamePart(topicFilenamePart(topic))}` : "";
  const filename = `CFL_${groupName}${topicName}_Report_${datePart(q.from)}_${datePart(q.to)}_${langName}.html`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
