"""Redis/RQ helpers for step-11 media cache jobs."""

from __future__ import annotations

import os
from typing import Any

from redis import Redis
from rq import Queue, Retry
from rq.exceptions import NoSuchJobError
from rq.job import Job

from telegram_collector_lib import load_env, require_env

MEDIA_CACHE_QUEUE = "media-cache"
MEDIA_CACHE_TEST_QUEUE = "media-cache-test"
MEDIA_CACHE_PENDING_LIST = "tiktok_gram:media-cache:pending-ids"
ACTIVE_JOB_STATUSES = frozenset({"queued", "started", "deferred", "scheduled"})


def media_job_id(media_id: str) -> str:
    # RQ job ids allow only [A-Za-z0-9_-]
    return f"media-{media_id}"


def get_redis_connection() -> Redis:
    load_env()
    return Redis.from_url(require_env("REDIS_URL"))


def get_media_cache_queue(connection: Redis | None = None) -> Queue:
    conn = connection or get_redis_connection()
    return Queue(MEDIA_CACHE_QUEUE, connection=conn)


def _fetch_job(job_id: str, connection: Redis) -> Job | None:
    try:
        return Job.fetch(job_id, connection=connection)
    except NoSuchJobError:
        return None


def drain_pending_media_enqueues(
    *,
    connection: Redis | None = None,
    max_items: int = 32,
) -> int:
    """Drain IDs pushed by Next.js web (no python3 in web container)."""
    conn = connection or get_redis_connection()
    processed = 0
    for _ in range(max_items):
        raw = conn.lpop(MEDIA_CACHE_PENDING_LIST)
        if raw is None:
            break
        media_id = raw.decode() if isinstance(raw, bytes) else str(raw)
        enqueue_media_cache(media_id, connection=conn)
        processed += 1
    return processed


def enqueue_media_cache(
    media_id: str,
    *,
    connection: Redis | None = None,
) -> dict[str, Any]:
    """Enqueue download/cache job. Dedupes active jobs by media job id."""
    from media_cache_job import cache_media_job, load_media_row

    row = load_media_row(media_id)
    if not row:
        # Row doesn't exist yet (or was cleaned up). Don't enqueue — the worker
        # would fail immediately. The drainer or next collector run will retry.
        return {
            "mediaId": media_id,
            "jobId": media_job_id(media_id),
            "enqueued": False,
            "status": "not_found",
            "skipped": "not_found",
        }
    if row.get("type") == "photo":
        already = row.get("cache_status") == "ready" and row.get("has_cached_data")
    else:
        already = row.get("cache_status") == "ready" and row.get("storage_key")
    if already:
        return {
            "mediaId": media_id,
            "jobId": media_job_id(media_id),
            "enqueued": False,
            "status": "ready",
            "skipped": "already_ready",
        }

    conn = connection or get_redis_connection()
    queue = get_media_cache_queue(conn)
    job_id = media_job_id(media_id)

    existing = _fetch_job(job_id, conn)
    if existing is not None:
        status = existing.get_status()
        if status in ACTIVE_JOB_STATUSES:
            return {
                "mediaId": media_id,
                "jobId": job_id,
                "enqueued": False,
                "status": status,
            }
        existing.delete()

    job = queue.enqueue(
        cache_media_job,
        media_id,
        job_id=job_id,
        retry=Retry(max=3, interval=[60, 300, 900]),
        job_timeout=int(os.environ.get("MEDIA_CACHE_JOB_TIMEOUT", "900")),
        result_ttl=86_400,
        failure_ttl=86_400,
    )
    return {
        "mediaId": media_id,
        "jobId": job.id,
        "enqueued": True,
        "status": job.get_status(),
    }


def enqueue_media_cache_test(
    token: str,
    *,
    connection: Redis | None = None,
) -> dict[str, Any]:
    from media_cache_job import queue_self_test

    conn = connection or get_redis_connection()
    queue = Queue(MEDIA_CACHE_TEST_QUEUE, connection=conn)
    job_id = f"media-test-{token}"

    existing = _fetch_job(job_id, conn)
    if existing is not None:
        status = existing.get_status()
        if status in ACTIVE_JOB_STATUSES:
            return {
                "token": token,
                "jobId": job_id,
                "enqueued": False,
                "status": status,
            }
        existing.delete()

    job = queue.enqueue(
        queue_self_test,
        token,
        job_id=job_id,
        job_timeout=30,
        result_ttl=300,
    )
    return {
        "token": token,
        "jobId": job.id,
        "enqueued": True,
        "status": job.get_status(),
    }
