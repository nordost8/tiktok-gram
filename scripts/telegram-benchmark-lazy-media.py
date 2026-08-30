#!/usr/bin/env python3
"""
Benchmark: ingest post metadata, then resolve media on demand (lazy).

Usage:
  python3 scripts/telegram-benchmark-lazy-media.py [channel] [limit]

Example:
  python3 scripts/telegram-benchmark-lazy-media.py babel 10
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from telethon.tl.types import (
    Document,
    DocumentAttributeVideo,
    MessageMediaDocument,
    MessageMediaPhoto,
    Photo,
    PhotoSize,
)

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
CACHE_DIR = ROOT / ".cache" / "benchmark"
POSTS_JSON = CACHE_DIR / "posts-meta.json"

# Simulate "first paint" — bytes to read before counting resolve done
FIRST_CHUNK_BYTES = 256 * 1024


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ[key.strip()] = value.strip().strip('"').strip("'")


def ms_since(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000, 1)


@dataclass
class MediaMeta:
    kind: str  # photo | video | other
    mime_type: str | None
    size_bytes: int | None
    width: int | None
    height: int | None
    duration: float | None
    document_id: int | None
    photo_id: int | None
    access_hash: int | None
    file_reference_b64: str | None
    dc_id: int | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "width": self.width,
            "height": self.height,
            "duration": self.duration,
            "document_id": self.document_id,
            "photo_id": self.photo_id,
            "access_hash": self.access_hash,
            "file_reference_b64": self.file_reference_b64,
            "dc_id": self.dc_id,
        }


def extract_media_meta(message: Any) -> MediaMeta | None:
    media = message.media
    if media is None:
        return None

    if isinstance(media, MessageMediaPhoto) and isinstance(media.photo, Photo):
        p = media.photo
        w = h = None
        for size in p.sizes or []:
            if isinstance(size, PhotoSize):
                w, h = size.w, size.h
        return MediaMeta(
            kind="photo",
            mime_type="image/jpeg",
            size_bytes=None,
            width=w,
            height=h,
            duration=None,
            document_id=None,
            photo_id=p.id,
            access_hash=p.access_hash,
            file_reference_b64=base64.b64encode(p.file_reference).decode()
            if p.file_reference
            else None,
            dc_id=p.dc_id,
        )

    if isinstance(media, MessageMediaDocument) and isinstance(media.document, Document):
        doc = media.document
        w = h = dur = None
        for attr in doc.attributes or []:
            if isinstance(attr, DocumentAttributeVideo):
                w, h, dur = attr.w, attr.h, attr.duration
        kind = "video" if (doc.mime_type or "").startswith("video/") else "other"
        return MediaMeta(
            kind=kind,
            mime_type=doc.mime_type,
            size_bytes=doc.size,
            width=w,
            height=h,
            duration=dur,
            document_id=doc.id,
            photo_id=None,
            access_hash=doc.access_hash,
            file_reference_b64=base64.b64encode(doc.file_reference).decode()
            if doc.file_reference
            else None,
            dc_id=doc.dc_id,
        )

    return None


def post_meta_row(channel: str, message: Any) -> dict[str, Any]:
    mm = extract_media_meta(message)
    return {
        "message_id": message.id,
        "channel": channel,
        "telegram_url": f"https://t.me/{channel}/{message.id}",
        "date": message.date.isoformat() if message.date else None,
        "text_len": len(message.message or message.text or ""),
        "has_media": mm is not None,
        "media": mm.to_dict() if mm else None,
    }


async def download_first_chunk(client: TelegramClient, message: Any, limit: int) -> int:
    """Download up to `limit` bytes (time-to-first-chunk proxy)."""
    total = 0
    async for chunk in client.iter_download(message, request_size=128 * 1024):
        total += len(chunk)
        if total >= limit:
            break
    return total


async def download_full(client: TelegramClient, message: Any) -> int:
    data = await client.download_media(message, file=bytes)
    return len(data) if data else 0


async def main() -> None:
    load_env(ENV_PATH)
    channel = sys.argv[1] if len(sys.argv) > 1 else "babel"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    api_id = int(os.environ["TELEGRAM_API_ID"])
    api_hash = os.environ["TELEGRAM_API_HASH"]

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    client = make_client(api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print("Not authorized. Run: pnpm telegram:channels", file=sys.stderr)
        sys.exit(1)

    entity = await client.get_entity(channel)

    # --- Phase 1: ingest metadata (simulate DB write) ---
    t_phase1 = time.perf_counter()
    rows: list[dict[str, Any]] = []
    messages_by_id: dict[int, Any] = {}

    async for message in client.iter_messages(entity, limit=limit):
        rows.append(post_meta_row(channel, message))
        messages_by_id[message.id] = message

    POSTS_JSON.write_text(
        json.dumps({"channel": channel, "posts": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    phase1_ms = ms_since(t_phase1)

    with_media = [r for r in rows if r["has_media"]]
    text_only = len(rows) - len(with_media)

    # --- Phase 2: lazy media resolve (simulate user opening feed) ---
    resolve_results: list[dict[str, Any]] = []

    for row in with_media:
        mid = row["message_id"]
        message = messages_by_id[mid]
        media = row["media"] or {}
        kind = media.get("kind", "?")

        t0 = time.perf_counter()
        try:
            first_bytes = await download_first_chunk(client, message, FIRST_CHUNK_BYTES)
            first_chunk_ms = ms_since(t0)
            first_chunk_error = None
        except Exception as exc:  # noqa: BLE001
            first_bytes = 0
            first_chunk_ms = ms_since(t0)
            first_chunk_error = f"{type(exc).__name__}: {exc}"

        t1 = time.perf_counter()
        try:
            full_bytes = await download_full(client, message)
            full_ms = ms_since(t1)
            full_error = None
        except Exception as exc:  # noqa: BLE001
            full_bytes = 0
            full_ms = ms_since(t1)
            full_error = f"{type(exc).__name__}: {exc}"

        resolve_results.append(
            {
                "message_id": mid,
                "kind": kind,
                "size_bytes": media.get("size_bytes"),
                "first_chunk_ms": first_chunk_ms,
                "first_chunk_bytes": first_bytes,
                "first_chunk_error": first_chunk_error,
                "full_download_ms": full_ms,
                "full_download_bytes": full_bytes,
                "full_download_error": full_error,
            }
        )

    await client.disconnect()

    # Summary stats
    if with_media:
        avg_first = round(
            sum(r["first_chunk_ms"] for r in resolve_results) / len(resolve_results),
            1,
        )
        avg_full = round(
            sum(r["full_download_ms"] for r in resolve_results) / len(resolve_results),
            1,
        )
        max_full = max(r["full_download_ms"] for r in resolve_results)
    else:
        avg_first = avg_full = max_full = 0

    report = {
        "ok": True,
        "channel": channel,
        "phase1_ingest": {
            "posts_fetched": len(rows),
            "with_media": len(with_media),
            "text_only": text_only,
            "total_ms": phase1_ms,
            "per_post_ms": round(phase1_ms / len(rows), 1) if rows else 0,
            "saved_to": str(POSTS_JSON.relative_to(ROOT)),
        },
        "phase2_lazy_resolve": {
            "media_posts": len(with_media),
            "first_chunk_target_bytes": FIRST_CHUNK_BYTES,
            "avg_first_chunk_ms": avg_first,
            "avg_full_download_ms": avg_full,
            "max_full_download_ms": max_full,
            "details": resolve_results,
        },
        "notes": [
            "phase1 = iter_messages + extract meta (like collector → DB)",
            "first_chunk_ms = time until ~256KB (proxy for video start / image usable)",
            "full_download_ms = entire file via userbot (worst case if no streaming proxy)",
        ],
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
