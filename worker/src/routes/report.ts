import { Hono } from "hono";
import type { Env } from "../types";
import { buildReportData, type ReportGroup } from "../services/reportData";
import { renderFeedbackReportHtml } from "../services/reportHtml";

export const reportRoute = new Hono<{ Bindings: Env }>();

function isReportGroup(value: string): value is ReportGroup {
  return value === "store" || value === "facebook";
}

function datePart(value?: string | null) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "all";
}

reportRoute.get("/html", async (c) => {
  const q = c.req.query();
  const group = String(q.group || "");
  if (!isReportGroup(group)) {
    return c.json({ detail: "Invalid report group" }, 400);
  }

  const data = await buildReportData(c.env, {
    group,
    from: q.from,
    to: q.to,
  });
  const html = renderFeedbackReportHtml(data);
  const groupName = group === "store" ? "Store" : "Facebook";
  const filename = `CFL_${groupName}_Report_${datePart(q.from)}_${datePart(q.to)}.html`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
