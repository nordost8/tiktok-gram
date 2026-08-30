#!/usr/bin/env python3
"""
Fetch channel posts from Telegram and emit JSON for collector-sync.ts.

Usage:
  python3 scripts/telegram-collector.py babel --limit 75
  python3 scripts/telegram-collector.py babel --after-id 83900 --limit 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any


sys.path.insert(0, str(Path(__file__).resolve().parent))

from telegram_collector_lib import (
    make_client,
    extract_feed_media,
    load_env,
    message_to_ingest_row,
    require_env,
)


async def fetch_messages(
    username: str,
    *,
    limit: int,
    after_id: int | None,
    video_limit: int | None = None,
) -> dict[str, Any]:
    load_env()
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")

    client = make_client(api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise RuntimeError("Not authorized. Run: pnpm telegram:channels")

        identifier: int | str = int(username) if username.lstrip("-").isdigit() else username
        entity = await client.get_entity(identifier)
        collected: list[Any] = []

        if video_limit is not None and after_id is None:
            # Initial sync: fetch until we have video_limit video posts (cap at video_limit*20)
            max_scan = video_limit * 20
            video_found = 0
            async for message in client.iter_messages(entity, limit=max_scan):
                collected.append(message)
                row = message_to_ingest_row(username, message)
                if any(m.get("type") in ("video", "animation") for m in (row.get("media") or [])):
                    video_found += 1
                    if video_found >= video_limit:
                        break
        else:
            kwargs: dict[str, Any] = {"limit": limit}
            if after_id is not None:
                kwargs["min_id"] = after_id
            async for message in client.iter_messages(entity, **kwargs):
                collected.append(message)
    finally:
        await client.disconnect()

    collected.reverse()
    rows = [message_to_ingest_row(username, msg) for msg in collected]

    # For grouped posts: caption may live on any sibling (photo, text-only, etc.)
    # Collect first non-empty text from any message in each group, then copy it
    # into media messages that have no text of their own.
    group_texts: dict[str, str] = {}
    for r in rows:
        if r.get("groupedId") and r.get("text") and r["groupedId"] not in group_texts:
            group_texts[r["groupedId"]] = r["text"]
    for row in rows:
        if row.get("groupedId") and not row.get("text") and row.get("media"):
            merged = group_texts.get(row["groupedId"])
            if merged:
                row["text"] = merged
                row["caption"] = merged

    max_id = max((int(r["telegramMessageId"]) for r in rows), default=after_id)

    with_media = sum(1 for r in rows if r["media"])
    skipped = len(rows) - with_media

    return {
        "ok": True,
        "username": username,
        "entityTitle": getattr(entity, "title", None),
        "afterId": after_id,
        "limit": limit,
        "fetched": len(rows),
        "withMedia": with_media,
        "skippedNoMedia": skipped,
        "newLastSyncedMessageId": str(max_id) if max_id is not None else None,
        "messages": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Telegram channel posts as JSON")
    parser.add_argument("channel", help="Channel username without @")
    parser.add_argument("--limit", type=int, default=75, help="Max messages to fetch")
    parser.add_argument(
        "--after-id",
        type=int,
        default=None,
        help="Only messages with id greater than this (incremental sync)",
    )
    parser.add_argument(
        "--video-limit",
        type=int,
        default=None,
        help="For initial sync: fetch until this many video posts are found (overrides --limit)",
    )
    args = parser.parse_args()
    username = args.channel.lstrip("@")

    try:
        payload = asyncio.run(
            fetch_messages(username, limit=args.limit, after_id=args.after_id, video_limit=args.video_limit),
        )
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
