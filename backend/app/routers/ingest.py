"""Ingest endpoints: CSV upload (Group), Sensor Tower (Store), Facebook Graph (Fanpage)."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import RunOut
from ..services.csv_ingest import ingest_csv, parse_rows
from ..services.facebook import ingest_facebook as _ingest_facebook
from ..services.sensortower import ingest_sensortower as _ingest_sensortower

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


class SensorTowerRequest(BaseModel):
    start_date: str | None = None  # YYYY-MM-DD
    end_date: str | None = None
    countries: list[str] | None = None


class FacebookRequest(BaseModel):
    since: str | None = None  # YYYY-MM-DD
    until: str | None = None
    post_limit: int = 25


@router.post("/upload-csv", response_model=RunOut)
async def upload_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    try:
        run = ingest_csv(db, raw, filename=file.filename or "")
    except Exception as e:  # surface parse errors clearly to the UI
        raise HTTPException(422, f"Không parse được file CSV: {e}")
    return run


@router.post("/preview-csv")
async def preview_csv(file: UploadFile = File(...)):
    """Parse without persisting — returns row counts + first 10 rows for the UI."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    try:
        rows = parse_rows(raw)
    except Exception as e:
        raise HTTPException(422, f"Không parse được file CSV: {e}")
    sample = [
        {
            "source": r["source"],
            "created_date": r["created_date"],
            "comment_message": (r["comment_message"] or "")[:200],
            "legacy_topic": r["legacy_topic"],
        }
        for r in rows[:10]
    ]
    return {"total_rows": len(rows), "sample": sample}


@router.post("/sensortower", response_model=RunOut)
def ingest_sensortower(req: SensorTowerRequest, db: Session = Depends(get_db)):
    end = req.end_date or datetime.now().strftime("%Y-%m-%d")
    start = req.start_date or (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    run = _ingest_sensortower(db, start_date=start, end_date=end, countries=req.countries)
    if run.status == "failed":
        raise HTTPException(502, run.error or "Sensor Tower ingest thất bại")
    return run


@router.post("/facebook", response_model=RunOut)
def ingest_facebook(req: FacebookRequest, db: Session = Depends(get_db)):
    run = _ingest_facebook(db, since=req.since, until=req.until, post_limit=req.post_limit)
    if run.status == "failed":
        raise HTTPException(502, run.error or "Facebook ingest thất bại")
    return run
