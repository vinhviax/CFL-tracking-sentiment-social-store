import { describe, expect, test } from "vitest";
import { renderFeedbackReportHtml, type FeedbackReportData } from "./reportHtml";

function baseReport(overrides: Partial<FeedbackReportData> = {}): FeedbackReportData {
  return {
    group: "facebook",
    title: "Facebook Report",
    generated_at: "2026-07-07T10:00:00.000Z",
    range: { from: "2026-07-01", to: "2026-07-07" },
    overview: {
      total_comments: 3,
      analyzed: 3,
      sentiment: { positive: 1, neutral: 1, negative: 1 },
      negative_pct: 33.3,
      top_topics: [{ topic: "lag_performance", label: "Lag", count: 1 }],
      top_subtopics: [],
      hot_issues: [{ topic: "lag_performance", label: "Lag", negative: 1, urgent: 1 }],
    },
    trend: [{ date: "2026-07-07", positive: 1, neutral: 1, negative: 1 }],
    topic_ranking: [
      {
        topic: "lag_performance",
        label: "Lag",
        count: 1,
        negative_count: 1,
        urgent_count: 1,
        sample_comments: [{ id: 1, message: "lag qua", sentiment: "negative", urgency: "high", summary: "Lag" }],
      },
    ],
    subtopic_ranking: [],
    comments: [
      {
        id: 1,
        source_type: "fb_page",
        created_at: "2026-07-07T09:00:00",
        message: "<script>alert('x')</script>",
        rating: null,
        store: null,
        post_message: "Post <b>context</b>",
        topic_label: "Lag",
        sentiment: "negative",
        urgency: "high",
        summary: "Needs <fix>",
      },
    ],
    channels: [{ source_type: "fb_page", label: "Fanpage", total: 3, positive: 1, neutral: 1, negative: 1 }],
    store_breakdown: null,
    top_posts: [{ id: 5, source_type: "fb_page", published_at: "2026-07-07", message: "Top post", comment_count: 3, negative_count: 1 }],
    highlights: [{ title: "Lag is rising", detail: "1 urgent negative comment", signal: "negative" }],
    llm_insight: {
      title: "Insight đã lưu",
      summary: "Người chơi đang phàn nàn về lag.",
      provider: "llm_viax",
      model: "gpt-5.4",
      created_at: "2026-07-07T09:30:00.000Z",
    },
    language: "vi",
    ...overrides,
  };
}

describe("renderFeedbackReportHtml", () => {
  test("renders a standalone HTML report and escapes user generated text", () => {
    const html = renderFeedbackReportHtml(baseReport());

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Facebook Report");
    expect(html).toContain("Sentiment");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).toContain("Post &lt;b&gt;context&lt;/b&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("Post <b>context</b>");
  });

  test("renders Vietnamese report sections without mojibake", () => {
    const html = renderFeedbackReportHtml(baseReport());

    expect(html).toContain("Bộ lọc và nguyên tắc đọc report");
    expect(html).toContain("Bảng ưu tiên vấn đề cần quan tâm");
    expect(html).toContain("Insight and Summarize từ LLM");
    expect(html).toContain("Bài học rút ra");
    expect(html).toContain("Next step đề xuất");
    expect(html).toContain("Người chơi đang phàn nàn");
    expect(html).not.toMatch(/Ã|Â|áº|á»|Ä‘|Æ°|ðŸ/);
  });
});
