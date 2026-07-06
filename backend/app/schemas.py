"""API response/request schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RunOut(BaseModel):
    id: int
    source_type: str
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    rows_fetched: int
    rows_new: int
    note: str | None = None
    error: str | None = None

    class Config:
        from_attributes = True


class AnalysisOut(BaseModel):
    topic_main: str
    topics_sub: list[str] = []
    sentiment: str
    urgency: str
    summary: str | None = None
    other_suggested: str | None = None
    confidence: float
    provider: str
    model: str | None = None

    class Config:
        from_attributes = True


class CommentOut(BaseModel):
    id: int
    source_type: str
    created_at: datetime | None = None
    message: str
    rating: int | None = None
    country: str | None = None
    store: str | None = None
    legacy_topic: str | None = None
    post_id: int | None = None
    analysis: AnalysisOut | None = None

    class Config:
        from_attributes = True


class CommentPage(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[CommentOut]


class AnalyzeRequest(BaseModel):
    run_id: int | None = None
    comment_ids: list[int] | None = None
    only_unanalyzed: bool = True
