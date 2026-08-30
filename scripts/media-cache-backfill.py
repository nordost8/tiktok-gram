#!/usr/bin/env python3
"""Enqueue cache jobs for ready posts with needs_cache primary media."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from media_queue_lib import enqueue_media_cache  # noqa: E402
from telegram_collector_lib import load_env, require_env  # noqa: E402


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Backfill media cache queue")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--channel", type=str, default=None)
    args = parser.parse_args()

    url = require_env("POSTGRES_URL").strip('"')
    parsed = urlparse(url)
    conn = psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        user=parsed.username,
        password=parsed.password,
        dbname=parsed.path.lstrip("/"),
    )

    sql = """
        SELECT m.id
        FROM telegram_post_media m
        INNER JOIN telegram_post_descriptions d ON d.id = m.desc_id
        INNER JOIN telegram_channels c ON c.id = d.channel_id
        WHERE m.cache_status IN ('needs_cache', 'failed')
          AND m.telegram_access_hash IS NOT NULL
    """
    params: list = []
    if args.channel:
        sql += " AND c.username = %s"
        params.append(args.channel.replace("@", "").lower())
    sql += " ORDER BY d.published_at DESC LIMIT %s"
    params.append(args.limit)

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    conn.close()

    results = []
    enqueued = 0
    for row in rows:
        media_id = str(row["id"])
        result = enqueue_media_cache(media_id)
        results.append(result)
        if result.get("enqueued"):
            enqueued += 1

    print(
        json.dumps(
            {
                "ok": True,
                "candidates": len(rows),
                "enqueued": enqueued,
                "results": results,
            },
            ensure_ascii=False,
        ),
    )


if __name__ == "__main__":
    main()
