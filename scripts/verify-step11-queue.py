#!/usr/bin/env python3
"""Verify Redis/RQ media cache queue (no Telegram required)."""

from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

from redis import Redis
from rq import Queue
from rq.exceptions import NoSuchJobError
from rq.job import Job
from rq.worker import SimpleWorker

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from media_queue_lib import (  # noqa: E402
    MEDIA_CACHE_TEST_QUEUE,
    enqueue_media_cache_test,
    get_redis_connection,
)
from telegram_collector_lib import load_env, require_env  # noqa: E402


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def run_burst_worker(connection: Redis, queue_name: str, max_jobs: int = 3) -> None:
    queue = Queue(queue_name, connection=connection)
    worker = SimpleWorker([queue], connection=connection)
    worker.work(burst=True, max_jobs=max_jobs)


def main() -> None:
    load_env()
    require_env("REDIS_URL")
    connection = get_redis_connection()
    connection.ping()

    token = f"step11-{uuid.uuid4().hex[:8]}"
    first = enqueue_media_cache_test(token, connection=connection)
    second = enqueue_media_cache_test(token, connection=connection)

    assert_true(first["enqueued"] is True, "first test job should enqueue")
    assert_true(second["enqueued"] is False, "duplicate active test job should dedupe")
    assert_true(first["jobId"] == second["jobId"], "deduped jobs must share job id")

    run_burst_worker(connection, MEDIA_CACHE_TEST_QUEUE, max_jobs=1)

    job = Job.fetch(first["jobId"], connection=connection)
    assert_true(job.is_finished, f"test job not finished: {job.get_status()}")
    result = job.result
    assert_true(isinstance(result, dict) and result.get("ok") is True, "unexpected job result")
    assert_true(result.get("token") == token, "job result token mismatch")

    job.delete()

    print(
        json.dumps(
            {
                "ok": True,
                "redis": require_env("REDIS_URL").split("@")[-1],
                "testJobId": first["jobId"],
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
