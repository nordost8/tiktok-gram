"""Redis-backed job store + work queue.

The store is the single shared state between the API (which creates +
enqueues jobs and reads their status) and the worker (which dequeues, runs
the pipeline, and saves results).

WHY no fallback: if Redis is unreachable we let redis-py raise. A silent
in-memory fallback would lose jobs across the api/worker process boundary and
violate the no-silent-fallback rule — a job accepted as 202 must be durable.

Redis keys:
- ``music:zqueue``     — sorted set; ZADD {published_at} job_id, BZPOPMAX in
  the worker. The score is the post's published_at (UNIX ts), so the worker
  always runs the FRESHEST pending job first.
- ``music:queue``      — legacy FIFO list; drained once into ``music:zqueue``
  on worker start (``migrate_legacy_list``) so in-flight jobs survive an
  upgrade.
- ``music:job:{id}``   — string; JSON blob of the Job model (``Job.to_redis``).
- ``music:idem:{key}`` — string; idempotency_key -> job_id, with a TTL.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import cast

import redis

from app.models import Job
from app.settings import Settings

_QUEUE_KEY = "music:queue"  # legacy FIFO list (migrated on worker start)
_ZQUEUE_KEY = "music:zqueue"  # freshness-priority queue (score = published_at ts)
_JOB_PREFIX = "music:job:"
_IDEM_PREFIX = "music:idem:"

# Idempotency keys live 24h: long enough to dedup client retries of one logical
# submission, short enough not to leak unbounded keys.
_IDEM_TTL_SECONDS = 24 * 60 * 60


def _job_key(job_id: str) -> str:
    return f"{_JOB_PREFIX}{job_id}"


def _idem_key(key: str) -> str:
    return f"{_IDEM_PREFIX}{key}"


class JobStore:
    """Typed wrapper over a ``redis.Redis`` client for jobs + the work queue."""

    def __init__(self, settings: Settings) -> None:
        self._redis: redis.Redis = redis.Redis.from_url(
            settings.redis_url, decode_responses=True
        )

    # --- Job CRUD ------------------------------------------------------------
    def create(self, job: Job) -> None:
        """Persist a brand-new job at ``music:job:{id}``."""
        self._redis.set(_job_key(job.job_id), job.to_redis())

    def get(self, job_id: str) -> Job | None:
        """Read a job by id, or ``None`` if it does not exist."""
        raw = self._redis.get(_job_key(job_id))
        if raw is None:
            return None
        assert isinstance(raw, str)
        return Job.from_redis(raw)

    def save(self, job: Job) -> None:
        """Update a job, bumping ``updated_at`` to now (UTC)."""
        job.updated_at = datetime.now(timezone.utc)
        self._redis.set(_job_key(job.job_id), job.to_redis())

    # --- Work queue (freshness-priority) -------------------------------------
    def enqueue(self, job_id: str, score: float) -> None:
        """Add a job to the priority queue (ZADD), keyed by ``score``."""
        self._redis.zadd(_ZQUEUE_KEY, {job_id: score})

    def dequeue(self, timeout: int = 5) -> str | None:
        """Block-pop the FRESHEST job id (BZPOPMAX); ``None`` on timeout."""
        result = cast(
            "tuple[str, str, float] | None",
            self._redis.bzpopmax([_ZQUEUE_KEY], timeout=timeout),
        )
        if result is None:
            return None
        _key, member, _score = result
        return member

    def queue_depth(self) -> int:
        """Number of job ids currently waiting in the queue (ZCARD)."""
        return cast(int, self._redis.zcard(_ZQUEUE_KEY))

    def migrate_legacy_list(self) -> int:
        """One-time: drain any ids left in the legacy FIFO list into the zset.

        Idempotent: re-running finds the list empty. Returns the number of ids
        migrated.
        """
        moved = 0
        while True:
            job_id = cast("str | None", self._redis.lpop(_QUEUE_KEY))
            if job_id is None:
                break
            job = self.get(job_id)
            if job is None:
                score = 0.0
            elif job.priority is not None:
                score = job.priority
            else:
                score = job.created_at.timestamp()
            self._redis.zadd(_ZQUEUE_KEY, {job_id: score})
            moved += 1
        return moved

    # --- Idempotency ---------------------------------------------------------
    def idem_get(self, key: str) -> str | None:
        """Return the job_id a prior idempotency_key maps to, or ``None``."""
        value = self._redis.get(_idem_key(key))
        if value is None:
            return None
        assert isinstance(value, str)
        return value

    def idem_set(self, key: str, job_id: str) -> None:
        """Map an idempotency_key to a job_id with a 24h TTL."""
        self._redis.set(_idem_key(key), job_id, ex=_IDEM_TTL_SECONDS)
