#!/usr/bin/env python3
"""Run media cache cleanup once (cron / manual)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from media_cache_cleanup import run_media_cache_cleanup  # noqa: E402
from telegram_collector_lib import load_env  # noqa: E402


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Evict cached media over budget")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be evicted without deleting",
    )
    args = parser.parse_args()
    result = run_media_cache_cleanup(dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
