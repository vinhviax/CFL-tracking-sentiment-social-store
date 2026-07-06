"""Comment explorer: filter + paginate comments with their analysis."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Analysis, Comment
from ..schemas import CommentPage

router = APIRouter(prefix="/api/comments", tags=["comments"])


@router.get("", response_model=CommentPage)
def list_comments(
    db: Session = Depends(get_db),
    source: str | None = None,
    topic: str | None = None,
    sentiment: str | None = None,
    urgency: str | None = None,
    q: str | None = None,
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
    page: int = 1,
    page_size: int = 50,
):
    stmt = select(Comment).options(selectinload(Comment.analysis))
    needs_analysis_join = any([topic, sentiment, urgency])
    if needs_analysis_join:
        stmt = stmt.join(Analysis, Analysis.comment_id == Comment.id)

    if source:
        stmt = stmt.where(Comment.source_type == source)
    if q:
        stmt = stmt.where(Comment.message.ilike(f"%{q}%"))
    if date_from:
        stmt = stmt.where(Comment.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Comment.created_at <= date_to)
    if topic:
        stmt = stmt.where(Analysis.topic_main == topic)
    if sentiment:
        stmt = stmt.where(Analysis.sentiment == sentiment)
    if urgency:
        stmt = stmt.where(Analysis.urgency == urgency)

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    stmt = stmt.order_by(Comment.created_at.desc().nullslast())
    stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    items = list(db.scalars(stmt).unique())
    return CommentPage(total=total or 0, page=page, page_size=page_size, items=items)
