#!/usr/bin/env python3
"""Backfill Telegram channel avatars into MinIO for all active channels."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from channel_avatar_cache import cache_channel_avatars_batch  # noqa: E402


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    load_env()
    url = os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("POSTGRES_URL missing")

    conn = psycopg2.connect(url)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, username
                FROM telegram_channels
                WHERE status = 'active' AND username IS NOT NULL
                ORDER BY username
                """,
            )
            channels = cur.fetchall()

        items = [(str(ch["id"]), str(ch["username"])) for ch in channels]
        results = cache_channel_avatars_batch(conn, items)
        conn.commit()

        for result in results:
            print(json.dumps(result, ensure_ascii=False), flush=True)

        ok = sum(1 for r in results if r.get("ok") or r.get("skipped"))
        print(json.dumps({"total": len(results), "cachedOrSkipped": ok}, ensure_ascii=False))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
