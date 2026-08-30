#!/usr/bin/env python3
"""Check Telegram channel access for a list of usernames/titles/invite links.

Usage:
  python scripts/check-channels-access.py --username channel_one --username channel_two
  python scripts/check-channels-access.py --invite https://t.me/+abc123
  python scripts/check-channels-access.py --title "Some Channel Name"
"""

from __future__ import annotations
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_collector_lib import load_env, require_env, make_client


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", action="append", default=[], help="Channel @username (repeatable)")
    parser.add_argument("--invite", action="append", default=[], help="Private invite link (repeatable)")
    parser.add_argument("--title", action="append", default=[], help="Search your dialogs by title keyword (repeatable)")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    load_env()
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")

    client = make_client(api_id, api_hash)
    await client.connect()
    try:
        results = []

        for username in args.username:
            try:
                entity = await client.get_entity(username)
                results.append({
                    "query": username,
                    "username": getattr(entity, "username", None) or username,
                    "title": getattr(entity, "title", username),
                    "access": True,
                    "type": "username",
                })
            except Exception as e:
                results.append({"query": username, "access": False, "error": str(e), "type": "username"})

        for link in args.invite:
            try:
                entity = await client.get_entity(link)
                results.append({
                    "query": link,
                    "username": getattr(entity, "username", None),
                    "title": getattr(entity, "title", ""),
                    "access": True,
                    "type": "invite",
                })
            except Exception as e:
                results.append({"query": link, "access": False, "error": str(e), "type": "invite"})

        if args.title:
            print("Loading dialogs...", file=sys.stderr)
            dialogs = await client.get_dialogs(limit=500)
            for keyword in args.title:
                kw_lower = keyword.lower()
                found = [
                    d for d in dialogs
                    if d.title and kw_lower in d.title.lower() and hasattr(d.entity, "broadcast")
                ]
                if found:
                    for d in found:
                        results.append({
                            "query": keyword,
                            "username": getattr(d.entity, "username", None),
                            "title": d.title,
                            "id": d.entity.id,
                            "access": True,
                            "type": "dialog",
                        })
                else:
                    results.append({"query": keyword, "access": False, "error": "not found in dialogs", "type": "dialog"})

    finally:
        await client.disconnect()

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
