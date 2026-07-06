"""ORM models for the CFL feedback pipeline."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class IngestRun(Base):
    __tablename__ = "ingest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_type: Mapped[str] = mapped_column(String(32))  # store | fb_page | fb_group_csv
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="running")  # running|done|failed
    rows_fetched: Mapped[int] = mapped_column(Integer, default=0)
    rows_new: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    comments: Mapped[list["Comment"]] = relationship(back_populates="ingest_run")


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (UniqueConstraint("source_type", "external_id", name="uq_post_source_ext"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_type: Mapped[str] = mapped_column(String(32))
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    permalink: Mapped[str | None] = mapped_column(String(512), nullable=True)

    comments: Mapped[list["Comment"]] = relationship(back_populates="post")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int | None] = mapped_column(ForeignKey("posts.id"), nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), index=True)  # store|fb_page|fb_group_csv
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    author_hint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    message: Mapped[str] = mapped_column(Text)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    country: Mapped[str | None] = mapped_column(String(8), nullable=True)
    store: Mapped[str | None] = mapped_column(String(8), nullable=True)  # gp | ios
    legacy_topic: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dedupe_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    skipped_analysis: Mapped[bool] = mapped_column(default=False)

    ingest_run_id: Mapped[int | None] = mapped_column(ForeignKey("ingest_runs.id"), nullable=True)

    post: Mapped["Post"] = relationship(back_populates="comments")
    ingest_run: Mapped["IngestRun"] = relationship(back_populates="comments")
    analysis: Mapped["Analysis"] = relationship(
        back_populates="comment", uselist=False, cascade="all, delete-orphan"
    )


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    comment_id: Mapped[int] = mapped_column(ForeignKey("comments.id"), unique=True, index=True)
    topic_main: Mapped[str] = mapped_column(String(64), index=True)
    topics_sub: Mapped[list] = mapped_column(JSON, default=list)
    sentiment: Mapped[str] = mapped_column(String(16), index=True)
    urgency: Mapped[str] = mapped_column(String(16), default="none", index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    other_suggested: Mapped[str | None] = mapped_column(String(128), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    provider: Mapped[str] = mapped_column(String(32))  # anthropic|openai|...|fallback
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prompt_version: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="ok")  # ok|skipped|failed
    analyzed_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    comment: Mapped["Comment"] = relationship(back_populates="analysis")
