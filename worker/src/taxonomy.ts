// Ported from backend/app/taxonomy.py — keep both in sync if the taxonomy changes.
export const PROMPT_VERSION = "v2";

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

export const TOPIC_LABELS_ZH_CN: Record<string, string> = {
  function: "功能",
  ping_network: "延迟/网络",
  bug: "错误",
  event: "活动",
  hack_cheat: "外挂/作弊",
  payment_topup: "充值/支付",
  login_account: "登录/账号",
  performance_lag_crash: "性能/卡顿/崩溃",
  update_patch: "更新/补丁",
  customer_support: "客服支持",
  gameplay: "玩法",
  matchmaking: "匹配",
  balance: "平衡性",
  reward_gift: "奖励/礼包",
  community_player_behavior: "社区/玩家行为",
  item_skin: "道具/皮肤",
  gacha: "抽奖/宝箱",
  esports_content: "电竞/内容",
  suggestion_request: "建议/需求",
  spam_ads: "垃圾信息/广告",
  other: "其他",
};

export const SENTIMENTS = ["negative", "neutral", "positive"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const SENTIMENT_LABELS_VI: Record<string, string> = {
  negative: "Tiêu cực",
  neutral: "Trung lập",
  positive: "Tích cực",
};

export const SENTIMENT_LABELS_ZH_CN: Record<string, string> = {
  negative: "负面",
  neutral: "中立",
  positive: "正面",
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
