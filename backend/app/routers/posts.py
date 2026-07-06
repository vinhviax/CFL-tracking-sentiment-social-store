"""Post listing — powers the Facebook drill-down (post -> its comments)."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Analysis, Comment, Post

router = APIRouter(prefix="/api/posts", tags=["posts"])


@router.get("")
def list_posts(
    db: Session = Depends(get_db),
    source: str | None = None,
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
    limit: int = 100,
):
    stmt = (
        select(
            Post.id, Post.source_type, Post.external_id, Post.published_at,
            Post.message, Post.permalink,
            func.count(Comment.id),
            func.sum(case((Analysis.sentiment == "negative", 1), else_=0)),
        )
        .outerjoin(Comment, Comment.post_id == Post.id)
        .outerjoin(Analysis, Analysis.comment_id == Comment.id)
        .group_by(Post.id)
        .order_by(Post.published_at.desc().nullslast())
        .limit(limit)
    )
    if source:
        stmt = stmt.where(Post.source_type == source)
    if date_from:
        stmt = stmt.where(Post.published_at >= date_from)
    if date_to:
        stmt = stmt.where(Post.published_at <= date_to)

    rows = db.execute(stmt).all()
    return [
        {
            "id": r[0], "source_type": r[1], "external_id": r[2],
            "published_at": r[3].isoformat() if r[3] else None,
            "message": r[4], "permalink": r[5],
            "comment_count": r[6] or 0, "negative_count": int(r[7] or 0),
        }
        for r in rows
    ]
