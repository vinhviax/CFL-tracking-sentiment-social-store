"""Daily automation: pull Sensor Tower + Facebook, then analyze new comments.

Runs inside the FastAPI process via APScheduler, on SCHEDULE_DAILY_CRON.
Each ingest source is independent — one failing (e.g. bad API key) never
blocks the others or the subsequent analysis pass.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import settings
from .database import SessionLocal
from .services.analysis import run_analysis
from .services.facebook import ingest_facebook
from .services.sensortower import ingest_sensortower

log = logging.getLogger("scheduler")

_scheduler: BackgroundScheduler | None = None


def daily_job() -> None:
    log.info("daily_job: starting scheduled ingest + analysis")
    db = SessionLocal()
    try:
        end = datetime.now().strftime("%Y-%m-%d")
        start = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")  # small overlap, dedupe handles it

        try:
            run = ingest_sensortower(db, start_date=start, end_date=end)
            log.info("sensortower: status=%s new=%d", run.status, run.rows_new)
        except Exception:
            log.exception("sensortower scheduled ingest failed")

        try:
            run = ingest_facebook(db)
            log.info("facebook: status=%s new=%d", run.status, run.rows_new)
        except Exception:
            log.exception("facebook scheduled ingest failed")

        try:
            result = run_analysis(db, only_unanalyzed=True, progress_key="scheduled")
            log.info("analysis: %s", result)
        except Exception:
            log.exception("scheduled analysis failed")
    finally:
        db.close()


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    _scheduler = BackgroundScheduler(timezone="Asia/Ho_Chi_Minh")
    trigger = CronTrigger.from_crontab(settings.schedule_daily_cron)
    _scheduler.add_job(daily_job, trigger, id="daily_ingest_analyze", replace_existing=True)
    _scheduler.start()
    log.info("scheduler started: cron='%s'", settings.schedule_daily_cron)
    return _scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
