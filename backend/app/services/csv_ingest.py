"""Parse Facebook Group export CSV (Daily Detail.csv format) into the DB.

Format specifics handled:
- Encoding: UTF-16 LE w/ BOM (fallback utf-8-sig / utf-8).
- Delimiter: TAB.
- Only columns A-F are used: Source, Post Published Date, Post Message,
  Created Date, Comment Message, Topic(legacy).
- Multi-line quoted post messages spanning many physical lines.
- Dedupe by sha256(source | created_date | comment_message).
"""
from __future__ import annotations

import csv
import hashlib
import io
from datetime import datetime

from sqlalchemy.orm import Session

from ..models import Comment, IngestRun, Post

_DATE_FORMATS = ["%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"]
_EMPTY_MARKERS = {"", "...", ".", "-"}


def _decode(raw: bytes) -> str:
    for enc in ("utf-16", "utf-16-le", "utf-8-sig", "utf-8"):
        try:
            text = raw.decode(enc)
            # Heuristic: a correct decode of this file contains a tab.
            if "\t" in text or enc in ("utf-8-sig", "utf-8"):
                return text
        except (UnicodeDecodeError, UnicodeError):
            continue
    return raw.decode("utf-8", errors="replace")


def _parse_date(value: str) -> datetime | None:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _dedupe_hash(source: str, created: str, message: str) -> str:
    key = f"{source.strip()}|{created.strip()}|{message.strip()}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _is_empty_comment(msg: str) -> bool:
    return msg.strip().lower() in _EMPTY_MARKERS or len(msg.strip()) < 2


def parse_rows(raw: bytes) -> list[dict]:
    """Return parsed rows (cols A-F) without touching the DB."""
    text = _decode(raw)
    reader = csv.reader(io.StringIO(text), delimiter="\t")
    rows: list[dict] = []
    header_seen = False
    for cols in reader:
        if len(cols) < 5:
            continue
        a, b, c, d, e = (cols[0].strip(), cols[1].strip(), cols[2],
                         cols[3].strip(), cols[4])
        f = cols[5].strip() if len(cols) > 5 else None
        if not header_seen:
            header_seen = True
            if a.lower() == "source":  # skip header row
                continue
        rows.append({
            "source": a, "post_published": b, "post_message": c,
            "created_date": d, "comment_message": e, "legacy_topic": f,
        })
    return rows


def ingest_csv(db: Session, raw: bytes, filename: str = "") -> IngestRun:
    """Parse + persist. Returns the completed IngestRun (rows_fetched / rows_new)."""
    run = IngestRun(source_type="fb_group_csv", status="running", note=filename or None)
    db.add(run)
    db.flush()

    rows = parse_rows(raw)
    run.rows_fetched = len(rows)

    # cache posts within this run by (published_at, message) to attach comments
    post_cache: dict[str, Post] = {}
    new_count = 0

    for r in rows:
        source = r["source"] or "Group"
        source_type = "fb_page" if source.lower() == "fanpage" else "fb_group_csv"
        msg = r["comment_message"] or ""
        created = _parse_date(r["created_date"])
        dedupe = _dedupe_hash(source, r["created_date"], msg)

        exists = db.query(Comment.id).filter_by(dedupe_hash=dedupe).first()
        if exists:
            continue

        # resolve/create the parent post
        post = None
        pmsg = (r["post_message"] or "").strip()
        if pmsg:
            pkey = f"{r['post_published']}|{pmsg[:120]}"
            post = post_cache.get(pkey)
            if post is None:
                post = Post(
                    source_type=source_type,
                    published_at=_parse_date(r["post_published"]),
                    message=pmsg,
                )
                db.add(post)
                db.flush()
                post_cache[pkey] = post

        comment = Comment(
            post_id=post.id if post else None,
            source_type=source_type,
            created_at=created,
            message=msg,
            legacy_topic=r["legacy_topic"],
            dedupe_hash=dedupe,
            ingest_run_id=run.id,
            skipped_analysis=_is_empty_comment(msg),
        )
        db.add(comment)
        new_count += 1

    run.rows_new = new_count
    run.status = "done"
    from datetime import timezone
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run
