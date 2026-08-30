#!/usr/bin/env python3
"""
Cron reconciler for music enrichment (safety net, not the primary trigger).

The post-cache hook (_advance_post_status_after_cache in media_cache_job + the
ready path in music_enrich_db.maybe_enrich_post_with_music) is the
primary driver. It fires when a photo media row transitions to ready and the
post is a fully-cached photo-only set.

This 10-minute cron is a reconciler / backstop:
- (1) drives ``needs_audio`` photo posts that the hook missed (transient hook
  failure, worker restart before hook, posts that became fully ready before
  music was enabled, etc.).
- (2) recovers stuck ``fetching_audio`` posts (the job was claimed but the async
  callback never arrived because the worker died, network flap, etc.).
- (3) respects picker throughput via small batch LIMIT.
- (4) when music is OFF: promotes parked ``needs_audio`` / ``fetching_audio``
  photo posts to ``ready`` so they appear in the feed without audio.

It must NEVER be the only path; the hook is preferred for low latency.
Each enrich call is wrapped so one failure cannot abort the batch (isolated
failure principle).

Env:
  MUSIC_ENRICHMENT_ENABLED=1  -> enrich needs_audio posts
  MUSIC_ENRICHMENT_ENABLED=0  -> promote parked photo posts to ready
  MUSIC_ENRICH_BATCH=5              -> LIMIT for candidates per run
  MUSIC_PENDING_STUCK_MINUTES=30    -> TTL for fetching_audio -> consider stuck

NO silent fallbacks. Raises on missing POSTGRES_URL (like collector-sync).
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from music_enrich_db import maybe_enrich_post_with_music  # noqa: E402


LOG_PATH = Path(os.environ.get("TIKTOK_GRAM_MEDIA_LOG", ""))


def load_env() -> None:
    """Copy of collector-sync.py load_env() pattern (setdefault, no overwrite)."""
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def log(msg: str) -> None:
    """Same logging style as collector-sync.py (iso timestamp + stdout + optional file)."""
    line = f"{datetime.now(timezone.utc).isoformat()} {msg}"
    print(line, flush=True)
    if LOG_PATH and str(LOG_PATH):
        try:
            LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with LOG_PATH.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass


def music_enabled() -> bool:
    """Same gate as collector-sync and music_enrich (exact '1')."""
    return os.environ.get("MUSIC_ENRICHMENT_ENABLED", "0").strip() == "1"


_PHOTO_ONLY_CLAUSE = """
    NOT EXISTS (
      SELECT 1 FROM telegram_post_media pm
      WHERE pm.desc_id = {alias}.id AND pm.type IN ('video', 'animation')
    )
    AND EXISTS (
      SELECT 1 FROM telegram_post_media pm
      WHERE pm.desc_id = {alias}.id AND pm.type = 'photo' AND pm.cache_status = 'ready'
    )
    AND NOT EXISTS (
      SELECT 1 FROM telegram_post_media pm
      WHERE pm.desc_id = {alias}.id AND pm.type = 'photo'
        AND pm.cache_status NOT IN ('ready', 'skipped')
    )
"""


def _promote_parked_photos_to_ready(conn: Any, *, batch: int) -> list[str]:
    """When music is off, unpark photo posts so they show in the feed without audio."""
    photo_only = _PHOTO_ONLY_CLAUSE.format(alias="d2")
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE telegram_post_descriptions d
            SET status = 'ready',
                audio_last_error = COALESCE(
                    audio_last_error, 'music enrichment disabled; published without audio'
                ),
                audio_updated_at = now()
            FROM (
                SELECT d2.id
                FROM telegram_post_descriptions d2
                WHERE d2.status IN ('needs_audio', 'fetching_audio')
                  AND {photo_only}
                ORDER BY d2.published_at DESC NULLS LAST
                LIMIT %s
            ) pick
            WHERE d.id = pick.id
            RETURNING d.id
            """,
            (batch,),
        )
        ids = [str(r[0]) for r in cur.fetchall()]
    conn.commit()
    for desc_id in ids:
        try:
            from caption_translate_db import maybe_translate_post_caption

            maybe_translate_post_caption(desc_id)
        except Exception as exc:  # noqa: BLE001
            log(f"[ttm-cron] caption-translate after promote failed desc={desc_id}: {exc}")
    return ids


def main() -> None:
    load_env()
    url = os.environ.get("POSTGRES_URL", "").strip().strip('"').strip("'")
    if not url:
        raise RuntimeError("POSTGRES_URL missing in .env")

    batch = int(os.environ.get("MUSIC_ENRICH_BATCH", "5"))
    stuck_min = int(os.environ.get("MUSIC_PENDING_STUCK_MINUTES", "30"))
    enabled = music_enabled()

    conn = psycopg2.connect(url)
    candidates: list[str] = []
    would_reset: list[str] = []
    would_fail: list[str] = []
    stuck_reset = 0
    stuck_failed = 0
    enriched_ok = 0
    enriched_err = 0
    promoted = 0

    try:
        if not enabled:
            # Music off: clear the parking lot so photos appear without audio.
            promote_batch = max(batch, 50)
            ids = _promote_parked_photos_to_ready(conn, batch=promote_batch)
            promoted = len(ids)
            if ids:
                log(f"[ttm-cron] music-off promoted-to-ready count={promoted} ids={ids}")
            log(
                f"[ttm-cron] summary music_off=1 promoted={promoted} "
                f"batch={promote_batch}"
            )
            return

        # Query stuck fetching_audio (for counts)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM telegram_post_descriptions
                WHERE status = 'fetching_audio'
                  AND audio_attempts < 3
                  AND audio_updated_at < now() - (%s || ' minutes')::interval
                """,
                (str(stuck_min),),
            )
            would_reset = [str(r[0]) for r in cur.fetchall()]

            cur.execute(
                """
                SELECT id FROM telegram_post_descriptions
                WHERE status = 'fetching_audio'
                  AND audio_attempts >= 3
                  AND audio_updated_at < now() - (%s || ' minutes')::interval
                """,
                (str(stuck_min),),
            )
            would_fail = [str(r[0]) for r in cur.fetchall()]

        # Step (2) FIRST — stuck fetching_audio recovery
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET status = 'needs_audio',
                    audio_last_error = COALESCE(
                        audio_last_error, 'stuck fetching_audio, retrying'
                    ),
                    audio_updated_at = now()
                WHERE status = 'fetching_audio'
                  AND audio_attempts < 3
                  AND audio_updated_at < now() - (%s || ' minutes')::interval
                """,
                (str(stuck_min),),
            )
            stuck_reset = cur.rowcount

            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET status = 'failed',
                    audio_last_error = COALESCE(
                        audio_last_error, 'stuck fetching_audio, attempts exhausted'
                    ),
                    audio_updated_at = now()
                WHERE status = 'fetching_audio'
                  AND audio_attempts >= 3
                  AND audio_updated_at < now() - (%s || ' minutes')::interval
                """,
                (str(stuck_min),),
            )
            stuck_failed = cur.rowcount
        conn.commit()

        # Step (1) — select fully-cached needs_audio photo-only candidates
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT d.id FROM telegram_post_descriptions d
                WHERE d.status = 'needs_audio'
                  AND {_PHOTO_ONLY_CLAUSE.format(alias="d")}
                ORDER BY d.published_at DESC NULLS LAST
                LIMIT %s
                """,
                (batch,),
            )
            candidates = [str(r[0]) for r in cur.fetchall()]

        for desc_id in candidates:
            try:
                ret: dict[str, Any] = maybe_enrich_post_with_music(str(desc_id))
                if ret and ret.get("error"):
                    log(f"[ttm-cron] enrich err desc={desc_id} {ret.get('error')}")
                    enriched_err += 1
                else:
                    enriched_ok += 1
            except Exception as exc:  # noqa: BLE001 — isolated failure
                log(f"[ttm-cron] ERROR enrich desc={desc_id} {type(exc).__name__}: {exc}")
                enriched_err += 1

    finally:
        conn.close()

    log(
        f"[ttm-cron] summary candidates={len(candidates)} enriched_ok={enriched_ok} "
        f"enriched_err={enriched_err} stuck_reset={stuck_reset} stuck_failed={stuck_failed} "
        f"would_reset={len(would_reset)} would_fail={len(would_fail)} dry_run=False"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        log(f"[ttm-cron] FATAL {type(exc).__name__}: {exc}")
        sys.exit(1)
