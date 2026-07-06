"""Ingest run history."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import IngestRun
from ..schemas import RunOut

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.get("", response_model=list[RunOut])
def list_runs(db: Session = Depends(get_db), limit: int = 50):
    stmt = select(IngestRun).order_by(IngestRun.id.desc()).limit(limit)
    return list(db.scalars(stmt))


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(IngestRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run
