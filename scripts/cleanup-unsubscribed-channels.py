#!/usr/bin/env python3
"""Remove channels the userbot is no longer subscribed to.

Steps:
1. Load all active channels from DB
2. Fetch current Telegram dialogs via userbot
3. Find channels in DB but not in dialogs
4. Delete their media from R2, avatar from R2, then delete from DB (CASCADE)
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from media_cache_job import s3_client, load_env, require_env
from telegram_collector_lib import make_client

import os


def get_db_conn():
    from urllib.parse import urlparse
    url = require_env("POSTGRES_URL").strip('"')
    p = urlparse(url)
    return psycopg2.connect(
        host=p.hostname, port=p.port or 5432,
        user=p.username, password=p.password,
        dbname=p.path.lstrip("/"),
    )


def list_r2_objects_for_channel(bucket: str, channel_id: str) -> list[str]:
    """List all media object keys for a channel."""
    s3 = s3_client()
    keys = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=f"media/"):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])

    # Filter by matching storage_key in DB (done in caller)
    return keys


def delete_r2_objects(bucket: str, keys: list[str]) -> int:
    if not keys:
        return 0
    s3 = s3_client()
    batch_size = 1000
    deleted = 0
    for i in range(0, len(keys), batch_size):
        batch = [{"Key": k} for k in keys[i:i + batch_size]]
        resp = s3.delete_objects(Bucket=bucket, Delete={"Objects": batch})
        deleted += len(resp.get("Deleted", []))
    return deleted


async def get_telegram_dialog_ids(client) -> set[int]:
    """Return set of channel/chat entity IDs currently in dialogs."""
    from telethon.tl.types import Channel
    ids = set()
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if isinstance(entity, Channel):
            ids.add(entity.id)
    return ids


async def run(target_username: str | None = None) -> list[dict]:
    load_env()
    bucket = os.environ.get("S3_BUCKET", "tiktok-gram-media")
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")

    conn = get_db_conn()
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        if target_username:
            cur.execute(
                "SELECT id, username, title, avatar_url FROM telegram_channels "
                "WHERE username = %s",
                (target_username,),
            )
        else:
            cur.execute(
                "SELECT id, username, title, avatar_url FROM telegram_channels "
                "WHERE status = 'active'"
            )
        channels = cur.fetchall()

    print(f"[cleanup] {len(channels)} channel(s) to check", flush=True)

    # For a targeted single-channel delete, skip Telegram check
    if target_username:
        to_delete = list(channels)
    else:
        client = make_client(api_id, api_hash)
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            raise RuntimeError("Telegram userbot not authorized")
        try:
            dialog_ids = await get_telegram_dialog_ids(client)
        finally:
            await client.disconnect()

        print(f"[cleanup] {len(dialog_ids)} dialogs in Telegram", flush=True)

        to_delete = []
        for ch in channels:
            username = ch["username"]
            # Numeric -100XXXXXXX → extract actual channel ID for comparison
            if username.lstrip("-").isdigit():
                ch_id = int(username.lstrip("-")[3:]) if username.startswith("-100") else int(username)
            else:
                ch_id = None

            in_dialogs = ch_id in dialog_ids if ch_id else True  # can't verify public by ID
            if not in_dialogs:
                to_delete.append(ch)

    print(f"[cleanup] {len(to_delete)} channel(s) to remove", flush=True)

    results = []
    conn2 = get_db_conn()
    s3 = s3_client()

    for ch in to_delete:
        channel_id = str(ch["id"])
        result: dict = {"channel": ch["username"], "title": ch["title"]}

        # 1. Collect all media storage keys for this channel
        with conn2.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT tpm.storage_key
                FROM telegram_post_media tpm
                JOIN telegram_post_descriptions tpd ON tpd.id = tpm.desc_id
                WHERE tpd.channel_id = %s AND tpm.storage_key IS NOT NULL
                """,
                (channel_id,),
            )
            media_keys = [r["storage_key"] for r in cur.fetchall()]

        # 2. Delete media from R2
        r2_deleted = delete_r2_objects(bucket, media_keys)
        result["media_r2_deleted"] = r2_deleted

        # 3. Delete avatar from R2
        avatar_deleted = 0
        if ch["avatar_url"]:
            try:
                s3.delete_object(Bucket=bucket, Key=ch["avatar_url"])
                avatar_deleted = 1
            except Exception as e:
                result["avatar_error"] = str(e)
        result["avatar_r2_deleted"] = avatar_deleted

        # 4. Delete from DB (CASCADE removes posts, post_media, views, likes, saves)
        with conn2.cursor() as cur:
            cur.execute("DELETE FROM telegram_channels WHERE id = %s", (channel_id,))
        conn2.commit()
        result["db_deleted"] = True

        print(json.dumps(result, ensure_ascii=False), flush=True)
        results.append(result)

    conn2.close()
    conn.close()
    return results


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", default=None, help="Delete specific channel by username")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.dry_run:
        print("dry-run not yet implemented — add --channel <username> to target one channel")
        sys.exit(0)

    results = asyncio.run(run(target_username=args.channel))
    print(json.dumps({"ok": True, "removed": len(results), "results": results},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
