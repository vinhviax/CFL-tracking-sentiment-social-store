import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildReportData: vi.fn(),
  renderFeedbackReportHtml: vi.fn(),
}));

vi.mock("../services/reportData", () => ({
  buildReportData: mocks.buildReportData,
}));

vi.mock("../services/reportHtml", () => ({
  renderFeedbackReportHtml: mocks.renderFeedbackReportHtml,
  renderFeedbackReportBundleHtml: mocks.renderFeedbackReportHtml,
}));

import { reportRoute } from "./report";

describe("reportRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(res.headers.get("content-disposition")).toContain("CFL_Store_Report_2026-07-01_2026-07-07_vi.html");
    expect(mocks.buildReportData).toHaveBeenCalledWith({ DB: {} }, {
      group: "store",
      from: "2026-07-01",
      to: "2026-07-07",
      lang: "vi",
      autoGenerateInsight: true,
    });
    await expect(res.text()).resolves.toContain("Store report");
  });

  test("returns a combined bilingual HTML report", async () => {
    mocks.buildReportData
      .mockResolvedValueOnce({ group: "store", language: "vi" })
      .mockResolvedValueOnce({ group: "facebook", language: "vi" })
      .mockResolvedValueOnce({ group: "store", language: "zh-CN" })
      .mockResolvedValueOnce({ group: "facebook", language: "zh-CN" });
    mocks.renderFeedbackReportHtml.mockReturnValueOnce("<!doctype html><html><body>Combined report</body></html>");

    const res = await reportRoute.request(
      "/html?group=all&from=2026-07-01&to=2026-07-07&lang=both",
      {},
      { DB: {} } as any
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("CFL_All_Report_2026-07-01_2026-07-07_vi-zh.html");
    expect(mocks.buildReportData).toHaveBeenCalledTimes(4);
    expect(mocks.buildReportData).toHaveBeenNthCalledWith(1, { DB: {} }, { group: "store", from: "2026-07-01", to: "2026-07-07", lang: "vi", autoGenerateInsight: true });
    expect(mocks.buildReportData).toHaveBeenNthCalledWith(4, { DB: {} }, { group: "facebook", from: "2026-07-01", to: "2026-07-07", lang: "zh-CN", autoGenerateInsight: true });
    await expect(res.text()).resolves.toContain("Combined report");
  });

  test("passes selected topic scope into generated report data and filename", async () => {
    mocks.buildReportData.mockResolvedValueOnce({
      group: "facebook",
      range: { from: "2026-07-01", to: "2026-07-07" },
    });
    mocks.renderFeedbackReportHtml.mockReturnValueOnce("<!doctype html><html><body>Topic report</body></html>");

    const res = await reportRoute.request(
      "/html?group=facebook&from=2026-07-01&to=2026-07-07&topic=hack_cheat",
      {},
      { DB: {} } as any
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("CFL_Facebook_hack_cheat_Report_2026-07-01_2026-07-07_vi.html");
    expect(mocks.buildReportData).toHaveBeenCalledWith({ DB: {} }, {
      group: "facebook",
      from: "2026-07-01",
      to: "2026-07-07",
      lang: "vi",
      topic: "hack_cheat",
      autoGenerateInsight: true,
    });
  });

  test("passes selected multi-topic scope into generated report data and filename", async () => {
    mocks.buildReportData.mockResolvedValueOnce({
      group: "facebook",
      range: { from: "2026-07-01", to: "2026-07-07" },
    });
    mocks.renderFeedbackReportHtml.mockReturnValueOnce("<!doctype html><html><body>Multi topic report</body></html>");

    const res = await reportRoute.request(
      "/html?group=facebook&from=2026-07-01&to=2026-07-07&topic=hack_cheat,lag_fps",
      {},
      { DB: {} } as any
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("CFL_Facebook_topics-2_Report_2026-07-01_2026-07-07_vi.html");
    expect(mocks.buildReportData).toHaveBeenCalledWith({ DB: {} }, {
      group: "facebook",
      from: "2026-07-01",
      to: "2026-07-07",
      lang: "vi",
      topic: "hack_cheat,lag_fps",
      autoGenerateInsight: true,
    });
  });

  test("rejects invalid topics inside multi-topic report scope", async () => {
    const res = await reportRoute.request(
      "/html?group=facebook&from=2026-07-01&to=2026-07-07&topic=hack_cheat,not_a_topic",
      {},
      { DB: {} } as any
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ detail: "Invalid report topic" });
  });

  test("rejects unknown report groups", async () => {
    const res = await reportRoute.request("/html?group=bad", {}, { DB: {} } as any);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ detail: "Invalid report group" });
  });
});
