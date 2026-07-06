"""Batch classification orchestrator.

Builds the prompt, calls the configured LLM provider on batches, validates the
JSON output with Pydantic, and falls back to the rule-based classifier for any
item the LLM fails to return or when no provider is configured.
"""
from __future__ import annotations

import json
import logging

from ...config import settings
from ...taxonomy import PROMPT_VERSION, TOPICS
from .base import Classification, CommentInput, LLMProvider
from .fallback import classify_fallback
from .providers import build_provider

log = logging.getLogger("classifier")

_SYSTEM = f"""Bạn là chuyên gia phân tích phản hồi người chơi cho game FPS mobile \
"Crossfire Legends" (CFL) của VNG tại Việt Nam. Người chơi bình luận bằng tiếng Việt, \
nhiều teencode/viết tắt. Một số quy ước: "văng"/"vang" = crash, "hút máu"/"p2w" = pay-to-win, \
"dis" = mất kết nối, "nạp" = nạp tiền, "gà"/"noob" = chơi kém, "acc"/"nick" = tài khoản.

Với MỖI bình luận, hãy phân loại:
- topic_main: MỘT chủ đề chính, chọn từ danh sách: {", ".join(TOPICS)}
- topics_sub: tối đa 2 chủ đề phụ khác (cùng danh sách trên), [] nếu không có
- sentiment: "negative" | "neutral" | "positive"
- urgency: "none" | "low" | "medium" | "high" (high = mất tiền, mất account, không vào được game, hack tràn lan)
- summary: 1 câu tiếng Việt ngắn tóm tắt ý chính
- other_suggested: nếu KHÔNG chủ đề nào khớp, đề xuất tên nhóm mới (tiếng Việt ngắn), ngược lại null
- confidence: số thực 0..1

TRẢ VỀ DUY NHẤT một JSON object có key "results" là mảng, mỗi phần tử gồm đúng các field:
id, topic_main, topics_sub, sentiment, urgency, summary, other_suggested, confidence.
Giữ nguyên id đã cho. Không thêm giải thích ngoài JSON."""


def _build_user(items: list[CommentInput]) -> str:
    lines = ["Phân loại các bình luận sau:\n"]
    for it in items:
        block = [f"[id={it.id}]"]
        if it.rating is not None:
            block.append(f"(rating store: {it.rating}/5 sao)")
        if it.context:
            block.append(f"Bối cảnh bài viết: {it.context[:300]}")
        block.append(f"Bình luận: {it.message[:1500]}")
        lines.append("\n".join(block))
        lines.append("---")
    return "\n".join(lines)


def _parse(raw: str) -> list[dict]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1] if "```" in raw[3:] else raw
        raw = raw.lstrip("json").strip().strip("`").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("["), raw.rfind("]")
        if start != -1 and end != -1:
            data = json.loads(raw[start:end + 1])
        else:
            start, end = raw.find("{"), raw.rfind("}")
            data = json.loads(raw[start:end + 1])
    if isinstance(data, dict):
        data = data.get("results") or data.get("data") or data.get("items") or [data]
    return data if isinstance(data, list) else []


class ClassifierService:
    def __init__(self) -> None:
        self.provider: LLMProvider | None = build_provider(
            settings.llm_provider,
            settings.llm_classify_model,
            anthropic_key=settings.anthropic_api_key,
            openai_key=settings.openai_api_key,
            base_url=settings.llm_base_url,
        )
        self.provider_name = self.provider.name if self.provider else "fallback"
        self.model = self.provider.model if self.provider else None
        self.prompt_version = PROMPT_VERSION

    def _classify_batch_llm(self, items: list[CommentInput]) -> dict[int, Classification]:
        assert self.provider is not None
        out: dict[int, Classification] = {}
        raw = self.provider.complete_json(_SYSTEM, _build_user(items))
        for rec in _parse(raw):
            try:
                c = Classification(**rec)
                out[c.id] = c
            except Exception as e:  # skip malformed record, fallback fills it later
                log.warning("bad classification record: %s", e)
        return out

    def classify(self, items: list[CommentInput]) -> list[Classification]:
        """Classify a list of items; always returns one Classification per input."""
        results: dict[int, Classification] = {}
        if self.provider is not None:
            size = settings.classify_batch_size
            for i in range(0, len(items), size):
                batch = items[i:i + size]
                try:
                    results.update(self._classify_batch_llm(batch))
                except Exception as e:
                    log.warning("LLM batch failed (%s), using fallback for %d items", e, len(batch))
        # Fill any missing ids (LLM off, batch failed, or dropped records).
        for it in items:
            if it.id not in results:
                c = classify_fallback(it)
                results[it.id] = c
        return [results[it.id] for it in items]
