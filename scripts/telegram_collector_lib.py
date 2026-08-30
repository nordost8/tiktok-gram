"""Shared Telegram media extraction for collector scripts."""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from telethon.tl.types import (
    Document,
    DocumentAttributeAnimated,
    DocumentAttributeVideo,
    MessageMediaDocument,
    MessageMediaPhoto,
    Photo,
    PhotoSize,
    PhotoSizeProgressive,
)

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"

MediaType = Literal["photo", "video", "animation"]


def load_env(path: Path = ENV_PATH) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ[key.strip()] = value.strip().strip('"').strip("'")


def tiktok_gram_log(msg: str, *, file_env: str = "TIKTOK_GRAM_LOG") -> None:
    """Timestamped log to stdout + optional persistent file (path from env var)."""
    line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}"
    print(line, flush=True)
    path = os.environ.get(file_env, "").strip()
    if path:
        try:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing {name} in .env")
    return value


def make_client(api_id: int, api_hash: str):
    """Return a TelegramClient backed by PostgreSQL session."""
    from telethon import TelegramClient
    from telegram_session_pg import PostgresSession
    pg_url = require_env("POSTGRES_URL")
    return TelegramClient(PostgresSession(pg_url), api_id, api_hash)


@dataclass
class CollectorMediaItem:
    type: MediaType
    telegram_document_id: str | None = None
    telegram_photo_id: str | None = None
    telegram_access_hash: str | None = None
    telegram_file_reference: str | None = None
    telegram_dc_id: int | None = None
    mime_type: str | None = None
    width: int | None = None
    height: int | None = None
    duration: int | None = None
    size_bytes: int | None = None
    sort_order: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "telegramDocumentId": self.telegram_document_id,
            "telegramPhotoId": self.telegram_photo_id,
            "telegramAccessHash": self.telegram_access_hash,
            "telegramFileReference": self.telegram_file_reference,
            "telegramDcId": self.telegram_dc_id,
            "mimeType": self.mime_type,
            "width": self.width,
            "height": self.height,
            "duration": self.duration,
            "sizeBytes": self.size_bytes,
            "sortOrder": self.sort_order,
        }


def _b64_ref(raw: bytes | None) -> str | None:
    if not raw:
        return None
    return base64.b64encode(raw).decode("ascii")


def _int_str(value: int | None) -> str | None:
    if value is None:
        return None
    return str(value)


def extract_feed_media(message: Any) -> list[CollectorMediaItem]:
    media = message.media
    if media is None:
        return []

    if isinstance(media, MessageMediaPhoto) and isinstance(media.photo, Photo):
        photo = media.photo
        width = height = None
        best_area = -1
        for size in photo.sizes or []:
            if isinstance(size, (PhotoSize, PhotoSizeProgressive)):
                area = size.w * size.h
                if area > best_area:
                    best_area = area
                    width, height = size.w, size.h
        return [
            CollectorMediaItem(
                type="photo",
                telegram_photo_id=_int_str(photo.id),
                telegram_access_hash=_int_str(photo.access_hash),
                telegram_file_reference=_b64_ref(photo.file_reference),
                telegram_dc_id=photo.dc_id,
                mime_type="image/jpeg",
                width=width,
                height=height,
            )
        ]

    if isinstance(media, MessageMediaDocument) and isinstance(media.document, Document):
        doc = media.document
        mime = doc.mime_type or ""
        width = height = duration = None
        is_animated = False
        for attr in doc.attributes or []:
            if isinstance(attr, DocumentAttributeVideo):
                width, height = attr.w, attr.h
                duration = int(attr.duration) if attr.duration is not None else None
            if isinstance(attr, DocumentAttributeAnimated):
                is_animated = True

        if is_animated or mime == "image/gif":
            media_type: MediaType = "animation"
        elif mime.startswith("video/"):
            media_type = "video"
        else:
            return []

        return [
            CollectorMediaItem(
                type=media_type,
                telegram_document_id=_int_str(doc.id),
                telegram_access_hash=_int_str(doc.access_hash),
                telegram_file_reference=_b64_ref(doc.file_reference),
                telegram_dc_id=doc.dc_id,
                mime_type=mime or None,
                width=width,
                height=height,
                duration=duration,
                size_bytes=doc.size,
            )
        ]

    return []


async def stream_message_media(
    client: Any,
    message: Any,
    writer: Any,
    *,
    offset: int = 0,
    limit_count: int | None = None,
    request_size: int = 256 * 1024,
) -> int:
    """Write Telegram media bytes to writer; never exceeds limit_count (fixes Range 206 length)."""
    downloaded = 0
    async for chunk in client.iter_download(
        message.media,
        offset=offset,
        limit=limit_count,
        request_size=request_size,
    ):
        if limit_count is not None:
            remaining = limit_count - downloaded
            if remaining <= 0:
                break
            if len(chunk) > remaining:
                chunk = chunk[:remaining]
        writer.write(chunk)
        downloaded += len(chunk)
        if limit_count is not None and downloaded >= limit_count:
            break
    if hasattr(writer, "drain"):
        await writer.drain()
    return downloaded


def message_to_ingest_row(channel_username: str, message: Any) -> dict[str, Any]:
    text = message.message or message.text or ""
    media = extract_feed_media(message)
    return {
        "telegramMessageId": str(message.id),
        "groupedId": str(message.grouped_id) if getattr(message, "grouped_id", None) else None,
        "telegramUrl": (
            f"https://t.me/c/{channel_username.lstrip('-')[3:]}/{message.id}"
            if channel_username.lstrip("-").isdigit()
            else f"https://t.me/{channel_username}/{message.id}"
        ),
        "text": text or None,
        "caption": text or None,
        "publishedAt": message.date.isoformat() if message.date else None,
        "media": [m.to_dict() for m in media],
    }
