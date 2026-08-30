"""Domain models — the contract shared by api, worker, store and callback."""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class JobStatus(str, Enum):
    """Lifecycle of a pick job. Terminal states: DONE, FAILED."""

    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class TrackInfo(BaseModel):
    """A single recommended track, as reported to the callback receiver."""

    title: str
    author: str
    source_url: str | None = None
    license: str | None = None


class PickResult(BaseModel):
    """Outcome of a successful pick."""

    top: TrackInfo
    recommend_list: list[TrackInfo] = []
    ts: int


class Job(BaseModel):
    """A music-pick job, persisted in Redis as JSON (see store.py)."""

    job_id: str
    status: JobStatus
    attempts: int = 0
    callback_url: str | None = None
    idempotency_key: str | None = None
    image_count: int
    # Work-queue priority: the post's published_at as a UNIX timestamp. The
    # worker pops the HIGHEST priority first (freshest post wins) so a stale
    # backlog never delays music on brand-new posts. ``None`` (legacy/unknown)
    # falls back to ``created_at`` at enqueue time.
    priority: float | None = None
    post_caption: str | None = None
    created_at: datetime
    updated_at: datetime
    error: str | None = None
    result: PickResult | None = None

    def to_redis(self) -> str:
        """Serialize for the Redis ``music:job:{id}`` value."""
        return self.model_dump_json()

    @classmethod
    def from_redis(cls, s: str) -> Job:
        """Deserialize a Job from its Redis JSON blob."""
        return cls.model_validate_json(s)
