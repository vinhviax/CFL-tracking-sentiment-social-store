const SENTIMENT_VI = { negative: "Tiêu cực", neutral: "Trung lập", positive: "Tích cực" };
const SENTIMENT_ZH = { negative: "负面", neutral: "中立", positive: "正面" };
const URGENCY_VI = { none: "Không", low: "Thấp", medium: "Trung bình", high: "Cao" };
const URGENCY_ZH = { none: "无", low: "低", medium: "中", high: "高" };

export function SentimentBadge({ value, lang = "vi" }) {
  if (!value) return <span className="badge badge-neutral">—</span>;
  const labels = lang === "zh-CN" ? SENTIMENT_ZH : SENTIMENT_VI;
  return <span className={`badge badge-${value}`}>{labels[value] || value}</span>;
}

export function UrgencyBadge({ value, lang = "vi" }) {
  if (!value) return <span className="badge badge-urgency-none">—</span>;
  const labels = lang === "zh-CN" ? URGENCY_ZH : URGENCY_VI;
  return <span className={`badge badge-urgency-${value}`}>{labels[value] || value}</span>;
}

export function StatusPill({ status }) {
  const dotClass = status === "done" ? "dot-ok" : status === "failed" ? "dot-fail" : "dot-running";
  const label = status === "done" ? "Hoàn tất" : status === "failed" ? "Lỗi" : "Đang chạy";
  return (
    <span className="status-pill">
      <span className={`dot ${dotClass}`} />
      {label}
    </span>
  );
}
