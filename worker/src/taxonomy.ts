// Ported from backend/app/taxonomy.py — keep both in sync if the taxonomy changes.
export const PROMPT_VERSION = "v1";

export const TOPICS = [
  "function", "ping_network", "bug", "event", "hack_cheat", "payment_topup",
  "login_account", "performance_lag_crash", "update_patch", "customer_support",
  "gameplay", "matchmaking", "balance", "reward_gift", "community_player_behavior",
  "item_skin", "gacha", "esports_content", "suggestion_request", "spam_ads", "other",
] as const;

export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS_VI: Record<string, string> = {
  function: "Tính năng",
  ping_network: "Ping/Mạng",
  bug: "Lỗi (Bug)",
  event: "Sự kiện",
  hack_cheat: "Hack/Cheat",
  payment_topup: "Nạp tiền/Thanh toán",
  login_account: "Đăng nhập/Tài khoản",
  performance_lag_crash: "Hiệu năng/Lag/Crash",
  update_patch: "Cập nhật/Bản vá",
  customer_support: "Hỗ trợ khách hàng",
  gameplay: "Lối chơi",
  matchmaking: "Ghép trận",
  balance: "Cân bằng game",
  reward_gift: "Phần thưởng/Quà",
  community_player_behavior: "Cộng đồng/Hành vi người chơi",
  item_skin: "Vật phẩm/Skin",
  gacha: "Gacha/Rương",
  esports_content: "Esports/Nội dung",
  suggestion_request: "Góp ý/Yêu cầu",
  spam_ads: "Spam/Quảng cáo",
  other: "Khác",
};

export const SENTIMENTS = ["negative", "neutral", "positive"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const SENTIMENT_LABELS_VI: Record<string, string> = {
  negative: "Tiêu cực",
  neutral: "Trung lập",
  positive: "Tích cực",
};

export const URGENCIES = ["none", "low", "medium", "high"] as const;
export type Urgency = (typeof URGENCIES)[number];

export function isTopic(v: string): v is Topic {
  return (TOPICS as readonly string[]).includes(v);
}
export function isSentiment(v: string): v is Sentiment {
  return (SENTIMENTS as readonly string[]).includes(v);
}
export function isUrgency(v: string): v is Urgency {
  return (URGENCIES as readonly string[]).includes(v);
}
