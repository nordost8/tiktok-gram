#!/usr/bin/env python3
"""
Remove a Telegram channel completely: R2 storage → DB → Telegram unsubscribe.

Usage:
  python3 scripts/remove-channel.py @ifnmu_book
  python3 scripts/remove-channel.py ifnmu_book
  python3 scripts/remove-channel.py https://t.me/ifnmu_book
  python3 scripts/remove-channel.py -1001355807507
  python3 scripts/remove-channel.py --dry-run @ifnmu_book
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import boto3
import psycopg2
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from telegram_collector_lib import load_env, tiktok_gram_log, make_client, require_env  # noqa: E402


def parse_identifier(raw: str) -> str:
    """Normalize to plain username or numeric ID string."""
    raw = raw.strip().rstrip("/")
    if raw.startswith("https://t.me/"):
        raw = raw.split("t.me/")[-1].split("/")[0]
    return raw.lstrip("@")


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("S3_REGION", "auto"),
    )


def delete_r2_objects(storage_keys: list[str], bucket: str, *, dry_run: bool) -> int:
    if not storage_keys:
        return 0
    tag = " [DRY-RUN]" if dry_run else ""
    tiktok_gram_log(f"[remove-channel]{tag} deleting {len(storage_keys)} R2 objects")
    if dry_run:
        for k in storage_keys:
            tiktok_gram_log(f"[remove-channel][DRY-RUN] would delete R2: {k}")
        return len(storage_keys)
    s3 = s3_client()
    deleted = 0
    for key in storage_keys:
        try:
            s3.delete_object(Bucket=bucket, Key=key)
            tiktok_gram_log(f"[remove-channel] deleted R2: {key}")
            deleted += 1
        except Exception as exc:  # noqa: BLE001
            tiktok_gram_log(f"[remove-channel] WARNING: failed to delete R2 {key}: {exc}")
    return deleted


async def leave_telegram(identifier: str) -> bool:
    from telethon.tl.functions.channels import LeaveChannelRequest

    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")
    client = make_client(api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            tiktok_gram_log("[remove-channel] WARNING: userbot not authorized, skipping unsubscribe")
            return False
        ident = int(identifier) if identifier.lstrip("-").isdigit() else identifier
        entity = await client.get_entity(ident)
        await client(LeaveChannelRequest(entity))
        tiktok_gram_log(f"[remove-channel] left Telegram channel: {getattr(entity, 'title', identifier)}")
        return True
    except Exception as exc:  # noqa: BLE001
        tiktok_gram_log(f"[remove-channel] WARNING: could not leave Telegram channel: {exc}")
        return False
    finally:
        await client.disconnect()


def remove_channel(identifier: str, *, dry_run: bool) -> dict:
    load_env()
    bucket = os.environ.get("S3_BUCKET", "test")
    tag = " [DRY-RUN]" if dry_run else ""
    url = os.environ["POSTGRES_URL"].strip().strip('"').strip("'")

    conn = psycopg2.connect(url)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Find channel (by username or numeric telegram ID)
            if identifier.lstrip("-").isdigit():
                cur.execute(
                    "SELECT id, username, title FROM telegram_channels WHERE username = %s",
                    (identifier,),
                )
            else:
                cur.execute(
                    "SELECT id, username, title FROM telegram_channels WHERE LOWER(username) = LOWER(%s)",
                    (identifier,),
                )
            ch = cur.fetchone()

        if not ch:
            tiktok_gram_log(f"[remove-channel]{tag} channel '{identifier}' not found in DB — nothing to do")
            return {"ok": False, "error": "not_found"}

        channel_id = str(ch["id"])
        username = ch["username"]
        title = ch["title"]
        tiktok_gram_log(f"[remove-channel]{tag} found: @{username} ({title}) id={channel_id}")

        # Collect R2 storage keys
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT m.storage_key
                FROM telegram_post_media m
                JOIN telegram_post_descriptions d ON d.id = m.desc_id
                WHERE d.channel_id = %s AND m.storage_key IS NOT NULL
                """,
                (channel_id,),
            )
            storage_keys = [row["storage_key"] for row in cur.fetchall()]

        tiktok_gram_log(f"[remove-channel]{tag} found {len(storage_keys)} R2 objects")

        # Delete from R2
        deleted_r2 = delete_r2_objects(storage_keys, bucket, dry_run=dry_run)

        # Delete from DB (cascades to posts, media, likes, saves, views)
        if dry_run:
            tiktok_gram_log(f"[remove-channel][DRY-RUN] would DELETE from telegram_channels WHERE id={channel_id}")
        else:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM telegram_channels WHERE id = %s", (channel_id,))
            conn.commit()
            tiktok_gram_log(f"[remove-channel] deleted from DB: @{username}")

    finally:
        conn.close()

    # Unsubscribe userbot from Telegram
    if dry_run:
        tiktok_gram_log(f"[remove-channel][DRY-RUN] would leave Telegram channel @{username}")
        left_telegram = False
    else:
        left_telegram = asyncio.run(leave_telegram(username))

    result = {
        "ok": True,
        "dryRun": dry_run,
        "username": username,
        "title": title,
        "deletedR2": deleted_r2,
        "deletedFromDb": not dry_run,
        "leftTelegram": left_telegram,
    }
    tiktok_gram_log(f"[remove-channel]{tag} DONE {result}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove a Telegram channel from R2, DB and unsubscribe userbot")
    parser.add_argument("channel", help="@username, username, t.me/link, or numeric channel ID")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be deleted without actually deleting")
    args = parser.parse_args()

    identifier = parse_identifier(args.channel)
    remove_channel(identifier, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
