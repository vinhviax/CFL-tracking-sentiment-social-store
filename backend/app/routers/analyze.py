"""Analyze endpoints: kick off classification and poll progress."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..models import Comment
from ..schemas import AnalyzeRequest
from ..services.analysis import PROGRESS, run_analysis

router = APIRouter(prefix="/api/analyze", tags=["analyze"])


def _run_bg(comment_ids, only_unanalyzed, progress_key):
    db = SessionLocal()
    try:
        run_analysis(db, comment_ids=comment_ids,
                     only_unanalyzed=only_unanalyzed, progress_key=progress_key)
    finally:
        db.close()


@router.post("/run")
def analyze_run(req: AnalyzeRequest, background: BackgroundTasks,
                db: Session = Depends(get_db)):
    comment_ids = req.comment_ids
    if req.run_id and not comment_ids:
        comment_ids = [
            cid for (cid,) in db.query(Comment.id)
            .filter(Comment.ingest_run_id == req.run_id).all()
        ]
    progress_key = f"run-{req.run_id}" if req.run_id else "adhoc"
    PROGRESS[progress_key] = {"done": 0, "total": 0, "status": "queued"}
    background.add_task(_run_bg, comment_ids, req.only_unanalyzed, progress_key)
    return {"progress_key": progress_key, "status": "queued"}


@router.get("/progress/{progress_key}")
def analyze_progress(progress_key: str):
    return PROGRESS.get(progress_key, {"status": "unknown", "done": 0, "total": 0})
