#!/usr/bin/env python3
"""Cache a single channel avatar: python3 scripts/cache-channel-avatar-one.py <channel_id> <username>"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from channel_avatar_cache import cache_channel_avatar  # noqa: E402


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
    if len(sys.argv) != 3:
        raise SystemExit("usage: cache-channel-avatar-one.py <channel_id> <username>")

    load_env()
    channel_id, username = sys.argv[1], sys.argv[2].lstrip("@")
    url = os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("POSTGRES_URL missing")

    conn = psycopg2.connect(url)
    try:
        result = cache_channel_avatar(conn, channel_id, username)
        conn.commit()
        print(json.dumps(result, ensure_ascii=False))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
