#!/usr/bin/env python3
"""Inspect last N channel posts: text + raw media fields (URLs vs file refs)."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from telethon.tl.types import (
    Document,
    DocumentAttributeFilename,
    DocumentAttributeVideo,
    MessageMediaDocument,
    MessageMediaPhoto,
    MessageMediaWebPage,
    Photo,
    PhotoSize,
)

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ[key.strip()] = value.strip().strip('"').strip("'")


def photo_sizes_summary(photo: Photo) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for size in photo.sizes or []:
        if not isinstance(size, PhotoSize):
            continue
        rows.append(
            {
                "type": type(size).__name__,
                "w": getattr(size, "w", None),
                "h": getattr(size, "h", None),
                "size": getattr(size, "size", None),
                "has_location": hasattr(size, "location") and size.location is not None,
            }
        )
    return rows


def document_summary(doc: Document) -> dict[str, Any]:
    video_attrs = [
        a
        for a in (doc.attributes or [])
        if isinstance(a, DocumentAttributeVideo)
    ]
    filenames = [
        a.file_name
        for a in (doc.attributes or [])
        if isinstance(a, DocumentAttributeFilename)
    ]
    return {
        "id": doc.id,
        "access_hash": doc.access_hash,
        "file_reference_hex": doc.file_reference.hex() if doc.file_reference else None,
        "dc_id": doc.dc_id,
        "mime_type": doc.mime_type,
        "size": doc.size,
        "file_name": filenames[0] if filenames else None,
        "video": [
            {"w": v.w, "h": v.h, "duration": v.duration}
            for v in video_attrs
        ],
        "thumbs_count": len(doc.thumbs or []),
    }


def media_summary(message: Any) -> dict[str, Any] | None:
    media = message.media
    if media is None:
        return None

    base: dict[str, Any] = {
        "media_type": type(media).__name__,
        "has_http_url_field": False,
        "http_urls_found": [],
    }

    # Scan common attributes for any string that looks like http(s)
    def scan_obj(obj: Any, depth: int = 0) -> None:
        if depth > 4 or obj is None:
            return
        if isinstance(obj, str) and (
            obj.startswith("http://") or obj.startswith("https://")
        ):
            base["has_http_url_field"] = True
            if obj not in base["http_urls_found"]:
                base["http_urls_found"].append(obj)
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                scan_obj(item, depth + 1)
        elif hasattr(obj, "__dict__"):
            for v in vars(obj).values():
                scan_obj(v, depth + 1)

    scan_obj(media)

    if isinstance(media, MessageMediaPhoto):
        photo = media.photo
        base["photo"] = {
            "id": photo.id if photo else None,
            "access_hash": photo.access_hash if photo else None,
            "file_reference_hex": photo.file_reference.hex()
            if photo and photo.file_reference
            else None,
            "dc_id": photo.dc_id if photo else None,
            "sizes": photo_sizes_summary(photo) if photo else [],
        }
    elif isinstance(media, MessageMediaDocument):
        doc = media.document
        base["document"] = document_summary(doc) if isinstance(doc, Document) else None
    elif isinstance(media, MessageMediaWebPage):
        wp = media.webpage
        base["webpage"] = {
            "url": getattr(wp, "url", None),
            "display_url": getattr(wp, "display_url", None),
            "type": getattr(wp, "type", None),
            "has_photo": getattr(wp, "photo", None) is not None,
            "has_document": getattr(wp, "document", None) is not None,
        }

    return base


async def main() -> None:
    load_env(ENV_PATH)
    channel = sys.argv[1] if len(sys.argv) > 1 else "babel"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    api_id = int(os.environ["TELEGRAM_API_ID"])
    api_hash = os.environ["TELEGRAM_API_HASH"]

    client = make_client(api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print("Not authorized. Run: pnpm telegram:channels", file=sys.stderr)
        sys.exit(1)

    entity = await client.get_entity(channel)
    messages_out: list[dict[str, Any]] = []

    async for message in client.iter_messages(entity, limit=limit):
        entry: dict[str, Any] = {
            "id": message.id,
            "date": message.date.isoformat() if message.date else None,
            "telegram_url": f"https://t.me/{channel}/{message.id}",
            "text_preview": (message.message or message.text or "")[:200] or None,
            "has_media": message.media is not None,
            "media": media_summary(message),
        }

        messages_out.append(entry)

    print(
        json.dumps(
            {
                "ok": True,
                "channel": {
                    "username": channel,
                    "title": getattr(entity, "title", None),
                    "id": entity.id,
                },
                "fetched": len(messages_out),
                "messages": messages_out,
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
