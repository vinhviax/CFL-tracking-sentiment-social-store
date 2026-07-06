"""Aggregate stats for the dashboard."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Analysis, Comment
from ..taxonomy import SENTIMENT_LABELS_VI, TOPIC_LABELS_VI

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _apply_filters(stmt, source, date_from, date_to):
    if source:
        stmt = stmt.where(Comment.source_type == source)
    if date_from:
        stmt = stmt.where(Comment.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Comment.created_at <= date_to)
    return stmt


@router.get("/overview")
def overview(
    db: Session = Depends(get_db),
    source: str | None = None,
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
):
    base = _apply_filters(select(func.count(Comment.id)), source, date_from, date_to)
    total_comments = db.scalar(base) or 0
    analyzed = db.scalar(_apply_filters(
        select(func.count(Comment.id)).join(Analysis, Analysis.comment_id == Comment.id),
        source, date_from, date_to)) or 0

    # sentiment breakdown
    sent_stmt = _apply_filters(
        select(Analysis.sentiment, func.count(Comment.id))
        .join(Analysis, Analysis.comment_id == Comment.id),
        source, date_from, date_to).group_by(Analysis.sentiment)
    sentiment = {s: 0 for s in SENTIMENT_LABELS_VI}
    for s, n in db.execute(sent_stmt):
        sentiment[s] = n

    # top topics
    topic_stmt = _apply_filters(
        select(Analysis.topic_main, func.count(Comment.id))
        .join(Analysis, Analysis.comment_id == Comment.id),
        source, date_from, date_to).group_by(Analysis.topic_main)
    topics = [
        {"topic": t, "label": TOPIC_LABELS_VI.get(t, t), "count": n}
        for t, n in sorted(db.execute(topic_stmt), key=lambda x: x[1], reverse=True)
    ]

    # hot issues: topic x negative x urgency>=medium
    hot_stmt = _apply_filters(
        select(
            Analysis.topic_main,
            func.count(Comment.id),
            func.sum(case((Analysis.urgency.in_(["medium", "high"]), 1), else_=0)),
        )
        .join(Analysis, Analysis.comment_id == Comment.id)
        .where(Analysis.sentiment == "negative"),
        source, date_from, date_to).group_by(Analysis.topic_main)
    hot = sorted(
        ({"topic": t, "label": TOPIC_LABELS_VI.get(t, t),
          "negative": n, "urgent": int(u or 0)}
         for t, n, u in db.execute(hot_stmt)),
        key=lambda x: (x["urgent"], x["negative"]), reverse=True,
    )[:8]

    neg = sentiment.get("negative", 0)
    return {
        "total_comments": total_comments,
        "analyzed": analyzed,
        "sentiment": sentiment,
        "negative_pct": round(neg / analyzed * 100, 1) if analyzed else 0.0,
        "top_topics": topics,
        "hot_issues": hot,
    }


@router.get("/trend")
def trend(
    db: Session = Depends(get_db),
    source: str | None = None,
    topic: str | None = None,
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
):
    day = func.date(Comment.created_at)
    stmt = (
        select(day, Analysis.sentiment, func.count(Comment.id))
        .join(Analysis, Analysis.comment_id == Comment.id)
    )
    stmt = _apply_filters(stmt, source, date_from, date_to)
    if topic:
        stmt = stmt.where(Analysis.topic_main == topic)
    stmt = stmt.group_by(day, Analysis.sentiment).order_by(day)

    series: dict[str, dict] = {}
    for d, sent, n in db.execute(stmt):
        if d is None:
            continue
        row = series.setdefault(str(d), {"date": str(d), "negative": 0, "neutral": 0, "positive": 0})
        row[sent] = n
    return list(series.values())


@router.get("/store")
def store_breakdown(
    db: Session = Depends(get_db),
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
):
    """Rating distribution + GP vs iOS split for Store reviews."""

    def _store_filtered(stmt):
        stmt = stmt.where(Comment.source_type == "store")
        if date_from:
            stmt = stmt.where(Comment.created_at >= date_from)
        if date_to:
            stmt = stmt.where(Comment.created_at <= date_to)
        return stmt

    rating_rows = db.execute(
        _store_filtered(select(Comment.rating, func.count(Comment.id))).group_by(Comment.rating)
    ).all()
    rating_dist = {str(r): 0 for r in range(1, 6)}
    for rating, n in rating_rows:
        if rating:
            rating_dist[str(rating)] = n

    platform_rows = db.execute(
        _store_filtered(select(Comment.store, func.count(Comment.id), func.avg(Comment.rating)))
        .group_by(Comment.store)
    ).all()
    platforms = [
        {"store": store or "unknown", "count": n, "avg_rating": round(avg or 0, 2)}
        for store, n, avg in platform_rows
    ]

    return {"rating_distribution": rating_dist, "platforms": platforms}
