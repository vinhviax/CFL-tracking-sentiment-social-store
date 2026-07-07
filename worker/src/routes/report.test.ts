import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildReportData: vi.fn(),
  renderFeedbackReportHtml: vi.fn(),
}));

vi.mock("../services/reportData", () => ({
  buildReportData: mocks.buildReportData,
}));

vi.mock("../services/reportHtml", () => ({
  renderFeedbackReportHtml: mocks.renderFeedbackReportHtml,
}));

import { reportRoute } from "./report";

describe("reportRoute", () => {
  test("returns a Store HTML report with a download filename", async () => {
    mocks.buildReportData.mockResolvedValueOnce({
      group: "store",
      range: { from: "2026-07-01", to: "2026-07-07" },
    });
    mocks.renderFeedbackReportHtml.mockReturnValueOnce("<!doctype html><html><body>Store report</body></html>");

    const res = await reportRoute.request(
      "/html?group=store&from=2026-07-01&to=2026-07-07",
      {},
      { DB: {} } as any
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain("CFL_Store_Report_2026-07-01_2026-07-07.html");
    expect(mocks.buildReportData).toHaveBeenCalledWith({ DB: {} }, {
      group: "store",
      from: "2026-07-01",
      to: "2026-07-07",
    });
    await expect(res.text()).resolves.toContain("Store report");
  });

  test("rejects unknown report groups", async () => {
    const res = await reportRoute.request("/html?group=all", {}, { DB: {} } as any);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ detail: "Invalid report group" });
  });
});
