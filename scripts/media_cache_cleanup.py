"""Evict oldest cached media when total cached size exceeds budget."""

from __future__ import annotations

import os
from typing import Any

from botocore.exceptions import ClientError
from psycopg2.extras import RealDictCursor

from media_cache_job import (
    MEDIA_CACHE_BUCKET,
    db_connect,
    s3_client,
    update_media_cache_status,
)
from telegram_collector_lib import load_env, tiktok_gram_log

# 9.8 GB in decimal bytes (Cloudflare R2 measures in decimal, free tier = 10 GB).
# Staying under 9.8 GB guarantees no charges even with measurement rounding.
DEFAULT_BUDGET_BYTES = 9_800_000_000
# Keep a modest window of recent feed posts safe from eviction (~2–4 GB if videos).
DEFAULT_PROTECT_POSTS = 40


def cache_budget_bytes() -> int:
    raw = os.environ.get("MEDIA_CACHE_BUDGET_BYTES", "").strip()
    if raw.isdigit():
        return int(raw)
    return DEFAULT_BUDGET_BYTES


def protect_post_count() -> int:
    raw = os.environ.get("MEDIA_CACHE_PROTECT_POSTS", "").strip()
    if raw.isdigit():
        return int(raw)
    return DEFAULT_PROTECT_POSTS


def protect_per_channel_count() -> int:
    raw = os.environ.get("MEDIA_CACHE_PROTECT_PER_CHANNEL", "").strip()
    if raw.isdigit():
        return int(raw)
    return 5


def get_cached_total_bytes(
    cur,
    *,
    channel_username: str | None = None,
) -> int:
    if channel_username:
        cur.execute(
            """
            SELECT COALESCE(SUM(m.cached_size_bytes), 0)::bigint AS total
            FROM telegram_post_media m
            INNER JOIN telegram_post_descriptions d ON d.id = m.desc_id
            INNER JOIN telegram_channels c ON c.id = d.channel_id
            WHERE m.cache_status = 'ready'
              AND m.cached_size_bytes IS NOT NULL
              AND COALESCE(m.storage_backend, 'r2') = 'r2'
              AND c.username = %s
            """,
            (channel_username,),
        )
    else:
        cur.execute(
            """
            SELECT COALESCE(SUM(cached_size_bytes), 0)::bigint AS total
            FROM telegram_post_media
            WHERE cache_status = 'ready'
              AND cached_size_bytes IS NOT NULL
              AND COALESCE(storage_backend, 'r2') = 'r2'
            """,
        )
    row = cur.fetchone()
    return int(row["total"] if row else 0)


def list_eviction_candidates_v2(cur) -> list[dict[str, Any]]:
    """
    Eviction candidates ordered oldest-first, excluding the last
    MEDIA_CACHE_PROTECT_PER_CHANNEL descriptions of every active channel.
    """
    protect = protect_per_channel_count()
    cur.execute(
        """
        WITH protected_descs AS (
          SELECT d.id
          FROM (
            SELECT
              d.id,
              d.channel_id,
              ROW_NUMBER() OVER (
                PARTITION BY d.channel_id
                ORDER BY d.published_at DESC
              ) AS rn
            FROM telegram_post_descriptions d
          ) d
          JOIN telegram_channels c ON c.id = d.channel_id
          WHERE c.status = 'active'
            AND d.rn <= %s
        )
        SELECT
          m.id,
          m.storage_key,
          m.cached_size_bytes,
          d.published_at
        FROM telegram_post_media m
        JOIN telegram_post_descriptions d ON d.id = m.desc_id
        JOIN telegram_channels c ON c.id = d.channel_id
        WHERE m.cache_status = 'ready'
          AND m.storage_key IS NOT NULL
          AND COALESCE(m.storage_backend, 'r2') = 'r2'
          AND m.cached_size_bytes IS NOT NULL
          AND m.desc_id NOT IN (SELECT id FROM protected_descs)
        ORDER BY d.published_at ASC
        """,
        (protect,),
    )
    return [dict(row) for row in cur.fetchall()]


def delete_storage_object(storage_key: str) -> None:
    bucket = os.environ.get("S3_BUCKET", MEDIA_CACHE_BUCKET)
    client = s3_client()
    try:
        client.delete_object(Bucket=bucket, Key=storage_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code not in ("NoSuchKey", "404"):
            raise


def evict_media(media_id: str, storage_key: str, *, dry_run: bool) -> int:
    with db_connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT cached_size_bytes
                FROM telegram_post_media
                WHERE id = %s AND cache_status = 'ready'
                """,
                (media_id,),
            )
            row = cur.fetchone()
            if not row:
                return 0
            freed = int(row["cached_size_bytes"] or 0)

    if dry_run:
        return freed

    delete_storage_object(storage_key)
    update_media_cache_status(
        media_id,
        cache_status="needs_cache",
        clear_storage=True,
    )
    return freed


def run_media_cache_cleanup(
    *,
    dry_run: bool = False,
    channel_username: str | None = None,
) -> dict[str, Any]:
    load_env()
    budget = cache_budget_bytes()
    dry_tag = " [DRY-RUN]" if dry_run else ""

    with db_connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            total_before = get_cached_total_bytes(
                cur,
                channel_username=channel_username,
            )
            tiktok_gram_log(
                f"[cleanup]{dry_tag} START total={total_before/1e6:.1f}MB budget={budget/1e6:.0f}MB"
                + (f" channel=@{channel_username}" if channel_username else ""),
                file_env="TIKTOK_GRAM_MEDIA_LOG",
            )
            if total_before <= budget:
                tiktok_gram_log(
                    f"[cleanup]{dry_tag} OK under budget, nothing to evict",
                    file_env="TIKTOK_GRAM_MEDIA_LOG",
                )
                return {
                    "ok": True,
                    "dryRun": dry_run,
                    "budgetBytes": budget,
                    "totalBefore": total_before,
                    "totalAfter": total_before,
                    "evictedCount": 0,
                    "freedBytes": 0,
                    "channelUsername": channel_username,
                }

            candidates = list_eviction_candidates_v2(cur)

    over_by = total_before - budget
    tiktok_gram_log(
        f"[cleanup]{dry_tag} OVER BUDGET by {over_by/1e6:.1f}MB, candidates={len(candidates)}",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )

    evicted: list[str] = []
    freed_total = 0
    total_after = total_before

    if not candidates:
        protect = protect_per_channel_count()
        tiktok_gram_log(
            f"[cleanup]{dry_tag} WARNING: no eviction candidates — all media is inside"
            f" the per-channel protection window (MEDIA_CACHE_PROTECT_PER_CHANNEL={protect})."
            f" Storage stays over budget. Fix: reduce MEDIA_CACHE_PROTECT_PER_CHANNEL or remove inactive channels.",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )

    for candidate in candidates:
        if total_after <= budget:
            break
        media_id = str(candidate["id"])
        storage_key = str(candidate["storage_key"])
        freed = evict_media(media_id, storage_key, dry_run=dry_run)
        if freed <= 0:
            continue
        evicted.append(media_id)
        freed_total += freed
        total_after -= freed
        tiktok_gram_log(
            f"[cleanup]{dry_tag} EVICT media={media_id} freed={freed/1e6:.2f}MB"
            f" running_total={total_after/1e6:.1f}MB",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )

    if total_after > budget and candidates:
        tiktok_gram_log(
            f"[cleanup]{dry_tag} WARNING: evicted {len(evicted)} items but still over budget"
            f" ({total_after/1e6:.1f}MB / {budget/1e6:.0f}MB). Some candidates had NULL cached_size_bytes.",
            file_env="TIKTOK_GRAM_MEDIA_LOG",
        )

    tiktok_gram_log(
        f"[cleanup]{dry_tag} DONE evicted={len(evicted)} freed={freed_total/1e6:.2f}MB"
        f" total_after={total_after/1e6:.1f}MB",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )

    return {
        "ok": True,
        "dryRun": dry_run,
        "budgetBytes": budget,
        "totalBefore": total_before,
        "totalAfter": total_after,
        "evictedCount": len(evicted),
        "freedBytes": freed_total,
        "evictedMediaIds": evicted,
        "channelUsername": channel_username,
    }
