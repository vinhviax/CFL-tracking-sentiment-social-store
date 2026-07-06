"""Facebook Graph API ingest for the official CFL Fanpage.

Fetches recent posts, then comments per post (including replies via
filter=stream), and persists them the same way as the CSV/Store pipelines.
Group data has no API — that stays on the CSV upload path (see csv_ingest.py).
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Comment, IngestRun, Post

log = logging.getLogger("facebook")

GRAPH_VERSION = "v19.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"


def _dedupe_hash(source: str, external_id: str) -> str:
    return hashlib.sha256(f"fb|{source}|{external_id}".encode("utf-8")).hexdigest()


def _parse_fb_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Graph API returns e.g. "2026-07-06T10:00:00+0700"
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None


def _graph_get(client: httpx.Client, url: str, params: dict) -> dict:
    res = client.get(url, params=params, timeout=20)
    data = res.json()
    if res.status_code != 200 or "error" in data:
        err = data.get("error", {})
        code = err.get("code")
        message = err.get("message", res.text[:200])
        if code == 190:
            raise PermissionError(
                f"Facebook Access Token đã hết hạn hoặc không hợp lệ: {message}"
            )
        raise RuntimeError(f"Facebook Graph API lỗi (code={code}): {message}")
    return data


def fetch_posts(client: httpx.Client, page_id: str, access_token: str,
                since: str | None = None, until: str | None = None,
                limit: int = 25) -> list[dict]:
    """Fetch posts with pagination, following paging.next until exhausted or empty page."""
    url = f"{GRAPH_BASE}/{page_id}/posts"
    params = {
        "access_token": access_token,
        "fields": "id,message,created_time,permalink_url",
        "limit": limit,
    }
    if since:
        params["since"] = since
    if until:
        params["until"] = until

    posts: list[dict] = []
    next_url, next_params = url, params
    while next_url:
        data = _graph_get(client, next_url, next_params)
        posts.extend(data.get("data", []))
        paging = data.get("paging", {})
        next_url = paging.get("next")
        next_params = {}  # `next` is a full URL already carrying all params
        if not data.get("data"):
            break
    return posts


def fetch_comments(client: httpx.Client, post_id: str, access_token: str,
                   limit: int = 100) -> list[dict]:
    """Fetch comments (including replies) for a single post, with pagination."""
    url = f"{GRAPH_BASE}/{post_id}/comments"
    params = {
        "access_token": access_token,
        "fields": "id,message,created_time,from,like_count",
        "filter": "stream",  # flattens top-level comments + replies
        "limit": limit,
    }
    comments: list[dict] = []
    next_url, next_params = url, params
    while next_url:
        data = _graph_get(client, next_url, next_params)
        comments.extend(data.get("data", []))
        paging = data.get("paging", {})
        next_url = paging.get("next")
        next_params = {}
        if not data.get("data"):
            break
    return comments


def ingest_facebook(db: Session, *, since: str | None = None, until: str | None = None,
                    post_limit: int = 25) -> IngestRun:
    """Pull recent Fanpage posts + comments via Graph API and persist new rows."""
    run = IngestRun(source_type="fb_page", status="running")
    db.add(run)
    db.flush()

    page_id = settings.fb_page_id
    token = settings.fb_access_token
    if not page_id or not token:
        run.status = "failed"
        run.error = "Thiếu FB_PAGE_ID hoặc FB_ACCESS_TOKEN trong .env"
        run.finished_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(run)
        return run

    fetched, new_count = 0, 0
    try:
        with httpx.Client() as client:
            posts = fetch_posts(client, page_id, token, since, until, post_limit)
            for p in posts:
                post_dedupe_key = p["id"]
                post = db.query(Post).filter_by(
                    source_type="fb_page", external_id=post_dedupe_key
                ).first()
                if post is None:
                    post = Post(
                        source_type="fb_page",
                        external_id=post_dedupe_key,
                        published_at=_parse_fb_date(p.get("created_time")),
                        message=p.get("message", ""),
                        permalink=p.get("permalink_url"),
                    )
                    db.add(post)
                    db.flush()

                comments = fetch_comments(client, p["id"], token)
                fetched += len(comments)
                for c in comments:
                    dedupe = _dedupe_hash("fb_page", c["id"])
                    if db.query(Comment.id).filter_by(dedupe_hash=dedupe).first():
                        continue
                    msg = c.get("message", "") or ""
                    comment = Comment(
                        post_id=post.id,
                        source_type="fb_page",
                        external_id=c["id"],
                        created_at=_parse_fb_date(c.get("created_time")),
                        author_hint=(c.get("from") or {}).get("name"),
                        message=msg,
                        dedupe_hash=dedupe,
                        ingest_run_id=run.id,
                        skipped_analysis=len(msg.strip()) < 2,
                    )
                    db.add(comment)
                    new_count += 1
        run.status = "done"
    except PermissionError as e:
        run.status = "failed"
        run.error = str(e)
    except Exception as e:
        log.exception("facebook ingest failed")
        run.status = "failed"
        run.error = f"Lỗi không xác định: {e}"

    run.rows_fetched = fetched
    run.rows_new = new_count
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run
