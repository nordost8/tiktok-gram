#!/usr/bin/env python3
"""One-off userbot test: sign in and list channel dialogs."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from telethon.tl.types import Channel, Chat

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_collector_lib import make_client

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"


def load_env(path: Path) -> None:
    if not path.is_file():
        print(f"Missing {path}", file=sys.stderr)
        sys.exit(1)
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        os.environ[key.strip()] = value


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"Missing {name} in .env", file=sys.stderr)
        sys.exit(1)
    return value


async def main() -> None:
    load_env(ENV_PATH)
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")
    phone = require_env("TELEGRAM_PHONE")
    login_code = os.environ.get("TELEGRAM_LOGIN_CODE", "").strip()

    client = make_client(api_id, api_hash)

    def code_callback() -> str:
        if not login_code:
            print(
                "TELEGRAM_LOGIN_CODE is empty. Add the SMS/Telegram code to .env and rerun.",
                file=sys.stderr,
            )
            sys.exit(1)
        return login_code

    password = os.environ.get("TELEGRAM_2FA_PASSWORD", "").strip() or None

    try:
        await client.start(
            phone=phone,
            code_callback=code_callback,
            password=password,
        )
    except Exception as exc:  # noqa: BLE001
        exc_name = type(exc).__name__
        if exc_name == "PhoneCodeInvalidError":
            print(
                "Invalid or expired TELEGRAM_LOGIN_CODE. "
                "Check Telegram/SMS for a new code, update .env, rerun.",
                file=sys.stderr,
            )
            sys.exit(1)
        if exc_name == "SessionPasswordNeededError":
            print(
                "2FA enabled: add TELEGRAM_2FA_PASSWORD to .env and rerun.",
                file=sys.stderr,
            )
            sys.exit(1)
        raise

    me = await client.get_me()
    print(
        json.dumps(
            {
                "ok": True,
                "user": {
                    "id": me.id,
                    "username": me.username,
                    "first_name": me.first_name,
                },
            },
            ensure_ascii=False,
        )
    )

    channels: list[dict] = []
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if not isinstance(entity, Channel):
            continue
        channels.append(
            {
                "id": entity.id,
                "title": entity.title,
                "username": entity.username,
                "megagroup": bool(entity.megagroup),
                "broadcast": bool(entity.broadcast),
                "participants_count": getattr(entity, "participants_count", None),
                "unread_count": dialog.unread_count,
            }
        )

    channels.sort(key=lambda c: (c["title"] or "").lower())

    print(
        json.dumps(
            {"ok": True, "channel_count": len(channels), "channels": channels},
            ensure_ascii=False,
            indent=2,
        )
    )

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
