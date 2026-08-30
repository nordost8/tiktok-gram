#!/usr/bin/env python3
"""Enqueue one or more media rows for cache download."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from media_queue_lib import enqueue_media_cache  # noqa: E402
from telegram_collector_lib import load_env  # noqa: E402


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Enqueue media cache RQ jobs")
    parser.add_argument("media_ids", nargs="+", help="telegram_post_media UUIDs")
    args = parser.parse_args()

    results = [enqueue_media_cache(media_id) for media_id in args.media_ids]
    print(json.dumps({"ok": True, "results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
