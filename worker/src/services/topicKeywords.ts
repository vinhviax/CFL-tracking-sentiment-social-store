import { TOPICS, type Topic } from "../taxonomy";

export const TOPIC_KEYWORDS: Record<Topic, string[]> = {
  function: [
    "tính năng", "chức năng", "function", "feature", "nút", "button", "bấm", "tap",
    "không hoạt động", "không ăn nút", "không phản hồi", "ui", "menu", "cài đặt",
    "kho đồ", "chat", "voice", "mail", "thông báo",
  ],
  ping_network: [
    "ping", "mạng", "network", "disconnect", "dis", "rớt mạng", "mất kết nối",
    "lỗi kết nối", "server", "máy chủ", "đường truyền", "wifi", "4g", "5g",
  ],
  bug: [
    "lỗi", "bug", "error", "glitch", "sự cố", "không vào được", "kh vào",
    "báo lỗi", "kẹt", "sai hiển thị", "không nhận", "không hiện",
  ],
  event: [
    "sự kiện", "event", "mốc", "nhiệm vụ sự kiện", "chuỗi sự kiện", "đua top",
    "điểm sự kiện", "event mới", "sự kiện mới",
  ],
  hack_cheat: [
    "hack", "cheat", "gian lận", "aim", "aimbot", "wall", "wallhack", "auto",
    "tool", "mod", "bắn xuyên", "auto headshot", "tố hack", "hack tràn lan",
  ],
  payment_topup: [
    "nạp", "top up", "topup", "thanh toán", "mua gói", "gói nạp", "kim cương",
    "kc", "coin", "trừ tiền", "nạp không nhận", "chưa nhận", "momo", "zalopay",
    "sms", "vnd", "đồng", "hút máu", "p2w", "pay to win",
  ],
  login_account: [
    "đăng nhập", "login", "tài khoản", "account", "acc", "nick", "mất acc",
    "mất nick", "khóa nick", "khóa acc", "bị ban", "bị khóa", "otp", "mật khẩu",
    "đổi mật khẩu", "facebook login",
  ],
  performance_lag_crash: [
    "lag", "giật", "fps", "drop fps", "tụt fps", "văng", "crash", "treo",
    "đơ", "đứng hình", "freeze", "khựng", "nóng máy", "hao pin", "tối ưu",
  ],
  update_patch: [
    "update", "cập nhật", "bản vá", "patch", "phiên bản", "version", "tải bản",
    "dung lượng", "bảo trì", "sau update", "sau cập nhật",
  ],
  customer_support: [
    "cskh", "hỗ trợ", "support", "admin", "gm", "phản hồi", "ticket",
    "khiếu nại", "báo lỗi", "chăm sóc khách hàng", "xin hỗ trợ",
  ],
  gameplay: [
    "gameplay", "lối chơi", "chế độ", "mode", "map", "round", "màn", "combat",
    "đặt bom", "gỡ bom", "bom", "đấu đội", "rank", "leo rank", "nhiệm vụ",
    "kỹ năng", "skill", "điều khiển", "di chuyển", "bắn", "ngắm",
  ],
  matchmaking: [
    "ghép trận", "matchmaking", "tìm trận", "xếp trận", "phòng", "đội yếu",
    "đối thủ", "đồng đội", "chờ trận", "rank lệch", "match",
  ],
  balance: [
    "cân bằng", "balance", "buff", "nerf", "op", "imba", "quá mạnh", "quá yếu",
    "mất cân bằng", "bất công", "pay to win", "p2w", "hút máu",
  ],
  reward_gift: [
    "quà", "quà tặng", "phần thưởng", "gift", "giftcode", "code", "reward",
    "nhận quà", "đền bù", "coupon", "thưởng", "mốc thưởng",
  ],
  community_player_behavior: [
    "toxic", "chửi", "văng tục", "report", "phá game", "afk", "troll",
    "trẻ trâu", "gà", "noob", "cà khịa", "đồng đội phá",
  ],
  item_skin: [
    "skin", "súng", "vũ khí", "nhân vật", "item", "vật phẩm", "trang phục",
    "trang bị", "vip", "dao", "nhân vật nữ", "balo",
  ],
  gacha: [
    "gacha", "rương", "quay", "hộp", "roll", "spin", "random", "tỉ lệ",
    "rate", "mở rương", "may mắn", "xác suất",
  ],
  esports_content: [
    "giải đấu", "esports", "tournament", "stream", "livestream", "youtube",
    "tiktok", "video", "clip", "creator", "content",
  ],
  suggestion_request: [
    "đề xuất", "góp ý", "mong", "hy vọng", "nên thêm", "yêu cầu", "wish",
    "giá như", "đề nghị", "xin thêm", "cần thêm",
  ],
  spam_ads: [
    "spam", "quảng cáo", "link", "bán acc", "bán nick", "liên hệ zalo",
    "sđt", "shop acc", "http", "www.", "add zalo", "lừa đảo",
  ],
  other: [],
};

const GENERIC_MAJOR_TOPIC_TERMS = new Set([
  "bug", "loi", "error", "lag", "giat", "crash", "hack", "cheat", "ping", "mang",
  "nap", "dang nhap", "tai khoan", "event", "su kien", "update", "cap nhat",
  "support", "ho tro", "skin", "gacha", "ruong", "spam", "quang cao", "gameplay",
  "loi choi", "matchmaking", "ghep tran", "can bang", "qua", "gift", "code",
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
