import { describe, expect, test } from "vitest";
import { renderFeedbackReportBundleHtml, renderFeedbackReportHtml, type FeedbackReportData } from "./reportHtml";

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

  test("uses actionable negative and positive topics instead of other as report highlights", () => {
    const html = renderFeedbackReportHtml(baseReport({
      overview: {
        total_comments: 7,
        analyzed: 7,
        sentiment: { positive: 2, neutral: 1, negative: 4 },
        negative_pct: 57.1,
        top_topics: [
          { topic: "other", label: "Khác/Không đủ ngữ cảnh", count: 4 },
          { topic: "lag_fps", label: "Lag/Giật/Tụt FPS", count: 2 },
          { topic: "positive_feedback", label: "Khen/Trải nghiệm tốt", count: 1 },
        ],
        top_subtopics: [],
        hot_issues: [
          { topic: "other", label: "Khác/Không đủ ngữ cảnh", negative: 4, urgent: 4 },
          { topic: "lag_fps", label: "Lag/Giật/Tụt FPS", negative: 2, urgent: 1 },
        ],
      },
      topic_ranking: [
        {
          topic: "other",
          label: "Khác/Không đủ ngữ cảnh",
          count: 4,
          negative_count: 4,
          urgent_count: 4,
          sample_comments: [{ id: 9, message: "ơ kìa", sentiment: "negative", urgency: "high", summary: "Không rõ ngữ cảnh" }],
        },
        {
          topic: "lag_fps",
          label: "Lag/Giật/Tụt FPS",
          count: 2,
          negative_count: 2,
          urgent_count: 1,
          sample_comments: [{ id: 2, message: "lag quá", sentiment: "negative", urgency: "medium", summary: "Lag" }],
        },
        {
          topic: "positive_feedback",
          label: "Khen/Trải nghiệm tốt",
          count: 1,
          negative_count: 0,
          positive_count: 1,
          urgent_count: 0,
          sample_comments: [{ id: 3, message: "game hay", sentiment: "positive", urgency: "none", summary: "Khen game" }],
        } as any,
      ],
      highlights: [{ title: "Khác/Không đủ ngữ cảnh cần theo dõi", detail: "4 comment negative", signal: "negative" }],
    }));

    expect(html).toContain("Top vấn đề tiêu cực");
    expect(html).toContain("Top điểm tích cực");
    expect(html).toContain("Lag/Giật/Tụt FPS");
    expect(html).toContain("Khen/Trải nghiệm tốt");
    expect(html).not.toContain("Khác/Không đủ ngữ cảnh");
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

describe("renderFeedbackReportBundleHtml", () => {
  test("renders combined Store/Facebook and VI/ZH reports as switchable tabs", () => {
    const html = renderFeedbackReportBundleHtml([
      baseReport({ group: "store", title: "Store VI Report", language: "vi" }),
      baseReport({ group: "facebook", title: "Facebook VI Report", language: "vi" }),
      baseReport({ group: "store", title: "Store ZH Report", language: "zh-CN" }),
      baseReport({ group: "facebook", title: "Facebook ZH Report", language: "zh-CN" }),
    ]);

    expect(html).toContain("data-report-switcher");
    expect(html).toContain('data-report-filter="group" data-value="store"');
    expect(html).toContain('data-report-filter="group" data-value="facebook"');
    expect(html).toContain('data-report-filter="lang" data-value="vi"');
    expect(html).toContain('data-report-filter="lang" data-value="zh-CN"');
    expect(html).toContain('data-report-panel data-report-group="store" data-report-lang="vi"');
    expect(html).toContain('data-report-panel data-report-group="facebook" data-report-lang="zh-CN"');
    expect(html).toContain('class="report-panel is-active"');
    expect(html).toContain('<script id="report-switcher-script">');
  });
});
