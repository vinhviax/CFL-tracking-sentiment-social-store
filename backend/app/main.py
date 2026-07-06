"""FastAPI application entrypoint for the CFL Feedback Intelligence backend."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .routers import analyze, comments, ingest, insights, posts, runs, stats
from .scheduler import shutdown_scheduler, start_scheduler
from .taxonomy import (
    PROMPT_VERSION,
    SENTIMENT_LABELS_VI,
    TOPIC_LABELS_VI,
    URGENCIES,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(title="CFL Feedback Intelligence API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # internal tool; tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router)
app.include_router(analyze.router)
app.include_router(comments.router)
app.include_router(runs.router)
app.include_router(stats.router)
app.include_router(insights.router)
app.include_router(posts.router)


@app.on_event("startup")
def _startup():
    init_db()
    start_scheduler()


@app.on_event("shutdown")
def _shutdown():
    shutdown_scheduler()


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "llm_provider": settings.llm_provider,
        "llm_ready": settings.has_llm_key,
        "prompt_version": PROMPT_VERSION,
    }


@app.get("/api/meta")
def meta():
    """Taxonomy metadata for the frontend (labels, sentiments, urgencies)."""
    return {
        "topics": TOPIC_LABELS_VI,
        "sentiments": SENTIMENT_LABELS_VI,
        "urgencies": URGENCIES,
        "prompt_version": PROMPT_VERSION,
    }
