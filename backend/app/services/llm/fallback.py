"""Rule-based fallback classifier — runs when no LLM key is configured, or when
an LLM batch fails. Keyword sets are seeded from the legacy CFL scraper so P1
produces usable output out of the box. Marked provider='fallback' in the DB.
"""
from __future__ import annotations

import re

from .base import Classification, CommentInput

# topic -> list of lowercase substring/regex keywords (Vietnamese + English)
_TOPIC_KEYWORDS: dict[str, list[str]] = {
    "hack_cheat": ["hack", "cheat", "gian lận", "aim", "wall", "auto", "tool", "mod "],
    "payment_topup": ["nạp", "nap ", "top up", "topup", "thanh toán", "mua gói", "hút máu",
                       "p2w", "pay to win", "tiền", "vnd", "đồng"],
    "login_account": ["đăng nhập", "dang nhap", "login", "tài khoản", "tai khoan", "account",
                      "mất acc", "mất nick", "khóa nick", "ban acc", "đổi mật khẩu"],
    "performance_lag_crash": ["lag", "giật", "giat", "văng", "vang", "crash", "treo", "đơ",
                              "đứng hình", "khựng", "nóng máy", "hao pin", "lác"],
    "ping_network": ["ping", "mạng", "mang ", "disconnect", "dis ", "rớt mạng", "mất kết nối",
                     "lỗi kết nối", "server", "máy chủ"],
    "bug": ["lỗi", "loi ", "bug", "glitch", "không vào được", "kh vào", "báo lỗi", "sự cố"],
    "update_patch": ["update", "cập nhật", "cap nhat", "bản vá", "patch", "phiên bản", "version",
                     "tải bản", "dung lượng"],
    "event": ["sự kiện", "su kien", "event", "mốc", "nhiệm vụ", "quà sự kiện"],
    "reward_gift": ["quà", "qua tang", "phần thưởng", "gift", "code", "giftcode", "reward",
                    "nhận quà", "tặng"],
    "gacha": ["gacha", "rương", "ruong", "quay", "hộp", "roll", "tỉ lệ", "may mắn"],
    "item_skin": ["skin", "súng", "sung ", "nhân vật", "vũ khí", "trang phục", "vip", "vật phẩm"],
    "matchmaking": ["ghép trận", "ghep tran", "matchmaking", "tìm trận", "phòng", "team", "đồng đội"],
    "balance": ["cân bằng", "can bang", "balance", "buff", "nerf", "op ", "imba", "mạnh quá",
                "yếu quá", "bất công"],
    "customer_support": ["cskh", "hỗ trợ", "ho tro", "support", "admin", "gm ", "phản hồi",
                         "ticket", "khiếu nại"],
    "gameplay": ["chơi", "gameplay", "màn", "chế độ", "map", "bắn", "combat", "kỹ năng", "điều khiển"],
    "esports_content": ["giải đấu", "esports", "stream", "youtube", "tiktok", "video", "clip", "livestream"],
    "suggestion_request": ["đề xuất", "góp ý", "mong", "hy vọng", "nên thêm", "yêu cầu", "wish", "giá như"],
    "spam_ads": ["bán acc", "bán nick", "liên hệ zalo", "sđt", "shop acc", "http", "www.", "add zalo"],
    "community_player_behavior": ["toxic", "chửi", "văng tục", "report", "acc rác", "trẻ trâu",
                                  "gà", "noob", "cà khịa"],
}

# Negative / positive Vietnamese+English cues (from legacy KEYWORD_DICT).
_NEG = re.compile(
    r"lag|giật|văng|lỗi|treo|hút máu|rác|tệ|chán|xấu|nát|dở|gà|kém|thất vọng|bực|"
    r"\bbug\b|crash|\bhack\b|cheat|scam|worst|terrible|awful|p2w|unplayable|toxic",
    re.IGNORECASE,
)
_POS = re.compile(
    r"mượt|đỉnh|hay|cuốn|vui|thích|tuyệt|ổn|ngon|tốt|yêu|good|great|nice|love|best|"
    r"fun|awesome|perfect|amazing|đẹp|hài lòng|ủng hộ",
    re.IGNORECASE,
)
_HIGH_URGENCY = re.compile(
    r"mất tiền|mất acc|mất nick|không vào được|kh vào|scam|lừa đảo|bị khóa|hack tràn lan|"
    r"trừ tiền|nạp không nhận|lag không chơi được",
    re.IGNORECASE,
)


def _sentiment(text: str, rating: int | None) -> str:
    if rating is not None:
        if rating <= 2:
            return "negative"
        if rating >= 4:
            return "positive"
    neg = len(_NEG.findall(text))
    pos = len(_POS.findall(text))
    if neg > pos:
        return "negative"
    if pos > neg:
        return "positive"
    return "neutral"


def _topics(text: str) -> list[str]:
    low = text.lower()
    hits: list[tuple[str, int]] = []
    for topic, kws in _TOPIC_KEYWORDS.items():
        score = sum(1 for kw in kws if kw in low)
        if score:
            hits.append((topic, score))
    hits.sort(key=lambda x: x[1], reverse=True)
    return [t for t, _ in hits]


def classify_fallback(item: CommentInput) -> Classification:
    text = item.message or ""
    topics = _topics(text)
    main = topics[0] if topics else ("gameplay" if len(text) > 3 else "other")
    subs = topics[1:3]
    sent = _sentiment(text, item.rating)
    urg = "high" if _HIGH_URGENCY.search(text) else ("medium" if sent == "negative" and topics else "none")
    return Classification(
        id=item.id,
        topic_main=main,
        topics_sub=subs,
        sentiment=sent,
        urgency=urg,
        summary="",
        confidence=0.35,  # rule-based: low confidence by design
    )
