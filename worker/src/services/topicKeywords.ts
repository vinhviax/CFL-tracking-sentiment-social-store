import { TOPICS, type Topic } from "../taxonomy";

export const TOPIC_KEYWORDS: Record<Topic, string[]> = {
  lag_fps: [
    "lag fps", "tụt fps", "tuột fps", "drop fps", "fps thấp", "fps yếu", "giật lag", "lag giật",
    "giật khựng", "khựng", "khựng hình", "combat bị lag", "combat giật", "máy yếu",
    "máy nóng", "không mượt", "chạy không mượt", "giật", "lag", "fps", "tối ưu",
  ],
  crash_freeze: [
    "văng game", "văng app", "tự thoát", "thoát game", "thoát app", "bị văng",
    "đang chơi văng", "crash", "force close", "đứng hình", "treo game", "treo loading",
    "freeze", "màn hình đứng", "đơ game", "không phản hồi", "app tắt", "sập game",
    "văng", "treo", "đơ",
  ],
  network_ping: [
    "ping cao", "ping đỏ", "ping vàng", "mạng yếu", "mạng lag", "delay", "độ trễ",
    "mất kết nối", "lỗi kết nối", "kết nối lại", "disconnect", "dis trận", "dis", "rớt mạng",
    "server lag", "server delay", "đường truyền", "wifi", "4g", "5g", "network", "ping",
  ],
  login_account: [
    "đăng nhập", "login", "không vào được", "không login", "facebook login", "otp",
    "mật khẩu", "quên mật khẩu", "đổi mật khẩu", "tài khoản", "account", "acc", "nick",
  ],
  account_ban_security: [
    "bị ban", "ban acc", "ban nick", "khóa acc", "khóa nick", "bị khóa", "mất acc",
    "mất nick", "mất tài khoản", "lấy lại acc", "lấy lại nick", "bảo mật", "khiếu nại ban",
  ],
  payment_topup: [
    "nạp tiền", "nạp kim cương", "nạp kc", "top up", "topup", "thanh toán", "momo",
    "zalopay", "sms", "bank", "trừ tiền", "mua gói", "gói nạp", "hóa đơn", "vnd",
  ],
  purchase_delivery: [
    "chưa nhận", "không nhận được", "mua rồi chưa nhận", "nạp rồi chưa nhận",
    "trừ tiền chưa nhận", "chưa cộng kc", "chưa cộng kim cương", "delay giao dịch",
    "không về item", "không nhận gói", "chưa nhận quà mua", "delivery",
  ],
  update_download: [
    "cập nhật", "update", "patch", "bản vá", "phiên bản", "version", "tải dữ liệu",
    "tải tài nguyên", "download", "dung lượng", "bảo trì", "maintenance", "sau update",
    "lỗi cập nhật", "không tải được",
  ],
  ui_control: [
    "nút không ăn", "bấm không ăn", "không ăn nút", "nút lỗi", "button", "tap", "menu",
    "giao diện", "ui", "khó thao tác", "điều khiển", "cảm ứng", "joystick", "hud",
    "nút đổi súng", "không phản hồi", "không hoạt động",
  ],
  gameplay_mode_map: [
    "chế độ", "mode", "map", "bản đồ", "gameplay", "lối chơi", "đặt bom", "gỡ bom",
    "đấu đội", "đấu đơn", "round", "luật chơi", "trong trận", "nhiệm vụ trong trận",
  ],
  shooting_mechanics: [
    "tâm súng", "ngắm", "aim", "đạn không ăn", "bắn không ăn", "hitbox", "recoil",
    "giật tâm", "damage", "sát thương", "headshot", "bắn xuyên", "đạn lệch", "spray",
  ],
  matchmaking: [
    "ghép trận", "matchmaking", "tìm trận", "xếp trận", "chờ trận", "tìm phòng",
    "phòng", "đội lệch", "đối thủ mạnh", "đối thủ yếu", "đồng đội yếu", "match",
  ],
  rank_competition: [
    "leo rank", "rank", "xếp hạng", "mất điểm rank", "trừ điểm rank", "reset mùa",
    "mùa rank", "phần thưởng rank", "huyền thoại", "cao thủ", "điểm rank",
  ],
  balance: [
    "cân bằng", "mất cân bằng", "balance", "buff", "nerf", "op", "imba", "quá mạnh",
    "quá yếu", "pay to win", "p2w", "hút máu", "bất công", "súng quá mạnh",
  ],
  hack_cheat: [
    "hack wall aim", "hack wall", "hack aim", "hack bắn xuyên", "hack tràn lan",
    "wallhack", "aimbot", "auto headshot", "map hack", "bắn xuyên tường", "tố hack",
    "hack", "cheat", "gian lận", "wall", "mod", "tool",
  ],
  event_mission: [
    "sự kiện", "event", "nhiệm vụ", "mission", "mốc sự kiện", "điểm event",
    "event mới", "chuỗi sự kiện", "đua top", "khó hiểu nhiệm vụ",
  ],
  reward_giftcode: [
    "phần thưởng", "quà", "quà tặng", "gift", "giftcode", "code", "reward", "đền bù",
    "mốc thưởng", "nhận thưởng", "không nhận thưởng", "coupon",
  ],
  gacha_rate: [
    "gacha", "rương", "quay rương", "mở rương", "quay", "roll", "spin", "random",
    "tỉ lệ", "tỷ lệ", "rate", "xác suất", "may mắn", "ra đồ", "hộp",
  ],
  item_skin_weapon: [
    "skin", "vũ khí", "súng", "nhân vật", "item", "vật phẩm", "trang phục", "dao",
    "balo", "vip", "mảnh", "mảnh súng", "mảnh nhân vật", "ak", "m4", "sniper",
  ],
  social_chat_voice: [
    "chat", "voice", "mic", "bạn bè", "friend", "clan", "bang hội", "mời đội",
    "lập đội", "đội", "tin nhắn", "khung chat", "voice lỗi",
  ],
  community_behavior: [
    "toxic", "chửi", "văng tục", "afk", "report", "tố cáo", "phá game", "troll",
    "trẻ trâu", "đồng đội phá", "hành vi", "người chơi xấu", "feed",
  ],
  customer_support: [
    "cskh", "hỗ trợ", "support", "admin", "gm", "phản hồi", "ticket", "khiếu nại",
    "chăm sóc khách hàng", "xin hỗ trợ", "không trả lời", "liên hệ admin",
  ],
  feature_request: [
    "góp ý", "đề xuất", "mong thêm", "xin thêm", "nên thêm", "yêu cầu thêm", "feature",
    "tính năng mới", "mode mới", "thêm súng", "thêm map", "ước gì", "hy vọng",
  ],
  content_esports: [
    "giải đấu", "esports", "tournament", "livestream", "stream", "youtube", "tiktok",
    "video", "clip", "creator", "content", "truyền thông",
  ],
  spam_ads_scam: [
    "spam", "quảng cáo", "bán acc", "bán nick", "shop acc", "link lạ", "http", "www.",
    "zalo", "liên hệ", "lừa đảo", "scam", "bán kc", "nạp thuê",
  ],
  positive_feedback: [
    "game hay", "hay quá", "rất hay", "mượt", "đỉnh", "vui", "thích", "tuyệt",
    "ổn", "ngon", "tốt", "ủng hộ", "hài lòng", "good", "great", "nice", "love",
  ],
  technical_other: [
    "lỗi kỹ thuật", "bug", "error", "glitch", "lỗi", "sự cố", "sai hiển thị",
    "không hiện", "kẹt", "bị lỗi", "không dùng được",
  ],
  other: [],
};

const GENERIC_MAJOR_TOPIC_TERMS = new Set([
  "bug", "loi", "error", "lag", "giat", "fps", "crash", "vang game", "ping", "mang",
  "delay", "hack", "cheat", "nap", "thanh toan", "dang nhap", "tai khoan", "event",
  "su kien", "update", "cap nhat", "support", "ho tro", "skin", "gacha", "ruong",
  "spam", "quang cao", "gameplay", "loi choi", "matchmaking", "ghep tran", "rank",
  "can bang", "qua", "gift", "code", "ui", "chat", "voice",
]);

export function normalizeTopicText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function keywordScore(normalizedText: string, keyword: string): number {
  const normalizedKeyword = normalizeTopicText(keyword);
  if (!normalizedKeyword) return 0;
  const paddedText = ` ${normalizedText} `;
  const paddedKeyword = ` ${normalizedKeyword} `;
  if (!paddedText.includes(paddedKeyword)) return 0;
  return normalizedKeyword.includes(" ") ? 3 : 1;
}

export function scoreTopicByKeywords(text: string, topic: Topic): number {
  const normalizedText = normalizeTopicText(text);
  if (!normalizedText) return 0;
  return TOPIC_KEYWORDS[topic].reduce((sum, keyword) => sum + keywordScore(normalizedText, keyword), 0);
}

export function rankTopicsByKeywords(text: string): Topic[] {
  const hits = TOPICS
    .map((topic) => ({ topic, score: scoreTopicByKeywords(text, topic) }))
    .filter((hit) => hit.score > 0);
  hits.sort((a, b) => b.score - a.score || TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic));
  return hits.map((hit) => hit.topic);
}

export function isGenericMajorTopicKeyword(phrase: string): boolean {
  const normalized = normalizeTopicText(phrase);
  if (!normalized) return true;
  if (GENERIC_MAJOR_TOPIC_TERMS.has(normalized)) return true;
  if (!normalized.includes(" ")) {
    return TOPICS.some((topic) =>
      TOPIC_KEYWORDS[topic].some((keyword) => normalizeTopicText(keyword) === normalized)
    );
  }
  return false;
}

export const TOPIC_KEYWORD_HINTS = TOPICS
  .filter((topic) => topic !== "other")
  .map((topic) => `- ${topic}: ${TOPIC_KEYWORDS[topic].slice(0, 14).join(", ")}`)
  .join("\n");
