const SENTIMENT_VI = { negative: "Tiêu cực", neutral: "Trung lập", positive: "Tích cực" };
const URGENCY_VI = { none: "Không", low: "Thấp", medium: "Trung bình", high: "Cao" };

export function SentimentBadge({ value }) {
  if (!value) return <span className="badge badge-neutral">—</span>;
  return <span className={`badge badge-${value}`}>{SENTIMENT_VI[value] || value}</span>;
}

export function UrgencyBadge({ value }) {
  if (!value) return <span className="badge badge-urgency-none">—</span>;
  return <span className={`badge badge-urgency-${value}`}>{URGENCY_VI[value] || value}</span>;
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
