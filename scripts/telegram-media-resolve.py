#!/usr/bin/env python3
"""Refresh Telegram refs (and optional CDN URL) for a media row."""

from __future__ import annotations

import asyncio
import base64
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from telethon.tl.types import Document, MessageMediaDocument, MessageMediaPhoto, Photo

ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT / "scripts"))
from telegram_collector_lib import load_env, require_env  # noqa: E402


def _b64(raw: bytes | None) -> str | None:
    if not raw:
        return None
    return base64.b64encode(raw).decode("ascii")


async def resolve(payload: dict[str, Any]) -> dict[str, Any]:
    load_env()
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")

    username = payload["channelUsername"]
    message_id = int(payload["telegramMessageId"])

    client = make_client(api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("Telegram userbot not authorized")

    entity = await client.get_entity(username)
    message = await client.get_messages(entity, ids=message_id)
    if message is None or message.media is None:
        raise ValueError("message has no media")

    refs: dict[str, Any] = {}
    download_url: str | None = None

    if isinstance(message.media, MessageMediaPhoto) and isinstance(
        message.media.photo, Photo
    ):
        photo = message.media.photo
        refs = {
            "telegramPhotoId": str(photo.id),
            "telegramDocumentId": None,
            "telegramAccessHash": str(photo.access_hash),
            "telegramFileReference": _b64(photo.file_reference),
            "telegramDcId": photo.dc_id,
            "mimeType": "image/jpeg",
        }
    elif isinstance(message.media, MessageMediaDocument) and isinstance(
        message.media.document, Document
    ):
        doc = message.media.document
        refs = {
            "telegramPhotoId": None,
            "telegramDocumentId": str(doc.id),
            "telegramAccessHash": str(doc.access_hash),
            "telegramFileReference": _b64(doc.file_reference),
            "telegramDcId": doc.dc_id,
            "mimeType": doc.mime_type,
        }

    await client.disconnect()

    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=50)).isoformat()

    return {
        "ok": True,
        "refs": refs,
        "downloadUrl": download_url,
        "resolvedUrlExpiresAt": expires_at,
    }


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        result = asyncio.run(resolve(payload))
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001
        print(
            json.dumps(
                {"ok": False, "error": str(exc), "type": type(exc).__name__},
                ensure_ascii=False,
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
