#!/usr/bin/env python3
"""Retrospective smoke test: every cached photo/video should be reachable via /api/media.

Usage:
  python3 scripts/verify-all-media-urls.py --base-url https://your-domain.example.com
  python3 scripts/verify-all-media-urls.py --base-url https://your-domain.example.com --ssh user@your-host

Exit code 0 when all pass; prints failed ids + HTTP status otherwise.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Iterable

BROWSER_UA = "Mozilla/5.0 (compatible; TiktokGramMediaVerify/1.0)"


@dataclass(frozen=True)
class MediaRow:
    media_id: str
    media_type: str


SQL = (
    "SELECT m.id::text, m.type::text "
    "FROM telegram_post_media m "
    "INNER JOIN telegram_post_descriptions d ON d.id = m.desc_id "
    "WHERE m.cache_status = 'ready' AND d.status = 'ready' AND ("
    "(m.type = 'photo') OR "
    "(m.type IN ('video', 'animation') AND m.storage_key IS NOT NULL "
    "AND m.cache_range_ready IS TRUE)"
    ") ORDER BY d.published_at DESC"
)


def fetch_rows_via_ssh(ssh_target: str, sshpass: str | None = None) -> list[MediaRow]:
    use_sshpass = sshpass or os.environ.get("SSHPASS")
    prefix = ["sshpass", "-e", "ssh"] if use_sshpass else ["ssh"]
    pg_container = os.environ.get("STRESS_PG_CONTAINER", "tiktok-gram-postgres")
    remote = (
        f"docker exec {pg_container} psql -U tiktok_gram_app -d tiktok_gram "
        f"-t -A -F $'\\t' -c {json.dumps(SQL)}"
    )
    cmd = [
        *prefix,
        "-o",
        "StrictHostKeyChecking=no",
        ssh_target,
        remote,
    ]
    env = os.environ.copy()
    if use_sshpass and "SSHPASS" not in env:
        env["SSHPASS"] = use_sshpass
    out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT, env=env)
    rows: list[MediaRow] = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        media_id, media_type = line.split("\t", 1)
        rows.append(MediaRow(media_id=media_id, media_type=media_type))
    return rows


def fetch_rows_via_psycopg2() -> list[MediaRow]:
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / "scripts"))
    from telegram_collector_lib import load_env, require_env  # noqa: E402

    import psycopg2
    from urllib.parse import urlparse

    load_env()
    url = require_env("POSTGRES_URL").strip('"')
    parsed = urlparse(url)
    conn = psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        user=parsed.username,
        password=parsed.password,
        dbname=parsed.path.lstrip("/"),
    )
    try:
        with conn.cursor() as cur:
            cur.execute(SQL)
            return [MediaRow(media_id=r[0], media_type=r[1]) for r in cur.fetchall()]
    finally:
        conn.close()


def probe_url(base_url: str, media_id: str, media_type: str) -> tuple[bool, str]:
    url = f"{base_url.rstrip('/')}/api/media/{media_id}"
    headers = {
        "User-Agent": BROWSER_UA,
        "Accept": "*/*",
    }
    if media_type in ("video", "animation"):
        headers["Range"] = "bytes=0-65535"
    req = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            status = resp.status
            body = resp.read(512)
            if status not in (200, 206):
                return False, f"http_{status}"
            if len(body) < 16:
                return False, "empty_body"
            return True, "ok"
    except urllib.error.HTTPError as exc:
        return False, f"http_{exc.code}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)[:120]


def run_checks(
    rows: Iterable[MediaRow],
    base_url: str,
    workers: int,
) -> list[tuple[MediaRow, str]]:
    failures: list[tuple[MediaRow, str]] = []
    rows = list(rows)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(probe_url, base_url, row.media_id, row.media_type): row
            for row in rows
        }
        for fut in as_completed(futures):
            row = futures[fut]
            ok, reason = fut.result()
            if not ok:
                failures.append((row, reason))
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        required=True,
        help="Next.js origin serving /api/media, e.g. https://your-domain.example.com",
    )
    parser.add_argument(
        "--ssh",
        default=None,
        help="SSH host for a remote Postgres (e.g. user@your-host), if POSTGRES_URL isn't reachable directly",
    )
    parser.add_argument(
        "--sshpass",
        default=os.environ.get("SSHPASS"),
        help="SSH password for --ssh (or set SSHPASS env)",
    )
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0, help="Only test first N rows")
    args = parser.parse_args()

    if args.ssh:
        rows = fetch_rows_via_ssh(args.ssh, args.sshpass)
    else:
        rows = fetch_rows_via_psycopg2()

    if args.limit > 0:
        rows = rows[: args.limit]

    print(f"Testing {len(rows)} ready media URLs against {args.base_url} …")
    failures = run_checks(rows, args.base_url, args.workers)

    report = {
        "total": len(rows),
        "failed": len(failures),
        "failures": [
            {"mediaId": row.media_id, "type": row.media_type, "reason": reason}
            for row, reason in failures[:50]
        ],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))

    if failures:
        print(f"\nFAILED {len(failures)}/{len(rows)}", file=sys.stderr)
        return 1

    print(f"\nOK — all {len(rows)} media URLs reachable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
