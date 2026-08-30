"""Configuration for the music-enrichment service.

Single source of truth for api/worker/callback. All config is env-driven via
pydantic-settings with the ``MUSIC_`` prefix, e.g. ``MUSIC_REDIS_URL``,
``MUSIC_PORT``. Defaults let the service run locally with zero env in the
common case.

WHY pydantic-settings: it gives typed, validated config that mypy understands
and that fails loudly on bad values, instead of silently limping along on a
malformed env var.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Env prefix ``MUSIC_``; unknown env keys ignored."""

    model_config = SettingsConfigDict(env_prefix="MUSIC_", extra="ignore")

    # --- Storage / networking -------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"
    # Where job photos + the picked mp3 are written, one subdir per job.
    work_dir: str = "/data/jobs"
    # Absolute base used to build the callback's download_url; clients fetch
    # the mp3 from here.
    public_base_url: str = "http://localhost:8090"
    bind: str = "0.0.0.0"
    port: int = 8090

    # --- Job behaviour ----------------------------------------------------
    max_images: int = 10
    # Transient pipeline retries before a job is marked failed.
    max_attempts: int = 3

    # --- Callback sender ------------------------------------------------------
    callback_max_retries: int = 5
    callback_backoff_base: float = 1.5


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide Settings singleton (cached so env is read once)."""
    return Settings()
