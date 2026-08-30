#!/usr/bin/env python3
"""Verify RQ job exists after TS collector-style enqueue."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from media_queue_lib import enqueue_media_cache, media_job_id, get_redis_connection  # noqa: E402
from rq.exceptions import NoSuchJobError  # noqa: E402
from rq.job import Job  # noqa: E402
from telegram_collector_lib import load_env, require_env  # noqa: E402


def main() -> None:
    load_env()
    require_env("REDIS_URL")

    ts = subprocess.run(
        ["pnpm", "-F", "@tiktok-gram/db", "verify:step11-collector-enqueue"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if ts.returncode != 0:
        raise RuntimeError(ts.stderr.strip() or ts.stdout.strip())

    lines = [line for line in ts.stdout.strip().splitlines() if line.startswith("{")]
    payload = json.loads(lines[-1] if lines else "{}")
    media_id = payload["mediaId"]
    job_id = media_job_id(media_id)

    conn = get_redis_connection()
    job = Job.fetch(job_id, connection=conn)
    status = job.get_status()
    if status not in ("queued", "started", "finished", "deferred"):
        raise AssertionError(f"unexpected job status: {status}")

    second = enqueue_media_cache(media_id)
    if second.get("enqueued") and status in ("queued", "started", "deferred"):
        raise AssertionError(f"dedupe failed: {second}")

    print(
        json.dumps(
            {
                "ok": True,
                "mediaId": media_id,
                "jobId": job_id,
                "jobStatus": status,
                "dedupe": True,
            },
            ensure_ascii=False,
        ),
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)
