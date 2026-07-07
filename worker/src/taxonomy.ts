// Ported from backend/app/taxonomy.py — keep both in sync if the taxonomy changes.
export const PROMPT_VERSION = "v4";

export const TOPICS = [
  "lag_fps",
  "crash_freeze",
  "network_ping",
  "login_account",
  "account_ban_security",
  "payment_topup",
  "purchase_delivery",
  "update_download",
  "ui_control",
  "gameplay_mode_map",
  "shooting_mechanics",
  "matchmaking",
  "rank_competition",
  "balance",
  "hack_cheat",
  "event_mission",
  "reward_giftcode",
  "gacha_rate",
  "item_skin_weapon",
  "social_chat_voice",
  "community_behavior",
  "customer_support",
  "feature_request",
  "content_esports",
  "spam_ads_scam",
  "game_comparison",
  "positive_feedback",
  "technical_other",
  "other",
] as const;

export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS_VI: Record<string, string> = {
  lag_fps: "Lag/Giật/Tụt FPS",
  crash_freeze: "Crash/Văng/Treo game",
  network_ping: "Ping/Mạng/Kết nối",
  login_account: "Đăng nhập/Tài khoản",
  account_ban_security: "Khóa/Ban/Mất tài khoản",
  payment_topup: "Nạp tiền/Thanh toán",
  purchase_delivery: "Nhận vật phẩm sau mua/nạp",
  update_download: "Cập nhật/Tải dữ liệu/Bảo trì",
  ui_control: "UI/Nút/Menu/Điều khiển",
  gameplay_mode_map: "Chế độ chơi/Map/Gameplay",
  shooting_mechanics: "Bắn/Ngắm/Hitbox/Sát thương",
  matchmaking: "Ghép trận/Tìm trận",
  rank_competition: "Rank/Xếp hạng",
  balance: "Cân bằng game",
  hack_cheat: "Hack/Cheat/Gian lận",
  event_mission: "Sự kiện/Nhiệm vụ",
  reward_giftcode: "Phần thưởng/Quà/Giftcode",
  gacha_rate: "Gacha/Rương/Tỉ lệ",
  item_skin_weapon: "Vật phẩm/Skin/Vũ khí/Nhân vật",
  social_chat_voice: "Chat/Voice/Bạn bè/Bang hội",
  community_behavior: "Toxic/AFK/Report người chơi",
  customer_support: "CSKH/Admin/Phản hồi",
  feature_request: "Góp ý/Yêu cầu thêm tính năng",
  content_esports: "Esports/Stream/Content",
  spam_ads_scam: "Spam/Quảng cáo/Lừa đảo",
  game_comparison: "So Sánh Game",
  positive_feedback: "Khen/Trải nghiệm tốt",
  technical_other: "Lỗi kỹ thuật khác",
  other: "Khác/Không đủ ngữ cảnh",
};

export const TOPIC_LABELS_ZH_CN: Record<string, string> = {
  lag_fps: "卡顿/FPS下降",
  crash_freeze: "崩溃/闪退/卡死",
  network_ping: "延迟/网络/连接",
  login_account: "登录/账号",
  account_ban_security: "封禁/账号丢失/安全",
  payment_topup: "充值/支付",
  purchase_delivery: "购买后发放",
  update_download: "更新/下载/维护",
  ui_control: "界面/按钮/操作",
  gameplay_mode_map: "模式/地图/玩法",
  shooting_mechanics: "射击/瞄准/命中/伤害",
  matchmaking: "匹配/找比赛",
  rank_competition: "排位/排行榜",
  balance: "平衡性",
  hack_cheat: "外挂/作弊",
  event_mission: "活动/任务",
  reward_giftcode: "奖励/礼包码",
  gacha_rate: "抽奖/宝箱/概率",
  item_skin_weapon: "道具/皮肤/武器/角色",
  social_chat_voice: "聊天/语音/好友/战队",
  community_behavior: "恶意行为/挂机/举报",
  customer_support: "客服/Admin/反馈",
  feature_request: "建议/功能需求",
  content_esports: "电竞/直播/内容",
  spam_ads_scam: "垃圾信息/广告/诈骗",
  game_comparison: "游戏版本/竞品对比",
  positive_feedback: "好评/正向体验",
  technical_other: "其他技术问题",
  other: "其他/上下文不足",
};

export const LEGACY_TOPIC_LABELS_VI: Record<string, string> = {
  function: "Tính năng",
  ping_network: "Ping/Mạng",
  bug: "Lỗi (Bug)",
  event: "Sự kiện",
  performance_lag_crash: "Hiệu năng/Lag/Crash (cũ)",
  update_patch: "Cập nhật/Bản vá",
  gameplay: "Lối chơi",
  reward_gift: "Phần thưởng/Quà",
  community_player_behavior: "Cộng đồng/Hành vi người chơi",
  item_skin: "Vật phẩm/Skin",
  gacha: "Gacha/Rương",
  esports_content: "Esports/Nội dung",
  suggestion_request: "Góp ý/Yêu cầu",
  spam_ads: "Spam/Quảng cáo",
};

export const LEGACY_TOPIC_LABELS_ZH_CN: Record<string, string> = {
  function: "功能",
  ping_network: "延迟/网络",
  bug: "错误",
  event: "活动",
  performance_lag_crash: "性能/卡顿/崩溃（旧）",
  update_patch: "更新/补丁",
  gameplay: "玩法",
  reward_gift: "奖励/礼包",
  community_player_behavior: "社区/玩家行为",
  item_skin: "道具/皮肤",
  gacha: "抽奖/宝箱",
  esports_content: "电竞/内容",
  suggestion_request: "建议/需求",
  spam_ads: "垃圾信息/广告",
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
