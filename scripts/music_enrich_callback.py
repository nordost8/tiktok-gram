"""Callback receiver for the music-enrichment service (photo-post sound).

The music-enrichment service (``services/music-enrichment/``) is async: it
returns 202 + a job_id, then POSTs the result to our ``callback_url`` when the
pick is done or failed. This tiny FastAPI app is that receiver. It is
deliberately separate from the web app: it reuses the Python media plumbing
(boto3 R2 upload, Postgres) so no new responsibilities/secrets leak into the
Next.js container, and it stays fully behind the feature flag (nothing calls
it unless enrichment is enabled).

Endpoints:
- GET  /health                                   liveness
- POST /v1/music-enrichment-callback?desc_id=...  the service's result callback

Callback body (see services/music-enrichment/README.md):
  {job_id, status, top, recommend_list, download_url, error?}

On ``status == "done"``: download ``download_url`` → store mp3 bytes in Postgres
(audio_data bytea) → write audio_title/author + audio_storage_key='postgres' + status='ready'.
On ``status == "failed"``: record status='failed' + the error.

Idempotent: re-delivery of the same callback re-uploads the same key and
re-writes the same metadata; a desc already in a terminal-with-the-same-job
state is accepted as a no-op.
"""

from __future__ import annotations

from typing import Any

import psycopg2
import requests
from fastapi import FastAPI, HTTPException, Request

from media_cache_job import db_connect
from telegram_collector_lib import tiktok_gram_log, load_env

_LOG_ENV = "TIKTOK_GRAM_MEDIA_LOG"
_DOWNLOAD_TIMEOUT = 120  # seconds — the mp3 is small but the service may be busy


_MAX_AUDIO_ATTEMPTS = 3


def _store_track(
    desc_id: str,
    *,
    job_id: str,
    title: str | None,
    author: str | None,
    storage_key: str,
) -> None:
    """Mark the post ready (fetching_audio→ready). Matched on STATUS alone.

    The ``status = 'fetching_audio'`` guard makes re-delivery safe: only a post still
    in flight is promoted, so a duplicate callback after a terminal write is a no-op
    (the WARN below).
    """
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET audio_title = %s,
                    audio_author = %s,
                    audio_storage_key = %s,
                    status = 'ready',
                    audio_last_error = NULL,
                    audio_updated_at = NOW()
                WHERE id = %s
                  AND status = 'fetching_audio'
                """,
                (title, author, storage_key, desc_id),
            )
            updated = cur.rowcount
        conn.commit()
    if updated != 1:
        tiktok_gram_log(
            f"[ttm-callback] WARN desc={desc_id} job={job_id} no matching fetching_audio "
            f"row to mark ready (updated={updated})",
            file_env=_LOG_ENV,
        )


def _store_failed(desc_id: str, *, job_id: str, error: str | None) -> None:
    """Record a failed pick, enforcing the 3-attempt cap.

    Each claim already incremented ``audio_attempts``, so by the time a failure
    callback arrives the attempts column reflects how many times this post has
    been driven. Atomically (UPDATE ... WHERE ... RETURNING, matched on STATUS):

    - attempts < 3  → back to ``needs_audio`` so the hook/cron re-drives it; WARN.
    - attempts >= 3 → terminal ``failed`` + ``audio_last_error``; logged LOUDLY at
      ERROR level. Failed posts stay hidden but are findable for reprocessing.

    A non-matching row (re-delivery after a terminal write) yields no RETURNING row
    and is logged as a no-op WARN — never silently swallowed.
    """
    msg = (error or "unknown")[:2000]
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET status =
                        (CASE WHEN audio_attempts >= %s THEN 'failed'
                              ELSE 'needs_audio' END)::telegram_post_status,
                    audio_last_error = %s,
                    audio_updated_at = NOW()
                WHERE id = %s
                  AND status = 'fetching_audio'
                RETURNING audio_attempts, status
                """,
                (
                    _MAX_AUDIO_ATTEMPTS,
                    msg,
                    desc_id,
                ),
            )
            row = cur.fetchone()
        conn.commit()

    if row is None:
        tiktok_gram_log(
            f"[ttm-callback] WARN desc={desc_id} job={job_id} no matching fetching_audio "
            f"row to mark failed (re-delivery?) error={msg!r}",
            file_env=_LOG_ENV,
        )
        return

    attempts, new_status = int(row[0]), str(row[1])
    if new_status == "failed":
        # Terminal: 3 attempts exhausted. LOUD by design — surfaces in error logs.
        tiktok_gram_log(
            f"[ttm-callback] ERROR desc={desc_id} job={job_id} "
            f"TERMINAL FAILURE after {attempts} attempts (cap={_MAX_AUDIO_ATTEMPTS}); "
            f"post stays hidden. error={msg!r}",
            file_env=_LOG_ENV,
        )
    else:
        tiktok_gram_log(
            f"[ttm-callback] WARN desc={desc_id} job={job_id} pick failed "
            f"(attempt {attempts}/{_MAX_AUDIO_ATTEMPTS}); back to needs_audio for "
            f"retry. error={msg!r}",
            file_env=_LOG_ENV,
        )


def _download_and_store_mp3(desc_id: str, download_url: str) -> str:
    """Download mp3 bytes from the service and store directly in Postgres audio_data (bytea).
    Returns the literal 'postgres' marker so _store_track can set a non-null audio_storage_key.
    """
    with requests.get(download_url, stream=True, timeout=_DOWNLOAD_TIMEOUT) as resp:
        resp.raise_for_status()
        chunks: list[bytes] = []
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if chunk:
                chunks.append(chunk)
        data = b"".join(chunks)
    if len(data) == 0:
        raise RuntimeError("downloaded mp3 is empty")
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET audio_data = %s,
                    audio_updated_at = NOW()
                WHERE id = %s
                """,
                (psycopg2.Binary(data), desc_id),
            )
        conn.commit()
    return "postgres"


def build_app() -> FastAPI:
    app = FastAPI(title="music-enrichment callback receiver", version="1.0.0")

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "role": "music-enrichment-callback"}

    @app.post("/v1/music-enrichment-callback")
    async def callback(request: Request, desc_id: str) -> dict[str, Any]:
        body = await request.json()
        job_id = str(body.get("job_id") or "")
        status = str(body.get("status") or "")
        if not job_id or not status:
            raise HTTPException(status_code=400, detail="missing job_id/status")
        return _handle_callback(desc_id, job_id=job_id, status=status, body=body)

    return app


def _handle_callback(
    desc_id: str, *, job_id: str, status: str, body: dict[str, Any]
) -> dict[str, Any]:
    """Process one post's callback in isolation.

    ISOLATION: every post is processed independently. An unexpected exception
    here (R2 hiccup, DB blip) is caught, logged loudly, and turned into a
    structured error result — it is NEVER allowed to propagate, so a batch /
    re-driver iterating over many desc_ids cannot have one post abort the rest.
    Input-shape errors (HTTPException) are intentionally re-raised so the caller
    sees a real 4xx.
    """
    tiktok_gram_log(
        f"[ttm-callback] RECV desc={desc_id} job={job_id} status={status}",
        file_env=_LOG_ENV,
    )
    try:
        if status == "done":
            download_url = str(body.get("download_url") or "")
            if not download_url:
                _store_failed(desc_id, job_id=job_id, error="done without download_url")
                raise HTTPException(status_code=400, detail="missing download_url")
            top = body.get("top") or {}
            title = top.get("title") if isinstance(top, dict) else None
            author = top.get("author") if isinstance(top, dict) else None
            key = _download_and_store_mp3(desc_id, download_url)
            _store_track(
                desc_id,
                job_id=job_id,
                title=title,
                author=author,
                storage_key=key,
            )
            tiktok_gram_log(
                f"[ttm-callback] READY desc={desc_id} job={job_id} key={key} "
                f"title={title!r}",
                file_env=_LOG_ENV,
            )
            try:
                from caption_translate_db import maybe_translate_post_caption

                maybe_translate_post_caption(desc_id)
            except Exception as exc:  # noqa: BLE001
                tiktok_gram_log(
                    f"[ttm-callback] caption-translate hook failed desc={desc_id}: {exc}",
                    file_env=_LOG_ENV,
                )
            return {"ok": True, "descId": desc_id, "storageKey": key}

        if status == "failed":
            _store_failed(desc_id, job_id=job_id, error=body.get("error"))
            return {"ok": True, "descId": desc_id, "status": "failed"}

        # Any other status (queued/waking/running) is informational; accept it.
        return {"ok": True, "descId": desc_id, "status": status}
    except HTTPException:
        # A deliberate input-shape rejection — let the ASGI layer surface the 4xx.
        raise
    except Exception as exc:  # noqa: BLE001 — one post must never break others
        tiktok_gram_log(
            f"[ttm-callback] ERROR desc={desc_id} job={job_id} unhandled "
            f"{type(exc).__name__}: {exc} — isolated, other posts unaffected",
            file_env=_LOG_ENV,
        )
        return {
            "ok": False,
            "descId": desc_id,
            "error": f"{type(exc).__name__}: {exc}",
        }


# Module-level app for `uvicorn music_enrich_callback:app`.
load_env()
app = build_app()
