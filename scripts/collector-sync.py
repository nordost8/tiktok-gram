#!/usr/bin/env python3
"""
Sync active channels from telegram_channels (DB) into Postgres.
Runs in Docker on Pi (see deploy/pi/docker-compose.yml).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parents[1]
COLLECTOR_SCRIPT = ROOT / "scripts" / "telegram-collector.py"
LOG_PATH = Path(os.environ.get("TIKTOK_GRAM_COLLECTOR_LOG", ""))

sys.path.insert(0, str(ROOT / "scripts"))


def load_env() -> None:
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
    line = f"{datetime.now(timezone.utc).isoformat()} {msg}"
    print(line, flush=True)
    if LOG_PATH and str(LOG_PATH):
        try:
            LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with LOG_PATH.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass


def video_only_feed() -> bool:
    return os.environ.get("COLLECTOR_VIDEO_ONLY", "1") != "0"


def skip_mixed_posts() -> bool:
    """Drop posts that mix video/animation with photos. Default ON per owner."""
    return os.environ.get("COLLECTOR_SKIP_MIXED", "1") != "0"


def run_collector(username: str, limit: int, after_id: int | None) -> dict:
    args = [sys.executable, str(COLLECTOR_SCRIPT), username, "--limit", str(limit)]
    if after_id is not None:
        args.extend(["--after-id", str(after_id)])
    elif video_only_feed():
        # Initial sync in video-only mode: fetch until `limit` video posts found
        args.extend(["--video-limit", str(limit)])
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "collector failed")
    return json.loads(result.stdout)


def ingest_post(cur, channel_id: str, row: dict) -> list[str]:
    """Insert/update description and media rows. Returns list of new media IDs."""
    media = row.get("media") or []
    grouped_id = row.get("groupedId")

    # Filter to media with resolvable Telegram refs
    valid_media = [
        m for m in media
        if m.get("telegramAccessHash") and (m.get("telegramDocumentId") or m.get("telegramPhotoId"))
    ]

    if not valid_media:
        return []

    if video_only_feed():
        has_video = any(m["type"] in ("video", "animation") for m in valid_media)
        if not has_video:
            return []

    # Skip mixed posts (video/animation + photo) entirely — they are never
    # stored. Runs before any description/media insert. Default ON.
    if skip_mixed_posts():
        has_video = any(m["type"] in ("video", "animation") for m in valid_media)
        has_photo = any(m["type"] == "photo" for m in valid_media)
        if has_video and has_photo:
            return []

    if grouped_id:
        # Album message: find or create shared description
        cur.execute(
            """
            SELECT id, text FROM telegram_post_descriptions
            WHERE channel_id = %s AND telegram_grouped_id = %s
            """,
            (channel_id, grouped_id),
        )
        existing = cur.fetchone()

        if existing:
            desc_id = existing["id"]
            # Propagate text if the existing description has none
            if not existing["text"] and (row.get("text") or row.get("caption")):
                cur.execute(
                    """
                    UPDATE telegram_post_descriptions
                    SET text = %s, caption = %s
                    WHERE id = %s
                    """,
                    (row.get("text"), row.get("caption"), desc_id),
                )
        else:
            desc_id = str(uuid.uuid4())
            cur.execute(
                """
                INSERT INTO telegram_post_descriptions (
                  id, channel_id, telegram_message_id, telegram_grouped_id,
                  telegram_url, text, caption, published_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    desc_id,
                    channel_id,
                    row["telegramMessageId"],
                    grouped_id,
                    row["telegramUrl"],
                    row.get("text"),
                    row.get("caption"),
                    row["publishedAt"],
                ),
            )
    else:
        # Single post: insert on conflict do nothing
        desc_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO telegram_post_descriptions (
              id, channel_id, telegram_message_id,
              telegram_url, text, caption, published_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (channel_id, telegram_message_id) DO NOTHING
            RETURNING id
            """,
            (
                desc_id,
                channel_id,
                row["telegramMessageId"],
                row["telegramUrl"],
                row.get("text"),
                row.get("caption"),
                row["publishedAt"],
            ),
        )
        if not cur.fetchone():
            return []

    # Insert media rows
    media_ids = []
    for m in valid_media:
        mid = str(uuid.uuid4())
        media_ids.append(mid)
        cur.execute(
            """
            INSERT INTO telegram_post_media (
              id, desc_id, type, telegram_document_id, telegram_photo_id,
              telegram_access_hash, telegram_file_reference, telegram_dc_id,
              mime_type, width, height, duration, size_bytes, cache_status
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'needs_cache'
            )
            """,
            (
                mid,
                desc_id,
                m["type"],
                m.get("telegramDocumentId"),
                m.get("telegramPhotoId"),
                m.get("telegramAccessHash"),
                m.get("telegramFileReference"),
                m.get("telegramDcId"),
                m.get("mimeType"),
                m.get("width"),
                m.get("height"),
                m.get("duration"),
                m.get("sizeBytes"),
            ),
        )

    return media_ids


def sync_channel(conn, username: str, limit: int) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT id, last_synced_message_id FROM telegram_channels WHERE username = %s",
            (username,),
        )
        ch = cur.fetchone()
        if not ch:
            return {"username": username, "ok": False, "error": "not in telegram_channels"}

        after_id = (
            int(ch["last_synced_message_id"])
            if ch["last_synced_message_id"]
            else None
        )
        payload = run_collector(username, limit, after_id)

        ingested = skipped = 0
        all_media_ids: list[str] = []
        for row in payload.get("messages", []):
            media_ids = ingest_post(cur, ch["id"], row)
            if media_ids:
                ingested += 1
                all_media_ids.extend(media_ids)
            else:
                skipped += 1

        new_last = payload.get("newLastSyncedMessageId")
        if new_last:
            cur.execute(
                """
                UPDATE telegram_channels
                SET last_synced_message_id = %s, last_post_at = NOW(), updated_at = NOW()
                WHERE id = %s
                """,
                (new_last, ch["id"]),
            )

        avatar_result = None
        try:
            from channel_avatar_cache import cache_channel_avatar

            avatar_result = cache_channel_avatar(conn, str(ch["id"]), username)
        except Exception as exc:  # noqa: BLE001
            log(f"avatar cache failed @{username}: {exc}")

        conn.commit()

    # Enqueue after commit so load_media_row can see the new rows
    from media_queue_lib import enqueue_media_cache

    cache_enqueued = 0
    for mid in all_media_ids:
        try:
            result = enqueue_media_cache(mid)
            if result.get("enqueued"):
                cache_enqueued += 1
        except Exception as exc:  # noqa: BLE001
            log(f"enqueue failed media={mid} err={exc}")

    return {
        "username": username,
        "ok": True,
        "fetched": payload.get("fetched", 0),
        "ingested": ingested,
        "skipped": skipped,
        "cacheEnqueued": cache_enqueued,
        "lastSyncedMessageId": new_last,
        "avatar": avatar_result,
    }


def main() -> None:
    load_env()
    url = os.environ.get("POSTGRES_URL", "").strip().strip('"').strip("'")
    if not url:
        raise RuntimeError("POSTGRES_URL missing in .env")

    limit = int(os.environ.get("COLLECTOR_LIMIT", "15"))

    conn = psycopg2.connect(url)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT username FROM telegram_channels WHERE status = 'active' ORDER BY username"
            )
            enabled = [row["username"] for row in cur.fetchall()]

        if not enabled:
            log("No active channels in telegram_channels")
            sys.exit(0)

        log(f"collector start channels={enabled} limit={limit}")

        results = []
        for u in enabled:
            try:
                results.append(sync_channel(conn, u, limit))
            except Exception as exc:  # noqa: BLE001
                log(f"channel error @{u}: {exc}")
                results.append({"username": u, "ok": False, "error": str(exc)})
    finally:
        conn.close()

    log(f"collector done {json.dumps(results, ensure_ascii=False)}")
    print(json.dumps({"ok": True, "results": results}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        log(f"collector error {exc}")
        sys.exit(1)
