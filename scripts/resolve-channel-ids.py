#!/usr/bin/env python3
"""Resolve Telegram channel IDs and usernames for a list of targets.

Usage:
  python scripts/resolve-channel-ids.py --target some_username --target https://t.me/+abc123
  python scripts/resolve-channel-ids.py --dialog-id 1615069994
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
    parser.add_argument("--target", action="append", default=[], help="Username or invite link (repeatable)")
    parser.add_argument("--dialog-id", action="append", default=[], type=int, help="Numeric dialog id to resolve from your own dialogs (repeatable)")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    load_env()
    client = make_client(int(require_env("TELEGRAM_API_ID")), require_env("TELEGRAM_API_HASH"))
    await client.connect()
    try:
        results = []

        for target in args.target:
            try:
                entity = await client.get_entity(target)
                results.append({
                    "query": target,
                    "id": entity.id,
                    "username": getattr(entity, "username", None),
                    "title": getattr(entity, "title", ""),
                    "tg_id": f"-100{entity.id}",
                })
            except Exception as e:
                results.append({"query": target, "error": str(e)})

        if args.dialog_id:
            # Resolve private channels by loading dialogs
            dialogs = await client.get_dialogs(limit=500)
            dialog_map = {d.entity.id: d for d in dialogs if hasattr(d.entity, "broadcast")}
            for ch_id in args.dialog_id:
                d = dialog_map.get(ch_id)
                if d:
                    results.append({
                        "query": ch_id,
                        "id": ch_id,
                        "username": getattr(d.entity, "username", None),
                        "title": d.title,
                        "tg_id": f"-100{ch_id}",
                    })
                else:
                    results.append({"query": ch_id, "error": "not in dialogs"})

    finally:
        await client.disconnect()

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
