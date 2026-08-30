#!/usr/bin/env python3
"""Persistent Telethon media server — avoids ~60s connect per /api/media request."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT / "scripts"))
from telegram_collector_lib import load_env, require_env, stream_message_media  # noqa: E402

client: TelegramClient | None = None
STREAM_SEM = asyncio.Semaphore(2)


async def resolve_message(payload: dict[str, Any]) -> Any:
    assert client is not None
    username = payload.get("channelUsername")
    message_id = payload.get("telegramMessageId")
    if not username or not message_id:
        raise ValueError("channelUsername and telegramMessageId are required")
    entity = await client.get_entity(username)
    message = await client.get_messages(entity, ids=int(message_id))
    if message is None or message.media is None:
        raise ValueError("message has no media")
    return message


async def stream_media(payload: dict[str, Any], writer: asyncio.StreamWriter) -> None:
    message = await resolve_message(payload)
    offset = int(payload.get("rangeStart") or 0)
    limit = payload.get("rangeEnd")
    limit_count = None if limit is None else int(limit) - offset + 1

    async with STREAM_SEM:
        await stream_message_media(
            client,  # type: ignore[arg-type]
            message,
            writer,
            offset=offset,
            limit_count=limit_count,
        )


async def handle_client(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter
) -> None:
    try:
        request_line = (await reader.readline()).decode("utf-8", "replace").strip()
        if not request_line:
            return

        parts = request_line.split()
        method = parts[0] if parts else "GET"
        path = parts[1] if len(parts) > 1 else "/"

        headers: dict[str, str] = {}
        while True:
            line = (await reader.readline()).decode("utf-8", "replace").strip()
            if not line:
                break
            if ":" in line:
                key, _, value = line.partition(":")
                headers[key.strip().lower()] = value.strip()

        body = b""
        if method == "POST":
            length = int(headers.get("content-length", "0"))
            if length > 0:
                body = await reader.readexactly(length)

        if path == "/health" and method == "GET":
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
            await writer.drain()
            return

        if path != "/stream" or method != "POST":
            writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
            return

        payload = json.loads(body.decode("utf-8"))
        mime = payload.get("mimeType") or "application/octet-stream"
        size_bytes = payload.get("sizeBytes")
        range_start = int(payload.get("rangeStart") or 0)
        range_end = payload.get("rangeEnd")

        status = "200 OK"
        extra_headers = "Accept-Ranges: bytes\r\nCache-Control: private, max-age=300\r\n"

        if range_end is not None:
            end = int(range_end)
            status = "206 Partial Content"
            total = str(size_bytes) if size_bytes is not None else "*"
            content_len = end - range_start + 1
            extra_headers += (
                f"Content-Range: bytes {range_start}-{end}/{total}\r\n"
                f"Content-Length: {content_len}\r\n"
            )
        elif size_bytes is not None:
            extra_headers += f"Content-Length: {size_bytes}\r\n"

        writer.write(
            f"HTTP/1.1 {status}\r\nContent-Type: {mime}\r\n{extra_headers}\r\n".encode()
        )
        await writer.drain()
        await stream_media(payload, writer)
    except Exception as exc:  # noqa: BLE001
        msg = json.dumps({"error": str(exc), "type": type(exc).__name__})
        body = msg.encode("utf-8")
        writer.write(
            b"HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\n"
            + f"Content-Length: {len(body)}\r\n\r\n".encode()
            + body
        )
        await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()


async def run_server(host: str, port: int) -> None:
    global client
    load_env()
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")

    client = make_client(api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("Telegram userbot not authorized")

    server = await asyncio.start_server(handle_client, host, port)
    print(json.dumps({"ok": True, "host": host, "port": port}), flush=True)
    async with server:
        await server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9393)
    args = parser.parse_args()
    asyncio.run(run_server(args.host, args.port))


if __name__ == "__main__":
    main()
