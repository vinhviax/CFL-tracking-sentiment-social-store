"""Sensor Tower review ingest — ports the working logic from
../track_comment_sensortower_VN.py into the DB-backed pipeline.
"""
from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Comment, IngestRun

log = logging.getLogger("sensortower")

BASE_URL = "https://api.sensortower.com/v1/{os}/review/get_reviews"

# App configuration — Vietnam only (matches legacy script).
GOOGLE_APPS = {"VN": "com.vnggames.cfl.crossfirelegends"}
APPLE_APPS = {"VN": "6748588650"}

_DATE_FORMATS_IN = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"]


def _parse_review_date(value: str) -> datetime | None:
    value = (value or "").strip()
    if not value:
        return None
    # Sensor Tower typically returns ISO8601, sometimes with a trailing 'Z'.
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in _DATE_FORMATS_IN:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _dedupe_hash(store: str, region: str, author: str, date_val: str, content: str) -> str:
    key = f"st|{store}|{region}|{author.strip()}|{date_val.strip()}|{content.strip()}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def fetch_reviews(client: httpx.Client, os_platform: str, app_id: str, region_code: str,
                  start_date: str, end_date: str, api_key: str) -> list[dict]:
    """Fetch all pages of reviews for one app/region. Returns raw normalized dicts."""
    all_reviews: list[dict] = []
    store_name = "gp" if os_platform == "android" else "ios"
    url = BASE_URL.format(os=os_platform)
    page, limit = 1, 200

    while True:
        params = {
            "auth_token": api_key,
            "app_id": app_id,
            "country": region_code,
            "start_date": start_date,
            "end_date": end_date,
            "limit": limit,
            "page": page,
        }
        try:
            res = client.get(url, params=params, timeout=20)
        except httpx.HTTPError as e:
            log.error("network error fetching page %d: %s", page, e)
            break

        if res.status_code == 401:
            raise PermissionError("401 Unauthorized: Sensor Tower API key không hợp lệ.")
        if res.status_code == 403:
            raise PermissionError("403 Forbidden: Tài khoản không có quyền truy cập Review API.")
        if res.status_code != 200:
            log.warning("HTTP %d on page %d, stopping.", res.status_code, page)
            break

        data = res.json()
        if isinstance(data, list):
            reviews_list = data
        elif isinstance(data, dict):
            reviews_list = data.get("feedback", data.get("reviews", data.get("data", [])))
            if not isinstance(reviews_list, list):
                reviews_list = next((v for v in data.values() if isinstance(v, list)), [])
        else:
            reviews_list = []

        if not reviews_list:
            break

        for r in reviews_list:
            body = r.get("body", r.get("content", r.get("text", r.get("review", ""))))
            title = r.get("title", "")
            content = f"{title} - {body}" if title and title != body else body
            author = r.get("username", r.get("author", r.get("reviewer", r.get("nickname", "User"))))
            try:
                rating = int(r.get("rating", r.get("star_rating", r.get("score", 3))))
            except (TypeError, ValueError):
                rating = 3
            date_val = r.get("date", r.get("updated_at", r.get("created_at", r.get("at", ""))))
            all_reviews.append({
                "author": str(author), "rating": rating, "content": content or "",
                "date_raw": str(date_val), "store": store_name, "region": region_code,
            })

        if len(reviews_list) < limit:
            break
        page += 1
        time.sleep(0.5)

    return all_reviews


def ingest_sensortower(db: Session, *, start_date: str, end_date: str,
                       countries: list[str] | None = None) -> IngestRun:
    """Fetch Store reviews (GP + iOS, VN by default) and persist new comments."""
    run = IngestRun(source_type="store", status="running")
    db.add(run)
    db.flush()

    api_key = settings.sensortower_api_key
    if not api_key:
        run.status = "failed"
        run.error = "Thiếu SENSORTOWER_API_KEY trong .env / key_api.env"
        from datetime import timezone as _tz
        run.finished_at = datetime.now(_tz.utc)
        db.commit()
        db.refresh(run)
        return run

    regions = countries or list(GOOGLE_APPS.keys())
    fetched, new_count = 0, 0

    try:
        with httpx.Client() as client:
            for region in regions:
                targets = []
                if region in GOOGLE_APPS:
                    targets.append(("android", GOOGLE_APPS[region]))
                if region in APPLE_APPS:
                    targets.append(("ios", APPLE_APPS[region]))

                for os_platform, app_id in targets:
                    reviews = fetch_reviews(client, os_platform, app_id, region,
                                            start_date, end_date, api_key)
                    fetched += len(reviews)
                    for r in reviews:
                        dedupe = _dedupe_hash(r["store"], r["region"], r["author"],
                                              r["date_raw"], r["content"])
                        if db.query(Comment.id).filter_by(dedupe_hash=dedupe).first():
                            continue
                        comment = Comment(
                            source_type="store",
                            created_at=_parse_review_date(r["date_raw"]),
                            author_hint=r["author"],
                            message=r["content"],
                            rating=r["rating"],
                            country=r["region"],
                            store=r["store"],
                            dedupe_hash=dedupe,
                            ingest_run_id=run.id,
                            skipped_analysis=len((r["content"] or "").strip()) < 2,
                        )
                        db.add(comment)
                        new_count += 1
        run.status = "done"
    except PermissionError as e:
        run.status = "failed"
        run.error = str(e)
    except Exception as e:  # unexpected — surface to UI instead of crashing the request
        log.exception("sensortower ingest failed")
        run.status = "failed"
        run.error = f"Lỗi không xác định: {e}"

    run.rows_fetched = fetched
    run.rows_new = new_count
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run
