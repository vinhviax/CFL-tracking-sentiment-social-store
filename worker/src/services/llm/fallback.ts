// Ported from backend/app/services/llm/fallback.py — keep keyword sets in sync.
import type { Classification, CommentInput } from "./base";

const TOPIC_KEYWORDS: Record<string, string[]> = {
  hack_cheat: ["hack", "cheat", "gian lận", "aim", "wall", "auto", "tool", "mod "],
  payment_topup: ["nạp", "nap ", "top up", "topup", "thanh toán", "mua gói", "hút máu",
    "p2w", "pay to win", "tiền", "vnd", "đồng"],
  login_account: ["đăng nhập", "dang nhap", "login", "tài khoản", "tai khoan", "account",
    "mất acc", "mất nick", "khóa nick", "ban acc", "đổi mật khẩu"],
  performance_lag_crash: ["lag", "giật", "giat", "văng", "vang", "crash", "treo", "đơ",
    "đứng hình", "khựng", "nóng máy", "hao pin", "lác"],
  ping_network: ["ping", "mạng", "mang ", "disconnect", "dis ", "rớt mạng", "mất kết nối",
    "lỗi kết nối", "server", "máy chủ"],
  bug: ["lỗi", "loi ", "bug", "glitch", "không vào được", "kh vào", "báo lỗi", "sự cố"],
  update_patch: ["update", "cập nhật", "cap nhat", "bản vá", "patch", "phiên bản", "version",
    "tải bản", "dung lượng"],
  event: ["sự kiện", "su kien", "event", "mốc", "nhiệm vụ", "quà sự kiện"],
  reward_gift: ["quà", "qua tang", "phần thưởng", "gift", "code", "giftcode", "reward", "nhận quà", "tặng"],
  gacha: ["gacha", "rương", "ruong", "quay", "hộp", "roll", "tỉ lệ", "may mắn"],
  item_skin: ["skin", "súng", "sung ", "nhân vật", "vũ khí", "trang phục", "vip", "vật phẩm"],
  matchmaking: ["ghép trận", "ghep tran", "matchmaking", "tìm trận", "phòng", "team", "đồng đội"],
  balance: ["cân bằng", "can bang", "balance", "buff", "nerf", "op ", "imba", "mạnh quá", "yếu quá", "bất công"],
  customer_support: ["cskh", "hỗ trợ", "ho tro", "support", "admin", "gm ", "phản hồi", "ticket", "khiếu nại"],
  gameplay: ["chơi", "gameplay", "màn", "chế độ", "map", "bắn", "combat", "kỹ năng", "điều khiển"],
  esports_content: ["giải đấu", "esports", "stream", "youtube", "tiktok", "video", "clip", "livestream"],
  suggestion_request: ["đề xuất", "góp ý", "mong", "hy vọng", "nên thêm", "yêu cầu", "wish", "giá như"],
  spam_ads: ["bán acc", "bán nick", "liên hệ zalo", "sđt", "shop acc", "http", "www.", "add zalo"],
  community_player_behavior: ["toxic", "chửi", "văng tục", "report", "acc rác", "trẻ trâu", "gà", "noob", "cà khịa"],
};

const NEG_RE = /lag|giật|văng|lỗi|treo|hút máu|rác|tệ|chán|xấu|nát|dở|gà|kém|thất vọng|bực|\bbug\b|crash|\bhack\b|cheat|scam|worst|terrible|awful|p2w|unplayable|toxic/i;
const POS_RE = /mượt|đỉnh|hay|cuốn|vui|thích|tuyệt|ổn|ngon|tốt|yêu|good|great|nice|love|best|fun|awesome|perfect|amazing|đẹp|hài lòng|ủng hộ/i;
const HIGH_URGENCY_RE = /mất tiền|mất acc|mất nick|không vào được|kh vào|scam|lừa đảo|bị khóa|hack tràn lan|trừ tiền|nạp không nhận|lag không chơi được/i;

function countMatches(re: RegExp, text: string): number {
  const m = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
  return m ? m.length : 0;
}

function sentimentOf(text: string, rating?: number | null): string {
  if (rating != null) {
    if (rating <= 2) return "negative";
    if (rating >= 4) return "positive";
  }
  const neg = countMatches(NEG_RE, text);
  const pos = countMatches(POS_RE, text);
  if (neg > pos) return "negative";
  if (pos > neg) return "positive";
  return "neutral";
}

function topicsOf(text: string): string[] {
  const low = text.toLowerCase();
  const hits: [string, number][] = [];
  for (const [topic, kws] of Object.entries(TOPIC_KEYWORDS)) {
    const score = kws.reduce((acc, kw) => acc + (low.includes(kw) ? 1 : 0), 0);
    if (score > 0) hits.push([topic, score]);
  }
  hits.sort((a, b) => b[1] - a[1]);
  return hits.map(([t]) => t);
}

export function classifyFallback(item: CommentInput): Classification {
  const text = item.message || "";
  const topics = topicsOf(text);
  const main = topics[0] || (text.length > 3 ? "gameplay" : "other");
  const subs = topics.slice(1, 3);
  const sentiment = sentimentOf(text, item.rating);
  const urgency = HIGH_URGENCY_RE.test(text)
    ? "high"
    : sentiment === "negative" && topics.length > 0
      ? "medium"
      : "none";
  return {
    id: item.id,
    topic_main: main,
    topics_sub: subs,
    sentiment,
    urgency,
    summary: "",
    other_suggested: null,
    confidence: 0.35,
  };
}
