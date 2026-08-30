"""RQ job: download Telegram media and store in Cloudflare R2."""

from __future__ import annotations

import asyncio
import mimetypes
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import boto3
import psycopg2
from botocore.config import Config
from botocore.exceptions import ClientError
from psycopg2.extras import RealDictCursor

from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto

from telegram_collector_lib import load_env, tiktok_gram_log, require_env, make_client

MEDIA_CACHE_BUCKET = "tiktok-gram-media"
MEDIA_STORAGE_BACKEND = "r2"
DEFAULT_MAX_BYTES = 250 * 1024 * 1024

# ── Codec normalisation ─────────────────────────────────────────────────────
# Telegram started shipping AV1 in July 2026. iOS Safari / Telegram WebView
# cannot decode AV1 at all, so such a video reaches the user as a hard
# "Media unavailable" even though the file sits intact in R2 — the bytes are fine,
# the phone simply has no decoder. We fix that once at ingest rather than teach
# every client a codec-support matrix, but we only touch codecs that are known
# to be broken (see UNPLAYABLE_VIDEO_CODECS) — re-encoding healthy video would
# cost Pi CPU and a generation of quality for no benefit.
# Deliberately a denylist of codecs known to be undecodable on a platform we
# care about — NOT "everything that isn't H.264". HEVC (16% of the library) is
# decoded natively by iOS and by modern Android/Chrome, so re-encoding it would
# burn Pi CPU and lose a generation of quality to fix nothing. Add a codec here
# only once it is shown to actually fail somewhere.
UNPLAYABLE_VIDEO_CODECS = frozenset({"av1"})
# Cap height so transcode cost stays bounded no matter the source resolution.
TRANSCODE_MAX_HEIGHT = 720
# Measured on the Pi 4: a 20 s 1080p AV1 clip → 33 s wall, and the output came
# out SMALLER than the source (5.27 MB → 4.26 MB), so this does not grow R2 use.
TRANSCODE_CRF = "28"
TRANSCODE_PRESET = "veryfast"
# Leave headroom: the Pi also runs web, collector, postgres and the music worker.
TRANSCODE_THREADS = "2"
TRANSCODE_TIMEOUT_S = 900


def _advance_post_status_after_cache(desc_id: str | None) -> None:
    """Drive the post's unified `status` once a media row finishes caching.

    `status` is the single source of truth for feed visibility. A post sits in
    'caching' until its media is ready, then:
      - has a ready video/animation media row → 'ready' (video/mixed posts).
      - photo-only AND all photos ready → 'needs_audio' when music enrichment
        is on (then fire the picker), or 'ready' when it is off (silent photos).
    Only ever advances a post that is still 'caching' (never regresses a post
    already past it). Wrapped so it can never fail the media-cache job.
    """
    if not desc_id:
        return
    try:
        from music_enrich import photo_post_status_after_cache

        with db_connect() as conn:
            with conn.cursor() as cur:
                # has a ready+hash video/animation media row?
                cur.execute(
                    """
                    SELECT
                      bool_or(type IN ('video','animation')
                              AND cache_status='ready'
                              AND telegram_access_hash IS NOT NULL) AS video_ready,
                      bool_or(type='photo') AS has_photo,
                      bool_and(type<>'photo' OR cache_status IN ('ready','skipped'))
                        FILTER (WHERE type='photo') AS photos_all_ready
                    FROM telegram_post_media WHERE desc_id = %s
                    """,
                    (desc_id,),
                )
                r = cur.fetchone()
                if not r:
                    return
                video_ready, has_photo, photos_all_ready = r[0], r[1], r[2]
                new_status: str | None = None
                if video_ready:
                    new_status = "ready"
                elif has_photo and photos_all_ready:
                    new_status = photo_post_status_after_cache()
                if new_status is None:
                    return
                cur.execute(
                    """
                    UPDATE telegram_post_descriptions
                    SET status = %s::telegram_post_status, audio_updated_at = NOW()
                    WHERE id = %s AND status = 'caching'
                    RETURNING status
                    """,
                    (new_status, desc_id),
                )
                advanced = cur.fetchone() is not None
            conn.commit()
        # Music-enrichment hook — see services/music-enrichment/ (stubbed by
        # default). Photo post just became needs_audio → kick the enrichment
        # service (low latency); the */10 cron is the backstop. Only happens
        # when MUSIC_ENRICHMENT_ENABLED=1.
        if advanced and new_status == "needs_audio":
            from music_enrich_db import maybe_enrich_post_with_music

            maybe_enrich_post_with_music(str(desc_id))
        if advanced and new_status == "ready":
            try:
                from caption_translate_db import maybe_translate_post_caption

                maybe_translate_post_caption(str(desc_id))
            except Exception as exc:  # noqa: BLE001
                tiktok_gram_log(
                    f"[media-cache] caption-translate hook failed desc={desc_id}: {exc}",
                    file_env="TIKTOK_GRAM_MEDIA_LOG",
                )
    except Exception as exc:  # noqa: BLE001
        tiktok_gram_log(
            f"[media-cache] post-status hook failed desc={desc_id}: {exc}",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )


def queue_self_test(token: str) -> dict[str, Any]:
    """Lightweight job for queue verification (no Telegram/Postgres)."""
    return {
        "ok": True,
        "token": token,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


def media_object_key(media_id: str, extension: str) -> str:
    ext = extension[1:] if extension.startswith(".") else extension
    return f"media/{media_id}.{ext}"


def channel_avatar_object_key(channel_id: str) -> str:
    return f"channels/{channel_id}.jpg"


def extension_for_media(media_type: str, mime_type: str | None) -> str:
    if mime_type:
        guessed = mimetypes.guess_extension(mime_type.split(";")[0].strip())
        if guessed:
            return guessed.lstrip(".")
    return {
        "photo": "jpg",
        "video": "mp4",
        "animation": "mp4",
    }.get(media_type, "bin")


def _parse_postgres_url(url: str) -> dict[str, Any]:
    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "user": parsed.username,
        "password": parsed.password,
        "dbname": (parsed.path or "/tiktok_gram").lstrip("/"),
    }


def db_connect():
    load_env()
    return psycopg2.connect(**_parse_postgres_url(require_env("POSTGRES_URL")))


def load_media_row(media_id: str) -> dict[str, Any] | None:
    with db_connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                  m.id,
                  m.desc_id,
                  m.type,
                  m.mime_type,
                  m.size_bytes,
                  m.cache_status,
                  m.storage_key,
                  m.storage_backend,
                  (m.cached_data IS NOT NULL) AS has_cached_data,
                  m.cache_range_ready,
                  m.telegram_access_hash,
                  m.telegram_photo_id,
                  m.telegram_document_id,
                  c.username AS channel_username,
                  d.telegram_message_id
                FROM telegram_post_media m
                JOIN telegram_post_descriptions d ON d.id = m.desc_id
                JOIN telegram_channels c ON c.id = d.channel_id
                WHERE m.id = %s
                """,
                (media_id,),
            )
            row = cur.fetchone()
    return dict(row) if row else None


def update_media_cache_status(
    media_id: str,
    *,
    cache_status: str,
    storage_key: str | None = None,
    cached_size_bytes: int | None = None,
    cache_range_ready: bool | None = None,
    last_cache_error: str | None = None,
    increment_attempt: bool = False,
    clear_storage: bool = False,
) -> None:
    sets = ["cache_status = %s"]
    params: list[Any] = [cache_status]

    if clear_storage:
        sets.extend(
            [
                "storage_key = NULL",
                "cached_data = NULL",
                "storage_backend = 'r2'",
                "cached_size_bytes = NULL",
                "cache_range_ready = FALSE",
            ],
        )
    elif storage_key is not None:
        sets.extend(
            [
                "storage_key = %s",
                "cached_size_bytes = %s",
                "cache_range_ready = %s",
                "last_cache_error = NULL",
            ],
        )
        params.extend(
            [
                storage_key,
                cached_size_bytes,
                bool(cache_range_ready),
            ],
        )

    if last_cache_error is not None:
        sets.append("last_cache_error = %s")
        params.append(last_cache_error[:2000])

    if increment_attempt:
        sets.append("cache_attempt_count = cache_attempt_count + 1")

    params.append(media_id)
    sql = f"UPDATE telegram_post_media SET {', '.join(sets)} WHERE id = %s"

    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()


def s3_client():
    load_env()
    endpoint = require_env("S3_ENDPOINT")
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=require_env("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=require_env("S3_SECRET_ACCESS_KEY"),
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def upload_file_to_storage(local_path: Path, object_key: str, mime_type: str) -> int:
    bucket = os.environ.get("S3_BUCKET", MEDIA_CACHE_BUCKET)
    client = s3_client()
    size = local_path.stat().st_size
    client.upload_file(
        str(local_path),
        bucket,
        object_key,
        ExtraArgs={"ContentType": mime_type},
    )
    return size


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _probe_video_codec(path: Path) -> str | None:
    """Video codec name of *path* (e.g. 'h264', 'av1'), or None if undetectable."""
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_name",
                "-of", "csv=p=0",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    return proc.stdout.strip().splitlines()[0].strip() if proc.stdout.strip() else None


def _transcode_to_h264(src: Path, dst: Path) -> None:
    """Re-encode *src* into a universally playable H.264/AAC MP4 at *dst*.

    Runs under `nice` with a small thread budget so it can never starve the web
    / collector / postgres containers sharing this Pi, and downscales (never
    upscales) to TRANSCODE_MAX_HEIGHT so cost is bounded even for 4K sources.
    `+faststart` puts the moov atom first, which also speeds up playback start.
    Raises on failure or timeout.
    """
    subprocess.run(
        [
            "nice", "-n", "19",
            "ffmpeg", "-y", "-v", "error",
            "-i", str(src),
            "-threads", TRANSCODE_THREADS,
            "-c:v", "libx264",
            "-preset", TRANSCODE_PRESET,
            "-crf", TRANSCODE_CRF,
            "-profile:v", "main",
            "-pix_fmt", "yuv420p",
            "-vf", f"scale=-2:'min({TRANSCODE_MAX_HEIGHT},ih)'",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
            str(dst),
        ],
        capture_output=True,
        text=True,
        timeout=TRANSCODE_TIMEOUT_S,
        check=True,
    )


def normalize_video_for_playback(src: Path, media_id: str) -> tuple[Path, bool]:
    """Return (path_to_upload, was_transcoded) for a downloaded video.

    Only codecs in UNPLAYABLE_VIDEO_CODECS are re-encoded (today: AV1, which iOS
    cannot decode at all). Everything else — H.264, HEVC, anything unrecognised —
    passes through untouched, so the common path costs one cheap header probe and
    no CPU whatsoever.

    Fail-open when ffmpeg is absent (an older image must keep working exactly as
    before); fail-closed when a transcode genuinely errors, so the job is marked
    failed and retried rather than silently storing an unplayable file.
    """
    if not _ffmpeg_available():
        tiktok_gram_log(
            f"[media-cache] WARN media={media_id} ffmpeg/ffprobe missing —"
            " storing source codec as-is",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )
        return src, False

    codec = _probe_video_codec(src)
    if codec is None:
        tiktok_gram_log(
            f"[media-cache] WARN media={media_id} codec probe failed — storing as-is",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )
        return src, False

    if codec not in UNPLAYABLE_VIDEO_CODECS:
        return src, False

    dst = src.with_name(f"{src.stem}.h264.mp4")
    src_mb = src.stat().st_size / 1e6
    started = time.monotonic()
    tiktok_gram_log(
        f"[media-cache] TRANSCODE media={media_id} codec={codec}→h264"
        f" size={src_mb:.2f}MB",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )
    try:
        _transcode_to_h264(src, dst)
    except subprocess.TimeoutExpired:
        dst.unlink(missing_ok=True)
        raise RuntimeError(
            f"transcode timed out after {TRANSCODE_TIMEOUT_S}s (codec={codec})"
        ) from None
    except subprocess.CalledProcessError as exc:
        dst.unlink(missing_ok=True)
        stderr = (exc.stderr or "").strip().replace("\n", " ")[:300]
        raise RuntimeError(f"transcode failed (codec={codec}): {stderr}") from None

    out_mb = dst.stat().st_size / 1e6
    tiktok_gram_log(
        f"[media-cache] TRANSCODED media={media_id} {codec}→h264"
        f" {src_mb:.2f}MB→{out_mb:.2f}MB elapsed={time.monotonic() - started:.1f}s",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )
    return dst, True


def store_photo_in_postgres(
    media_id: str,
    desc_id: str,
    data: bytes,
    mime_type: str,
) -> int:
    """Write photo bytes to Postgres and enforce the photo-post cap."""
    from photo_pg_storage import enforce_photo_post_limit

    size = len(data)
    with db_connect() as conn:
        with conn.cursor() as cur:
            enforce_photo_post_limit(cur, str(desc_id))
            cur.execute(
                """
                UPDATE telegram_post_media
                SET cache_status = 'ready',
                    cached_data = %s,
                    storage_backend = 'postgres',
                    storage_key = NULL,
                    cached_size_bytes = %s,
                    cache_range_ready = TRUE,
                    last_cache_error = NULL
                WHERE id = %s
                """,
                (psycopg2.Binary(data), size, media_id),
            )
        conn.commit()
    return size


def cache_photo_job(media_id: str, row: dict[str, Any], started: float) -> dict[str, Any]:
    """Download a photo from Telegram and store in Postgres (not R2)."""
    channel = row.get("channel_username", "?")
    msg_id = row.get("telegram_message_id", "?")
    desc_id = row.get("desc_id")
    ext = extension_for_media("photo", row.get("mime_type"))
    mime_type = row.get("mime_type") or mimetypes.types_map.get(f".{ext}", "image/jpeg")

    update_media_cache_status(
        media_id,
        cache_status="downloading",
        increment_attempt=True,
        clear_storage=True,
    )

    tiktok_gram_log(
        f"[media-cache] DOWNLOAD photo→pg media={media_id} channel=@{channel} msg={msg_id}",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            tmp_path = Path(tmp.name)
        asyncio.run(_download_message_media(row, tmp_path))
        data = tmp_path.read_bytes()
        cached_size = store_photo_in_postgres(media_id, str(desc_id), data, mime_type)

        elapsed_ms = int((time.monotonic() - started) * 1000)
        tiktok_gram_log(
            f"[media-cache] READY photo→pg media={media_id} size={cached_size/1e3:.1f}KB"
            f" elapsed={elapsed_ms}ms",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )
        _advance_post_status_after_cache(desc_id)
        return {
            "mediaId": media_id,
            "status": "ready",
            "storageBackend": "postgres",
            "cachedSizeBytes": cached_size,
            "elapsedMs": elapsed_ms,
        }
    except Exception as exc:  # noqa: BLE001
        elapsed_ms = int((time.monotonic() - started) * 1000)
        tiktok_gram_log(
            f"[media-cache] FAILED photo→pg media={media_id} channel=@{channel} msg={msg_id}"
            f" error={type(exc).__name__}: {exc} elapsed={elapsed_ms}ms",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )
        update_media_cache_status(
            media_id,
            cache_status="failed",
            last_cache_error=f"{type(exc).__name__}: {exc}",
            clear_storage=True,
        )
        raise
    finally:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def max_cache_bytes() -> int:
    raw = os.environ.get("MEDIA_CACHE_MAX_BYTES", "").strip()
    if raw.isdigit():
        return int(raw)
    return DEFAULT_MAX_BYTES


async def _download_message_media(
    row: dict[str, Any],
    destination: Path,
) -> None:
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")
    client = make_client(api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("Telegram userbot not authorized")

    ident = row["channel_username"].lstrip("@")
    identifier = int(ident) if ident.lstrip("-").isdigit() else ident
    entity = await client.get_entity(identifier)
    message = await client.get_messages(entity, ids=int(row["telegram_message_id"]))
    if message is None or message.media is None:
        raise ValueError("message has no media")

    if message.grouped_id is not None:
        # This is an album: the representative message covers all photos in the group,
        # but each media row has its own telegram_photo_id / telegram_document_id.
        # Fetch a window of messages around the representative and pick the right one.
        base_id = int(row["telegram_message_id"])
        around = await client.get_messages(
            entity, min_id=base_id - 15, max_id=base_id + 15, limit=40
        )
        # Always include the representative message itself in the candidate set.
        candidates = [m for m in around if m.grouped_id == message.grouped_id]
        if message not in candidates:
            candidates.append(message)

        target = None
        photo_id = row.get("telegram_photo_id")
        doc_id = row.get("telegram_document_id")
        for member in candidates:
            if photo_id and isinstance(member.media, MessageMediaPhoto):
                if str(member.media.photo.id) == str(photo_id):
                    target = member
                    break
            elif doc_id and isinstance(member.media, MessageMediaDocument):
                if str(member.media.document.id) == str(doc_id):
                    target = member
                    break

        if target is None:
            raise ValueError(
                f"album match not found for media {row['id']}: "
                f"telegram_photo_id={photo_id} telegram_document_id={doc_id} "
                f"grouped_id={message.grouped_id}"
            )
    else:
        target = message

    await client.download_media(target, file=str(destination))
    await client.disconnect()


def cache_media_job(media_id: str) -> dict[str, Any]:
    load_env()
    started = time.monotonic()

    row = load_media_row(media_id)
    if row is None:
        tiktok_gram_log(f"[media-cache] WARN media={media_id} not found in DB — skipping job", file_env="TIKTOK_GRAM_MEDIA_LOG")
        return {"mediaId": media_id, "skipped": "not_found"}

    channel = row.get("channel_username", "?")
    msg_id = row.get("telegram_message_id", "?")
    media_type = row.get("type", "?")
    size_bytes = row.get("size_bytes")
    size_str = f"{int(size_bytes)/1e6:.1f}MB" if size_bytes else "unknown"

    tiktok_gram_log(
        f"[media-cache] START media={media_id} channel=@{channel} msg={msg_id}"
        f" type={media_type} size={size_str} status={row.get('cache_status')}",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )

    if not row.get("telegram_access_hash"):
        tiktok_gram_log(f"[media-cache] SKIP media={media_id} reason=missing_access_hash", file_env="TIKTOK_GRAM_MEDIA_LOG")
        update_media_cache_status(
            media_id,
            cache_status="failed",
            last_cache_error="missing telegram_access_hash",
            increment_attempt=True,
        )
        return {"mediaId": media_id, "skipped": "missing_refs"}

    if media_type == "photo":
        if row.get("cache_status") == "ready" and row.get("has_cached_data"):
            tiktok_gram_log(f"[media-cache] SKIP media={media_id} reason=already_ready_pg", file_env="TIKTOK_GRAM_MEDIA_LOG")
            return {"mediaId": media_id, "skipped": "already_ready"}
        return cache_photo_job(media_id, row, started)

    if row.get("cache_status") == "ready" and row.get("storage_key"):
        tiktok_gram_log(f"[media-cache] SKIP media={media_id} reason=already_ready key={row['storage_key']}", file_env="TIKTOK_GRAM_MEDIA_LOG")
        return {"mediaId": media_id, "skipped": "already_ready"}

    # Retry rows that failed while MinIO or Telegram was temporarily unavailable.
    if row.get("cache_status") == "failed":
        tiktok_gram_log(f"[media-cache] RETRY media={media_id} resetting failed→needs_cache", file_env="TIKTOK_GRAM_MEDIA_LOG")
        update_media_cache_status(
            media_id,
            cache_status="needs_cache",
            last_cache_error=None,
            clear_storage=True,
        )
        row["cache_status"] = "needs_cache"

    if row.get("cache_status") == "skipped":
        tiktok_gram_log(f"[media-cache] SKIP media={media_id} reason=policy_skipped", file_env="TIKTOK_GRAM_MEDIA_LOG")
        return {"mediaId": media_id, "skipped": "policy_skipped"}

    if size_bytes is not None and int(size_bytes) > max_cache_bytes():
        tiktok_gram_log(
            f"[media-cache] SKIP media={media_id} reason=oversize size={size_str} max={max_cache_bytes()/1e6:.0f}MB",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )
        update_media_cache_status(
            media_id,
            cache_status="skipped",
            last_cache_error=f"oversize:{size_bytes}",
            increment_attempt=True,
        )
        return {"mediaId": media_id, "skipped": "oversize", "sizeBytes": size_bytes}

    incoming_bytes = int(size_bytes) if size_bytes else 0
    if incoming_bytes > 0:
        _evict_to_fit(incoming_bytes)

    update_media_cache_status(
        media_id,
        cache_status="downloading",
        increment_attempt=True,
        clear_storage=True,
    )

    ext = extension_for_media(row["type"], row.get("mime_type"))
    object_key = media_object_key(media_id, ext)
    mime_type = row.get("mime_type") or mimetypes.types_map.get(f".{ext}", "application/octet-stream")

    tiktok_gram_log(
        f"[media-cache] DOWNLOAD media={media_id} channel=@{channel} msg={msg_id} ext={ext}",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )

    tmp_path: Path | None = None
    normalized_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            tmp_path = Path(tmp.name)

        asyncio.run(_download_message_media(row, tmp_path))

        # Guarantee the stored file is playable on every client (see
        # normalize_video_for_playback). Photos took the cache_photo_job path
        # above, so anything here is video/animation.
        upload_path, transcoded = normalize_video_for_playback(tmp_path, media_id)
        if transcoded:
            normalized_path = upload_path
            # The re-encode is always MP4/H.264 whatever the source container was.
            object_key = media_object_key(media_id, "mp4")
            mime_type = "video/mp4"

        tiktok_gram_log(
            f"[media-cache] UPLOAD media={media_id} key={object_key} mime={mime_type}",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )
        cached_size = upload_file_to_storage(upload_path, object_key, mime_type)

        update_media_cache_status(
            media_id,
            cache_status="ready",
            storage_key=object_key,
            cached_size_bytes=cached_size,
            cache_range_ready=True,
        )

        elapsed_ms = int((time.monotonic() - started) * 1000)
        tiktok_gram_log(
            f"[media-cache] READY media={media_id} key={object_key}"
            f" size={cached_size/1e6:.2f}MB elapsed={elapsed_ms}ms",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )

        # Post-cache hook: advance the post's unified status (caching → ready for
        # video/mixed, or → needs_audio for photo posts, which then triggers the
        # music picker). Never raises into this job.
        _advance_post_status_after_cache(row.get("desc_id"))

        return {
            "mediaId": media_id,
            "status": "ready",
            "storageKey": object_key,
            "cachedSizeBytes": cached_size,
            "elapsedMs": elapsed_ms,
        }
    except Exception as exc:  # noqa: BLE001
        elapsed_ms = int((time.monotonic() - started) * 1000)
        tiktok_gram_log(
            f"[media-cache] FAILED media={media_id} channel=@{channel} msg={msg_id}"
            f" error={type(exc).__name__}: {exc} elapsed={elapsed_ms}ms",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )
        update_media_cache_status(
            media_id,
            cache_status="failed",
            last_cache_error=f"{type(exc).__name__}: {exc}",
            clear_storage=True,
        )
        raise
    finally:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        if normalized_path is not None and normalized_path.exists():
            normalized_path.unlink(missing_ok=True)


def head_cached_object(object_key: str) -> bool:
    bucket = os.environ.get("S3_BUCKET", MEDIA_CACHE_BUCKET)
    try:
        s3_client().head_object(Bucket=bucket, Key=object_key)
        return True
    except ClientError:
        return False


def _evict_to_fit(incoming_bytes: int) -> None:
    """Before caching a new file, evict oldest unprotected media to stay within budget."""
    from media_cache_cleanup import (
        cache_budget_bytes,
        get_cached_total_bytes,
        list_eviction_candidates_v2,
        evict_media,
        protect_per_channel_count,
    )
    from psycopg2.extras import RealDictCursor

    budget = cache_budget_bytes()
    with db_connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            current = get_cached_total_bytes(cur)
            needed = current + incoming_bytes - budget
            if needed <= 0:
                return
            candidates = list_eviction_candidates_v2(cur)

    tiktok_gram_log(
        f"[budget] need to free {needed/1e6:.1f}MB"
        f" (current={current/1e6:.1f}MB + incoming={incoming_bytes/1e6:.1f}MB > budget={budget/1e6:.0f}MB)"
        f" candidates={len(candidates)}",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )

    if not candidates:
        tiktok_gram_log(
            f"[budget] WARNING: cannot free space — all media inside per-channel"
            f" protection window (protect={protect_per_channel_count()}). Storage stays over budget.",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )
        return

    freed = 0
    evicted_count = 0
    for candidate in candidates:
        if freed >= needed:
            break
        freed_now = evict_media(str(candidate["id"]), str(candidate["storage_key"]), dry_run=False)
        freed += freed_now
        evicted_count += 1

    tiktok_gram_log(
        f"[budget] evicted {evicted_count} items freed={freed/1e6:.1f}MB to fit incoming={incoming_bytes/1e6:.1f}MB",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )
