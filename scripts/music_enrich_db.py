"""DB-backed side of music enrichment (post-cache hook + persistence).

This module owns the parts of the enrichment flow that touch Postgres / R2 /
the network. The pure decision logic (qualification, idempotency key) lives in
``music_enrich`` so it can be unit tested without those deps.

Flow (only when ``MUSIC_ENRICHMENT_ENABLED=1``):
1. ``maybe_enrich_post_with_music(desc_id)`` is called by the media-worker once a
   photo post reaches status ``needs_audio`` (and by the */10 cron as a backstop).
2. It claims the post needs_audio→fetching_audio, downloads the cached photos from
   R2 and POSTs them to ``POST /v1/music-jobs`` with a per-attempt
   idempotency_key + a callback_url.
3. The callback receiver (``music_enrich_callback.py``) later sets status='ready'
   (+ mp3/title/author) or, after 3 attempts, 'failed'.

The post's ``status`` column is the SINGLE source of truth
(needs_audio→fetching_audio→ready|failed). Duplicate jobs are prevented by the
per-attempt service idempotency_key + the atomic status claim.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from psycopg2.extras import RealDictCursor

from media_cache_job import db_connect, s3_client
from telegram_collector_lib import tiktok_gram_log
from music_enrich import (
    idempotency_key,
    is_qualifying_media_set,
    music_callback_url,
    music_enabled,
    post_media_all_ready,
    select_music_image_media,
    music_enrichment_url,
)

_LOG_ENV = "TIKTOK_GRAM_MEDIA_LOG"
_HTTP_TIMEOUT = 30  # seconds for the 202 POST (the pick itself is async)

# Don't spend the (serial, ~minutes-per-job) emulator on stale posts: a photo
# older than this won't surface high in the feed even once voiced, so skip it
# and leave the throughput for fresh posts. 0 disables the cap. Hours.
_MAX_AGE_HOURS = float(os.environ.get("MUSIC_ENRICH_MAX_AGE_HOURS", "72"))


def _bucket() -> str:
    from media_cache_job import MEDIA_CACHE_BUCKET

    return os.environ.get("S3_BUCKET", MEDIA_CACHE_BUCKET)


def load_post_media(desc_id: str) -> list[dict[str, Any]]:
    """All media rows for a description, ordered by insertion (gallery order)."""
    with db_connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, type, mime_type, cache_status, storage_backend, created_at
                FROM telegram_post_media
                WHERE desc_id = %s
                ORDER BY created_at ASC, id ASC
                """,
                (desc_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def load_post_audio_state(desc_id: str) -> dict[str, Any] | None:
    """Current lifecycle status for a description (None if the desc is gone)."""
    with db_connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, status, published_at, COALESCE(text, caption, '') AS post_text
                FROM telegram_post_descriptions
                WHERE id = %s
                """,
                (desc_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def _claim_post_for_music(desc_id: str) -> int | None:
    """Atomically transition the post needs_audio→fetching_audio.

    The STATUS is the only lock. Increments ``audio_attempts`` so the 3-attempt cap
    is spent the moment a worker starts a job. Returns the NEW ``audio_attempts`` if
    THIS call won the claim, or ``None`` if the post was not ``needs_audio`` (already
    claimed / terminal): under concurrency exactly one UPDATE flips the status.
    """
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET status = 'fetching_audio',
                    audio_attempts = audio_attempts + 1,
                    audio_updated_at = NOW()
                WHERE id = %s
                  AND status = 'needs_audio'
                RETURNING audio_attempts
                """,
                (desc_id,),
            )
            row = cur.fetchone()
        conn.commit()
    return int(row[0]) if row is not None else None


def _release_post_claim(desc_id: str, error: str) -> None:
    """Roll a failed POST back fetching_audio→needs_audio so the cron/hook re-drives it.

    The attempt was already counted by the claim, so this does NOT decrement
    ``audio_attempts``: a release after a transient POST/network error still counts
    toward the 3-attempt cap. Matched on STATUS alone (still ``fetching_audio``).
    """
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET status = 'needs_audio',
                    audio_last_error = %s,
                    audio_updated_at = NOW()
                WHERE id = %s
                  AND status = 'fetching_audio'
                """,
                (error[:2000], desc_id),
            )
        conn.commit()


def _download_photo(media_id: str) -> bytes:
    """Fetch photo bytes from Postgres (photos are never served from R2)."""
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cached_data
                FROM telegram_post_media
                WHERE id = %s
                  AND type = 'photo'
                  AND storage_backend = 'postgres'
                  AND cache_status = 'ready'
                  AND cached_data IS NOT NULL
                """,
                (media_id,),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError(f"photo {media_id} not cached in postgres")
            return bytes(row[0])


def maybe_enrich_post_with_music(desc_id: str) -> dict[str, Any]:
    """Post-cache hook entrypoint. Safe to call for any post; no-op unless eligible.

    Returns a small status dict for logging/tests. Never raises into the caller
    (the media-cache job must not fail because music enrichment hiccuped).
    """
    if not music_enabled():
        return {"descId": desc_id, "skipped": "disabled"}

    try:
        return _enrich(desc_id)
    except Exception as exc:  # noqa: BLE001 — never break the media-cache job
        tiktok_gram_log(
            f"[ttm-enrich] ERROR desc={desc_id} {type(exc).__name__}: {exc}",
            file_env=_LOG_ENV,
        )
        return {"descId": desc_id, "error": f"{type(exc).__name__}: {exc}"}


def _enrich(desc_id: str) -> dict[str, Any]:
    state = load_post_audio_state(desc_id)
    if state is None:
        return {"descId": desc_id, "skipped": "desc_not_found"}
    if state.get("status") != "needs_audio":
        # Only a post awaiting music is enrichable. fetching_audio/ready/failed/
        # caching are left alone. Status is the sole gate.
        return {"descId": desc_id, "skipped": "already_in_flight"}

    # Freshness: the worker is told to voice the newest post first (priority =
    # published_at). Very old posts are skipped entirely so they don't consume
    # the serial emulator's limited throughput.
    published_at = state.get("published_at")
    priority_epoch: float | None = None
    if isinstance(published_at, datetime):
        priority_epoch = published_at.timestamp()
        if _MAX_AGE_HOURS > 0:
            age_h = (
                datetime.now(timezone.utc) - published_at
            ).total_seconds() / 3600.0
            if age_h > _MAX_AGE_HOURS:
                return {"descId": desc_id, "skipped": "too_old"}

    media_rows = load_post_media(desc_id)
    media_types = [m["type"] for m in media_rows]
    if not is_qualifying_media_set(media_types):
        return {"descId": desc_id, "skipped": "not_qualifying"}
    if not post_media_all_ready(media_rows):
        # Wait for the rest of the carousel to finish caching; a later media's
        # ready hook will retry.
        return {"descId": desc_id, "skipped": "awaiting_cache"}

    images = select_music_image_media(media_rows)
    if not images:
        return {"descId": desc_id, "skipped": "no_ready_images"}

    # Claim the post (needs_audio→fetching_audio) on status alone before any network
    # work. The claim returns the new audio_attempts; we scope the idempotency key to
    # that attempt so a retried (previously failed) post gets a FRESH service job
    # instead of the service returning the dead one.
    attempt = _claim_post_for_music(desc_id)
    if attempt is None:
        return {"descId": desc_id, "skipped": "claim_lost"}
    key = idempotency_key(desc_id, attempt)

    tmp_files: list[Path] = []
    try:
        files: list[tuple[str, tuple[str, bytes, str]]] = []
        for idx, m in enumerate(images):
            data = _download_photo(str(m["id"]))
            mime = m.get("mime_type") or "image/jpeg"
            files.append(("images", (f"in_{idx:02d}.jpg", data, mime)))

        form: dict[str, str] = {"idempotency_key": key}
        post_text = str(state.get("post_text") or "").strip()
        if post_text:
            form["post_caption"] = post_text
        if priority_epoch is not None:
            # Worker pops the highest priority first -> freshest post voiced next.
            form["priority"] = repr(priority_epoch)
        cb = music_callback_url()
        if cb:
            # The receiver keys results by desc_id (passed back to it).
            sep = "&" if "?" in cb else "?"
            form["callback_url"] = f"{cb}{sep}desc_id={desc_id}"

        url = f"{music_enrichment_url().rstrip('/')}/v1/music-jobs"
        tiktok_gram_log(
            f"[ttm-enrich] POST desc={desc_id} images={len(files)} url={url} "
            f"callback={'yes' if cb else 'no'}",
            file_env=_LOG_ENV,
        )
        resp = requests.post(url, data=form, files=files, timeout=_HTTP_TIMEOUT)
        resp.raise_for_status()
        body = resp.json()
        job_id = str(body.get("job_id") or "")
        if not job_id:
            raise RuntimeError(f"service returned no job_id: {body!r}")

        tiktok_gram_log(
            f"[ttm-enrich] QUEUED desc={desc_id} job={job_id} status={body.get('status')}",
            file_env=_LOG_ENV,
        )
        return {"descId": desc_id, "jobId": job_id, "status": "fetching_audio"}
    except Exception as exc:  # noqa: BLE001
        _release_post_claim(desc_id, f"{type(exc).__name__}: {exc}")
        raise
    finally:
        for p in tmp_files:
            p.unlink(missing_ok=True)


# Kept for symmetry/future use; current path streams bytes in-memory so this is
# unused, but documents that a temp-file variant exists if memory pressure ever
# matters for very large carousels.
def _temp_path(suffix: str) -> Path:
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        return Path(tmp.name)
