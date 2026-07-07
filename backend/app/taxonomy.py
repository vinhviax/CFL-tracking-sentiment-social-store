"""Feedback classification taxonomy — shared by LLM prompt and fallback classifier.

Bump PROMPT_VERSION whenever the taxonomy or the classification prompt changes,
so analyses can be selectively re-run without re-processing everything.
"""
from __future__ import annotations

PROMPT_VERSION = "v4"

# Canonical topic keys. LLM may propose new groups via `other_suggested`.
TOPICS: list[str] = [
    "function",
    "ping_network",
    "bug",
    "event",
    "hack_cheat",
    "payment_topup",
    "login_account",
    "performance_lag_crash",
    "update_patch",
    "customer_support",
    "gameplay",
    "matchmaking",
    "balance",
    "reward_gift",
    "community_player_behavior",
    "item_skin",
    "gacha",
    "esports_content",
    "suggestion_request",
    "spam_ads",
    "game_comparison",
    "other",
]

# Vietnamese display labels for the UI.
TOPIC_LABELS_VI: dict[str, str] = {
    "function": "Tính năng",
    "ping_network": "Ping/Mạng",
    "bug": "Lỗi (Bug)",
    "event": "Sự kiện",
    "hack_cheat": "Hack/Cheat",
    "payment_topup": "Nạp tiền/Thanh toán",
    "login_account": "Đăng nhập/Tài khoản",
    "performance_lag_crash": "Hiệu năng/Lag/Crash",
    "update_patch": "Cập nhật/Bản vá",
    "customer_support": "Hỗ trợ khách hàng",
    "gameplay": "Lối chơi",
    "matchmaking": "Ghép trận",
    "balance": "Cân bằng game",
    "reward_gift": "Phần thưởng/Quà",
    "community_player_behavior": "Cộng đồng/Hành vi người chơi",
    "item_skin": "Vật phẩm/Skin",
    "gacha": "Gacha/Rương",
    "esports_content": "Esports/Nội dung",
    "suggestion_request": "Góp ý/Yêu cầu",
    "spam_ads": "Spam/Quảng cáo",
    "game_comparison": "So Sánh Game",
    "other": "Khác",
}

SENTIMENTS = ["negative", "neutral", "positive"]
SENTIMENT_LABELS_VI = {
    "negative": "Tiêu cực",
    "neutral": "Trung lập",
    "positive": "Tích cực",
}

URGENCIES = ["none", "low", "medium", "high"]
