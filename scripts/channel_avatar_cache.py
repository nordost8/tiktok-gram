"""Download Telegram channel profile photos into MinIO."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any


from media_cache_job import (
    make_client,
    channel_avatar_object_key,
    load_env,
    require_env,
    s3_client,
    upload_file_to_storage,
)
from telegram_collector_lib import tiktok_gram_log


async def _cache_many(
    items: list[tuple[str, str]],
) -> list[dict[str, Any]]:
    if not items:
        return []

    load_env()
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")
    import os

    bucket = os.environ.get("S3_BUCKET", "tiktok-gram-media")
    results: list[dict[str, Any]] = []

    client = make_client(api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        await client.disconnect()
        raise RuntimeError("Telegram userbot not authorized")

    try:
        for channel_id, username in items:
            object_key = channel_avatar_object_key(channel_id)
            try:
                s3_client().head_object(Bucket=bucket, Key=object_key)
                results.append({"channelId": channel_id, "skipped": "already_cached"})
                continue
            except Exception:  # noqa: BLE001
                pass

            tiktok_gram_log(
                f"[avatar] DOWNLOAD channel={username} id={channel_id} key={object_key}",
                file_env="TIKTOK_GRAM_MEDIA_LOG",
            )
            with tempfile.TemporaryDirectory() as tmp:
                local_path = Path(tmp) / "avatar.jpg"
                try:
                    ident = username.lstrip("@")
                    identifier = int(ident) if ident.lstrip("-").isdigit() else ident
                    entity = await client.get_entity(identifier)
                    path = await client.download_profile_photo(
                        entity,
                        file=str(local_path),
                    )
                    if not path or not local_path.is_file() or local_path.stat().st_size == 0:
                        tiktok_gram_log(
                            f"[avatar] SKIP channel={username} reason=no_profile_photo",
                            file_env="TIKTOK_GRAM_MEDIA_LOG",
                        )
                        results.append(
                            {
                                "channelId": channel_id,
                                "ok": False,
                                "error": "no_profile_photo",
                            },
                        )
                        continue

                    upload_file_to_storage(local_path, object_key, "image/jpeg")
                    tiktok_gram_log(
                        f"[avatar] READY channel={username} key={object_key}",
                        file_env="TIKTOK_GRAM_MEDIA_LOG",
                    )
                    results.append(
                        {
                            "channelId": channel_id,
                            "ok": True,
                            "storageKey": object_key,
                            "objectKey": object_key,
                        },
                    )
                except Exception as exc:  # noqa: BLE001
                    tiktok_gram_log(
                        f"[avatar] ERROR channel={username} error={type(exc).__name__}: {exc}",
                        file_env="TIKTOK_GRAM_MEDIA_LOG",
                    )
                    results.append(
                        {"channelId": channel_id, "ok": False, "error": str(exc)},
                    )
    finally:
        await client.disconnect()

    return results


def cache_channel_avatar(conn, channel_id: str, username: str) -> dict[str, Any]:
    """Store one channel avatar in MinIO and set telegram_channels.avatar_url."""
    results = asyncio.run(_cache_many([(channel_id, username)]))
    result = results[0] if results else {"channelId": channel_id, "ok": False}

    if result.get("ok"):
        object_key = result["storageKey"]
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_channels
                SET avatar_url = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (object_key, channel_id),
            )

    return result


def cache_channel_avatars_batch(
    conn,
    items: list[tuple[str, str]],
) -> list[dict[str, Any]]:
    """Cache many avatars with a single Telethon session."""
    results = asyncio.run(_cache_many(items))

    with conn.cursor() as cur:
        for result in results:
            if not result.get("ok"):
                continue
            cur.execute(
                """
                UPDATE telegram_channels
                SET avatar_url = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (result["storageKey"], result["channelId"]),
            )

    return results
