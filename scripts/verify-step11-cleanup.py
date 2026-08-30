#!/usr/bin/env python3
"""Verify media cache cleanup: budget, protection, MinIO + DB + API integration."""

from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import boto3
import psycopg2
from botocore.config import Config
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from media_cache_cleanup import run_media_cache_cleanup  # noqa: E402
from telegram_collector_lib import load_env, require_env  # noqa: E402

CHANNEL = "__verify_step11_cleanup__"
PAYLOAD_SIZE = 12_000
BUDGET = PAYLOAD_SIZE + 2_000
API_BASE = os.environ.get("MEDIA_API_BASE_URL", "http://127.0.0.1:3000")


def db_connect():
    load_env()
    url = require_env("POSTGRES_URL").strip('"')
    parsed = urlparse(url)
    return psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        user=parsed.username,
        password=parsed.password,
        dbname=parsed.path.lstrip("/"),
    )


def s3():
    load_env()
    return boto3.client(
        "s3",
        endpoint_url=require_env("S3_ENDPOINT"),
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=require_env("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=require_env("S3_SECRET_ACCESS_KEY"),
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def head_object(key: str) -> bool:
    bucket = os.environ.get("S3_BUCKET", "tiktok-gram-media")
    try:
        s3().head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


def put_object(key: str, body: bytes) -> None:
    bucket = os.environ.get("S3_BUCKET", "tiktok-gram-media")
    s3().put_object(Bucket=bucket, Key=key, Body=body, ContentType="image/jpeg")


def api_head(media_id: str) -> tuple[int, str | None]:
    req = Request(f"{API_BASE}/api/media/{media_id}", method="GET")
    with urlopen(req, timeout=30) as resp:
        return resp.status, resp.headers.get("X-Media-Source")


def setup_fixture(cur) -> tuple[str, str, str, str]:
    cur.execute(
        """
        INSERT INTO telegram_channels (username, title, status)
        VALUES (%s, 'Cleanup verify', 'active')
        ON CONFLICT (username) DO UPDATE SET status = 'active'
        RETURNING id
        """,
        (CHANNEL,),
    )
    channel_id = cur.fetchone()["id"]
    cur.execute(
        """
        DELETE FROM telegram_posts
        WHERE channel_id = %s
        """,
        (channel_id,),
    )

    now = datetime.now(timezone.utc)
    old_at = now - timedelta(days=30)
    new_at = now - timedelta(hours=1)

    old_post = str(uuid.uuid4())
    new_post = str(uuid.uuid4())
    old_media = str(uuid.uuid4())
    new_media = str(uuid.uuid4())

    for post_id, msg_id, published_at, media_id in (
        (old_post, "cleanup-old", old_at, old_media),
        (new_post, "cleanup-new", new_at, new_media),
    ):
        cur.execute(
            """
            INSERT INTO telegram_posts (
              id, channel_id, telegram_message_id, telegram_url,
              published_at, status
            ) VALUES (%s, %s, %s, %s, %s, 'ready')
            """,
            (
                post_id,
                channel_id,
                msg_id,
                f"https://t.me/{CHANNEL}/{msg_id}",
                published_at,
            ),
        )

        key = f"media/{media_id}.jpg"
        cur.execute(
            """
            INSERT INTO telegram_post_media (
              id, post_id, type, telegram_document_id, telegram_access_hash,
              telegram_file_reference, telegram_dc_id, mime_type, is_primary,
              cache_status, storage_backend, storage_bucket, storage_key,
              cached_size_bytes, cached_mime_type, cache_range_ready
            ) VALUES (
              %s, %s, 'photo', '1', '2', 'dGVzdA==', 2, 'image/jpeg', TRUE,
              'ready', 'r2', 'tiktok-gram-media', %s, %s, 'image/jpeg', TRUE
            )
            """,
            (media_id, post_id, key, PAYLOAD_SIZE),
        )
        cur.execute(
            "UPDATE telegram_posts SET primary_media_id = %s WHERE id = %s",
            (media_id, post_id),
        )
        put_object(key, b"x" * PAYLOAD_SIZE)

    return old_media, new_media, f"media/{old_media}.jpg", f"media/{new_media}.jpg"


def cleanup_fixture(cur, old_media: str, new_media: str) -> None:
    cur.execute(
        """
        DELETE FROM telegram_posts
        WHERE channel_id IN (SELECT id FROM telegram_channels WHERE username = %s)
        """,
        (CHANNEL,),
    )
    for key in (f"media/{old_media}.jpg", f"media/{new_media}.jpg"):
        try:
            bucket = os.environ.get("S3_BUCKET", "tiktok-gram-media")
            s3().delete_object(Bucket=bucket, Key=key)
        except Exception:
            pass


def main() -> None:
    load_env()
    os.environ["MEDIA_CACHE_BUDGET_BYTES"] = str(BUDGET)
    os.environ["MEDIA_CACHE_PROTECT_POSTS"] = "1"

    conn = db_connect()
    conn.autocommit = False
    old_media = new_media = old_key = new_key = ""

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            old_media, new_media, old_key, new_key = setup_fixture(cur)
            conn.commit()

        dry = run_media_cache_cleanup(dry_run=True, channel_username=CHANNEL)
        if dry["evictedCount"] < 1:
            raise AssertionError(f"dry-run expected evictions, got {dry}")

        result = run_media_cache_cleanup(dry_run=False, channel_username=CHANNEL)
        if result["evictedCount"] < 1:
            raise AssertionError(f"cleanup expected evictions, got {result}")
        if old_media not in result["evictedMediaIds"]:
            raise AssertionError("old media should be evicted")

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT cache_status, storage_key FROM telegram_post_media WHERE id = %s",
                (old_media,),
            )
            old_row = dict(cur.fetchone())
            cur.execute(
                "SELECT cache_status, storage_key FROM telegram_post_media WHERE id = %s",
                (new_media,),
            )
            new_row = dict(cur.fetchone())

        if old_row["cache_status"] != "needs_cache" or old_row["storage_key"]:
            raise AssertionError(f"old media not reset: {old_row}")
        if new_row["cache_status"] != "ready" or not new_row["storage_key"]:
            raise AssertionError(f"new media should stay cached: {new_row}")
        if head_object(old_key):
            raise AssertionError("old MinIO object should be deleted")
        if not head_object(new_key):
            raise AssertionError("new MinIO object should remain")

        new_status, new_source = api_head(new_media)
        if new_status != 200 or new_source != "object-storage":
            raise AssertionError(
                f"protected API should serve object-storage, got {new_status} {new_source}",
            )

        print(
            json.dumps(
                {
                    "ok": True,
                    "cleanup": result,
                    "oldMedia": old_media,
                    "newMedia": new_media,
                    "apiNewSource": new_source,
                },
                ensure_ascii=False,
            ),
        )
    finally:
        with conn.cursor() as cur:
            if old_media and new_media:
                cleanup_fixture(cur, old_media, new_media)
            conn.commit()
        conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)
