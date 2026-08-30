"""Postgres bytea storage for photo media + 5000 photo-post cap."""

from __future__ import annotations

import os
from typing import Any

from psycopg2.extensions import cursor as Cursor

from telegram_collector_lib import tiktok_gram_log

DEFAULT_PHOTO_POST_LIMIT = 5000
_LOG_ENV = "TIKTOK_GRAM_MEDIA_LOG"


def photo_post_limit() -> int:
    raw = os.environ.get("PHOTO_POST_LIMIT", "").strip()
    if raw.isdigit():
        return int(raw)
    return DEFAULT_PHOTO_POST_LIMIT


def _photo_only_post_sql(alias: str = "d") -> str:
    """SQL fragment: {alias} is a photo-only description (photos, no video/animation)."""
    return f"""
      EXISTS (
        SELECT 1 FROM telegram_post_media m
        WHERE m.desc_id = {alias}.id AND m.type = 'photo'
      )
      AND NOT EXISTS (
        SELECT 1 FROM telegram_post_media m
        WHERE m.desc_id = {alias}.id AND m.type IN ('video', 'animation')
      )
    """


def count_cached_photo_posts(cur: Cursor) -> int:
    cur.execute(
        f"""
        SELECT COUNT(*)::int AS n
        FROM telegram_post_descriptions d
        WHERE {_photo_only_post_sql("d")}
          AND EXISTS (
            SELECT 1 FROM telegram_post_media m
            WHERE m.desc_id = d.id
              AND m.type = 'photo'
              AND m.cache_status = 'ready'
              AND m.storage_backend = 'postgres'
              AND m.cached_data IS NOT NULL
          )
        """,
    )
    row = cur.fetchone()
    return int(row[0] if row else 0)


def desc_is_photo_only(cur: Cursor, desc_id: str) -> bool:
    cur.execute(
        f"""
        SELECT EXISTS (
          SELECT 1 FROM telegram_post_descriptions d
          WHERE d.id = %s AND {_photo_only_post_sql("d")}
        )
        """,
        (desc_id,),
    )
    row = cur.fetchone()
    return bool(row[0] if row else False)


def desc_already_cached(cur: Cursor, desc_id: str) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1 FROM telegram_post_media m
          WHERE m.desc_id = %s
            AND m.type = 'photo'
            AND m.cache_status = 'ready'
            AND m.storage_backend = 'postgres'
            AND m.cached_data IS NOT NULL
        )
        """,
        (desc_id,),
    )
    row = cur.fetchone()
    return bool(row[0] if row else False)


def evict_oldest_photo_posts(cur: Cursor, count: int, *, exclude_desc_id: str | None) -> list[str]:
    """Delete oldest cached photo-only posts to free slots. Returns evicted desc ids."""
    if count <= 0:
        return []
    params: list[Any] = []
    exclude_sql = ""
    if exclude_desc_id:
        exclude_sql = "AND d.id <> %s"
        params.append(exclude_desc_id)
    params.append(count)
    cur.execute(
        f"""
        SELECT d.id
        FROM telegram_post_descriptions d
        WHERE {_photo_only_post_sql("d")}
          AND EXISTS (
            SELECT 1 FROM telegram_post_media m
            WHERE m.desc_id = d.id
              AND m.type = 'photo'
              AND m.cache_status = 'ready'
              AND m.storage_backend = 'postgres'
              AND m.cached_data IS NOT NULL
          )
          {exclude_sql}
        ORDER BY d.published_at ASC
        LIMIT %s
        """,
        params,
    )
    ids = [str(row[0]) for row in cur.fetchall()]
    for desc_id in ids:
        cur.execute("DELETE FROM telegram_post_descriptions WHERE id = %s", (desc_id,))
    return ids


def enforce_photo_post_limit(cur: Cursor, desc_id: str) -> list[str]:
    """Ensure a new photo-only post fits within PHOTO_POST_LIMIT."""
    if not desc_is_photo_only(cur, desc_id):
        return []
    if desc_already_cached(cur, desc_id):
        return []

    limit = photo_post_limit()
    current = count_cached_photo_posts(cur)
    if current < limit:
        return []

    need = current - limit + 1
    evicted = evict_oldest_photo_posts(cur, need, exclude_desc_id=desc_id)
    if evicted:
        tiktok_gram_log(
            f"[photo-pg] evicted {len(evicted)} oldest photo-posts"
            f" (limit={limit}, had={current}) ids={evicted[:5]}{'...' if len(evicted) > 5 else ''}",
            file_env=_LOG_ENV,
        )
    return evicted
