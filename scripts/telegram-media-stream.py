#!/usr/bin/env python3
"""Stream Telegram media bytes to stdout (JSON config on stdin)."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT / "scripts"))
from telegram_collector_lib import load_env, require_env, stream_message_media  # noqa: E402


def eprint(obj: dict[str, Any]) -> None:
    print(json.dumps(obj, ensure_ascii=False), file=sys.stderr)


async def resolve_message(client: TelegramClient, payload: dict[str, Any]) -> Any:
    username = payload.get("channelUsername")
    message_id = payload.get("telegramMessageId")
    if not username or not message_id:
        raise ValueError("channelUsername and telegramMessageId are required")

    entity = await client.get_entity(username)
    message = await client.get_messages(entity, ids=int(message_id))
    if message is None or message.media is None:
        raise ValueError("message has no media")
    return message


async def stream_bytes(payload: dict[str, Any]) -> None:
    load_env()
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")

    offset = int(payload.get("rangeStart") or 0)
    limit = payload.get("rangeEnd")
    limit_count = None if limit is None else int(limit) - offset + 1

    client = make_client(api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("Telegram userbot not authorized")

    message = await resolve_message(client, payload)
    await stream_message_media(
        client,
        message,
        sys.stdout.buffer,
        offset=offset,
        limit_count=limit_count,
    )

    await client.disconnect()


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        asyncio.run(stream_bytes(payload))
    except Exception as exc:  # noqa: BLE001
        eprint({"ok": False, "error": str(exc), "type": type(exc).__name__})
        sys.exit(1)


if __name__ == "__main__":
    main()
