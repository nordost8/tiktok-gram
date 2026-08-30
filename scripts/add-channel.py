#!/usr/bin/env python3
"""
Subscribe userbot to a Telegram channel and add it to the DB collector.

last_synced_message_id is intentionally never set here — the collector will
perform the initial scan automatically on the next run.

Usage:
  python3 scripts/add-channel.py @psy_compass_community
  python3 scripts/add-channel.py https://t.me/moztrash
  python3 scripts/add-channel.py -1001206439755
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from telegram_collector_lib import load_env, tiktok_gram_log, make_client, require_env  # noqa: E402


def parse_identifier(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    if raw.startswith("https://t.me/"):
        raw = raw.split("t.me/")[-1].split("/")[0]
    return raw.lstrip("@")


async def join_and_resolve(identifier: str) -> tuple[str, str, str | None]:
    """Join the channel via userbot. Returns (username, title, telegram_channel_id)."""
    from telethon.tl.functions.channels import JoinChannelRequest

    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")
    client = make_client(api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise RuntimeError("Userbot not authorized. Run: pnpm telegram:channels")
        ident: int | str = int(identifier) if identifier.lstrip("-").isdigit() else identifier
        entity = await client.get_entity(ident)
        await client(JoinChannelRequest(entity))
        username: str = getattr(entity, "username", None) or identifier
        title: str = getattr(entity, "title", username)
        telegram_channel_id: str | None = str(entity.id) if hasattr(entity, "id") else None
        tiktok_gram_log(f"[add-channel] joined @{username} ({title})")
        return username, title, telegram_channel_id
    finally:
        await client.disconnect()


def add_channel(identifier: str) -> dict:
    load_env()
    url = require_env("POSTGRES_URL").strip().strip('"').strip("'")

    username, title, telegram_channel_id = asyncio.run(join_and_resolve(identifier))

    conn = psycopg2.connect(url)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, status, last_synced_message_id FROM telegram_channels WHERE LOWER(username) = LOWER(%s)",
                (username,),
            )
            existing = cur.fetchone()

            if existing:
                cur.execute(
                    "UPDATE telegram_channels SET status = 'active', updated_at = NOW() WHERE id = %s",
                    (existing["id"],),
                )
                tiktok_gram_log(f"[add-channel] @{username} already in DB (was {existing['status']}), set active")
                action = "reactivated"
            else:
                # last_synced_message_id is deliberately omitted — NULL triggers initial sync
                cur.execute(
                    """
                    INSERT INTO telegram_channels (id, username, title, telegram_channel_id, status, language)
                    VALUES (%s, %s, %s, %s, 'active', 'uk')
                    """,
                    (str(uuid.uuid4()), username, title, telegram_channel_id),
                )
                tiktok_gram_log(f"[add-channel] @{username} inserted into DB")
                action = "added"

        conn.commit()
    finally:
        conn.close()

    result = {"ok": True, "username": username, "title": title, "action": action}
    tiktok_gram_log(f"[add-channel] DONE {result}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Subscribe userbot + add channel to DB. Run collector after to ingest posts."
    )
    parser.add_argument("channel", help="@username, username, t.me/link, or numeric channel ID")
    args = parser.parse_args()

    identifier = parse_identifier(args.channel)
    result = add_channel(identifier)
    print(f"✓ {result['action']} @{result['username']} — run collector to ingest posts")


if __name__ == "__main__":
    main()
