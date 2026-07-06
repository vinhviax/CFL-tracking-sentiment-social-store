"""Ingest endpoints. P1 implements CSV upload; Store/FB are P2 stubs."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import RunOut
from ..services.csv_ingest import ingest_csv, parse_rows

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


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


@router.post("/sensortower")
async def ingest_sensortower():
    raise HTTPException(501, "Sensor Tower ingest sẽ được triển khai ở Phase 2.")


@router.post("/facebook")
async def ingest_facebook():
    raise HTTPException(501, "Facebook Graph ingest sẽ được triển khai ở Phase 2.")
