"""Analysis orchestrator: pull un-analyzed comments, classify, persist.

Resumable by design — only processes comments that don't yet have an Analysis
row for the current PROMPT_VERSION, so a crash mid-run just resumes next call.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Analysis, Comment, Post
from ..taxonomy import PROMPT_VERSION
from .llm.base import CommentInput
from .llm.classifier import ClassifierService

log = logging.getLogger("analysis")

# module-level progress registry for UI polling: run_key -> {done, total}
PROGRESS: dict[str, dict] = {}


def _pending_comments(db: Session, comment_ids: list[int] | None = None,
                      only_unanalyzed: bool = True) -> list[Comment]:
    stmt = select(Comment).where(Comment.skipped_analysis == False)  # noqa: E712
    if comment_ids:
        stmt = stmt.where(Comment.id.in_(comment_ids))
    rows = list(db.scalars(stmt))
    if only_unanalyzed:
        rows = [
            c for c in rows
            if c.analysis is None or c.analysis.prompt_version != PROMPT_VERSION
        ]
    return rows


def run_analysis(db: Session, *, comment_ids: list[int] | None = None,
                 only_unanalyzed: bool = True, progress_key: str = "adhoc") -> dict:
    svc = ClassifierService()
    comments = _pending_comments(db, comment_ids, only_unanalyzed)
    total = len(comments)
    PROGRESS[progress_key] = {"done": 0, "total": total,
                              "provider": svc.provider_name, "status": "running"}
    if total == 0:
        PROGRESS[progress_key]["status"] = "done"
        return {"analyzed": 0, "provider": svc.provider_name, "total": 0}

    batch = 60  # DB commit granularity (LLM batching handled inside classifier)
    analyzed = 0
    for i in range(0, total, batch):
        chunk = comments[i:i + batch]
        inputs: list[CommentInput] = []
        for c in chunk:
            ctx = None
            if c.post_id:
                post = db.get(Post, c.post_id)
                ctx = post.message if post else None
            inputs.append(CommentInput(id=c.id, message=c.message, context=ctx, rating=c.rating))

        results = svc.classify(inputs)
        by_id = {r.id: r for r in results}

        for c in chunk:
            r = by_id[c.id]
            existing = c.analysis
            if existing is None:
                existing = Analysis(comment_id=c.id)
                db.add(existing)
            existing.topic_main = r.topic_main
            existing.topics_sub = r.topics_sub
            existing.sentiment = r.sentiment
            existing.urgency = r.urgency
            existing.summary = r.summary
            existing.other_suggested = r.other_suggested
            existing.confidence = r.confidence
            existing.provider = svc.provider_name
            existing.model = svc.model
            existing.prompt_version = PROMPT_VERSION
            existing.status = "ok"
            analyzed += 1

        db.commit()
        PROGRESS[progress_key]["done"] = min(i + batch, total)

    PROGRESS[progress_key]["status"] = "done"
    log.info("analysis done: %d comments via %s", analyzed, svc.provider_name)
    return {"analyzed": analyzed, "provider": svc.provider_name, "total": total}
