"""LLM provider abstraction + Pydantic schema for a single classification."""
from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field, field_validator

from ...taxonomy import SENTIMENTS, TOPICS, URGENCIES


class CommentInput(BaseModel):
    """One item handed to the classifier."""

    id: int
    message: str
    context: str | None = None  # e.g. parent post message (truncated)
    rating: int | None = None   # store reviews: 1..5


class Classification(BaseModel):
    """Validated LLM (or fallback) output for one comment."""

    id: int
    topic_main: str
    topics_sub: list[str] = Field(default_factory=list)
    sentiment: str
    urgency: str = "none"
    summary: str = ""
    other_suggested: str | None = None
    confidence: float = 0.0

    @field_validator("topic_main")
    @classmethod
    def _valid_topic(cls, v: str) -> str:
        return v if v in TOPICS else "other"

    @field_validator("sentiment")
    @classmethod
    def _valid_sentiment(cls, v: str) -> str:
        v = (v or "").lower()
        return v if v in SENTIMENTS else "neutral"

    @field_validator("urgency")
    @classmethod
    def _valid_urgency(cls, v: str) -> str:
        v = (v or "none").lower()
        return v if v in URGENCIES else "none"

    @field_validator("topics_sub")
    @classmethod
    def _valid_subs(cls, v: list[str]) -> list[str]:
        return [t for t in (v or []) if t in TOPICS][:2]


class LLMProvider(ABC):
    """Providers return raw JSON text for a batch; classifier validates it."""

    name: str = "base"

    def __init__(self, model: str):
        self.model = model

    @abstractmethod
    def complete_json(self, system: str, user: str) -> str:
        """Return the model's response as a JSON string (a JSON array)."""
        raise NotImplementedError

    @abstractmethod
    def complete_text(self, system: str, user: str) -> str:
        """Return the model's response as free-form text (no JSON mode)."""
        raise NotImplementedError
