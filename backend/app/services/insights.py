"""LLM-generated narrative insight summary over a filtered period.

Uses LLM_INSIGHT_MODEL (a larger model than the per-comment classifier) to
synthesize top topics / hot issues / sample negative comments into a short
Vietnamese summary for the dashboard. Falls back to a templated summary when
no LLM key is configured.
"""
from __future__ import annotations

from ..config import settings
from .llm.providers import build_provider

# simple in-process cache keyed by the exact filter tuple — good enough for
# an internal dashboard; avoids re-calling the LLM on every page refresh.
_CACHE: dict[tuple, str] = {}


def _fallback_summary(overview: dict) -> str:
    neg_pct = overview.get("negative_pct", 0)
    top = overview.get("top_topics", [])[:3]
    hot = overview.get("hot_issues", [])[:3]
    lines = [
        f"Tổng {overview.get('total_comments', 0)} phản hồi, {neg_pct}% mang sắc thái tiêu cực.",
    ]
    if top:
        names = ", ".join(t["label"] for t in top)
        lines.append(f"Chủ đề được nhắc nhiều nhất: {names}.")
    if hot:
        names = ", ".join(h["label"] for h in hot)
        lines.append(f"Vấn đề cần chú ý (nhiều phản hồi tiêu cực/khẩn cấp): {names}.")
    lines.append("(Tóm tắt mẫu — cấu hình LLM_PROVIDER + API key để có phân tích sâu hơn từ AI.)")
    return " ".join(lines)


def _build_prompt(overview: dict, sample_negatives: list[str]) -> tuple[str, str]:
    system = (
        "Bạn là chuyên gia phân tích sản phẩm game, viết báo cáo insight ngắn gọn cho "
        "đội vận hành game Crossfire Legends (CFL) dựa trên số liệu phản hồi người chơi. "
        "Viết bằng tiếng Việt, súc tích, 3-5 câu, tập trung vào vấn đề nổi cộm và đề xuất hành động. "
        "Không lặp lại số liệu thô một cách máy móc — hãy diễn giải ý nghĩa."
    )
    lines = [
        f"Tổng phản hồi: {overview.get('total_comments', 0)}, đã phân tích: {overview.get('analyzed', 0)}.",
        f"Tỉ lệ tiêu cực: {overview.get('negative_pct', 0)}%.",
        "Top chủ đề: " + ", ".join(f"{t['label']} ({t['count']})" for t in overview.get("top_topics", [])[:6]),
        "Vấn đề nổi cộm (tiêu cực + khẩn cấp): " + ", ".join(
            f"{h['label']} ({h['negative']} tiêu cực, {h['urgent']} khẩn cấp)"
            for h in overview.get("hot_issues", [])[:5]
        ),
    ]
    if sample_negatives:
        lines.append("Một số bình luận tiêu cực tiêu biểu:")
        lines.extend(f"- {s[:200]}" for s in sample_negatives[:8])
    lines.append("\nHãy viết insight tổng hợp cho team vận hành.")
    return system, "\n".join(lines)


def generate_summary(overview: dict, sample_negatives: list[str], cache_key: tuple) -> str:
    if cache_key in _CACHE:
        return _CACHE[cache_key]

    provider = build_provider(
        settings.llm_provider,
        settings.llm_insight_model,
        anthropic_key=settings.anthropic_api_key,
        openai_key=settings.openai_api_key,
        base_url=settings.llm_base_url,
    )
    if provider is None:
        text = _fallback_summary(overview)
    else:
        system, user = _build_prompt(overview, sample_negatives)
        try:
            text = provider.complete_text(system, user).strip()
        except Exception:
            text = _fallback_summary(overview)

    _CACHE[cache_key] = text
    return text
