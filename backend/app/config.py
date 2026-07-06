"""Application configuration loaded from .env (and legacy key_api.env)."""
from __future__ import annotations

import sys
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Ensure UTF-8 console output on Windows (Vietnamese / Thai / emoji safe).
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass

# Repo root = two levels up from this file (backend/app/config.py -> repo/)
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)


class Settings(BaseSettings):
    # Load .env first, then legacy key_api.env as a fallback for the ST key.
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / "key_api.env", REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Sensor Tower
    sensortower_api_key: str = ""

    # Facebook Graph API (Fanpage)
    fb_page_id: str = ""
    fb_access_token: str = ""

    # LLM
    llm_provider: str = "anthropic"  # anthropic | openai | openai_compatible
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    llm_base_url: str = ""
    llm_classify_model: str = "claude-haiku-4-5-20251001"
    llm_insight_model: str = "claude-sonnet-5"

    # Scheduler
    schedule_daily_cron: str = "0 7 * * *"

    # Database
    database_url: str = f"sqlite:///{(DATA_DIR / 'cfl_feedback.db').as_posix()}"

    # Classification batching
    classify_batch_size: int = 30

    @property
    def has_llm_key(self) -> bool:
        if self.llm_provider == "anthropic":
            return bool(self.anthropic_api_key)
        return bool(self.openai_api_key) or bool(self.llm_base_url)


settings = Settings()
