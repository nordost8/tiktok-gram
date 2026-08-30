"""Callback sender — POSTs the job outcome to the client's ``callback_url``.

Fired by the worker on both terminal states (``done`` and ``failed``).

WHY this never fails the job: the client's endpoint being down is the
client's problem, not ours. We retry a few times with exponential backoff and
then log and give up — the job keeps its terminal status either way.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from .logging import get_logger
from .models import Job
from .settings import Settings

_log = get_logger(__name__)

_TIMEOUT_SECONDS = 15.0


def _build_payload(settings: Settings, job: Job) -> dict[str, Any]:
    """Build the callback JSON body from a terminal job.

    ``download_url`` is absolute so the client needs no knowledge of our
    routing. Result fields are flattened from ``job.result`` when present
    (i.e. on ``done``); on ``failed`` they are ``None`` and ``error`` carries
    the reason.
    """
    result = job.result
    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "top": result.top.model_dump() if result else None,
        "recommend_list": (
            [t.model_dump() for t in result.recommend_list] if result else None
        ),
        "download_url": (
            f"{settings.public_base_url.rstrip('/')}"
            f"/jobs/{job.job_id}/track.mp3"
        ),
        "error": job.error,
    }


def send_callback(settings: Settings, job: Job) -> None:
    """POST the job outcome to ``job.callback_url`` with retry/backoff.

    No-op if the job has no callback URL. Always returns normally — failures
    are logged, never raised, so the job's status stands.
    """
    if not job.callback_url:
        return

    url = job.callback_url
    payload = _build_payload(settings, job)
    attempts = max(1, settings.callback_max_retries)

    for attempt in range(attempts):
        try:
            resp = httpx.post(url, json=payload, timeout=_TIMEOUT_SECONDS)
            if 200 <= resp.status_code < 300:
                _log.info(
                    "callback.sent",
                    job_id=job.job_id,
                    status=job.status.value,
                    code=resp.status_code,
                    attempt=attempt + 1,
                )
                return
            _log.warning(
                "callback.bad_status",
                job_id=job.job_id,
                code=resp.status_code,
                attempt=attempt + 1,
            )
        except httpx.HTTPError as exc:
            _log.warning(
                "callback.error",
                job_id=job.job_id,
                error=str(exc),
                attempt=attempt + 1,
            )

        if attempt < attempts - 1:
            time.sleep(settings.callback_backoff_base ** attempt)

    _log.error("callback.gave_up", job_id=job.job_id, attempts=attempts)
