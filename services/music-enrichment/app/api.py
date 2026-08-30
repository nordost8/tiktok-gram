"""FastAPI app: the 202 + job_id front-end of the music-enrichment service.

This is the *API role*. It accepts a pick job (photos + optional callback),
persists the photos, creates a queued :class:`Job` in Redis and returns 202
immediately. It never runs the pipeline itself — the worker owns that. The
API also serves job status and, once produced, the picked mp3.

WHY a ``build_app(settings)`` factory plus a module-level ``app``: the
factory makes the dependencies explicit/testable, while ``app`` (built from
the cached ``get_settings()``) lets ``uvicorn app.api:app`` work out of the
box.

Endpoints (this is the seam the collector calls — see
``../../scripts/music_enrich_db.py``):
- POST /v1/music-jobs       multipart images[] + callback_url/idempotency_key -> 202
- GET  /v1/music-jobs/{id}  job status (+ flattened result when done)
- GET  /jobs/{id}/track.mp3 the picked mp3 (audio/mpeg), 404 until ready
- GET  /health              {ok, role, queue_depth, busy}
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.logging import configure_logging, get_logger
from app.models import Job, JobStatus
from app.settings import Settings, get_settings
from app.store import JobStore

_log = get_logger(__name__)

# Map an uploaded file's extension to the suffix we persist. Anything outside
# this set is coerced to .jpg (the pipeline only cares that pixels load).
_ALLOWED_EXTS = {"jpg", "jpeg", "png", "webp"}
_DEFAULT_EXT = "jpg"


def _ext_for(upload: UploadFile) -> str:
    """Pick a safe file extension for an upload (jpg/jpeg/png/webp, else jpg)."""
    name = upload.filename or ""
    suffix = Path(name).suffix.lower().lstrip(".")
    return suffix if suffix in _ALLOWED_EXTS else _DEFAULT_EXT


def _save_images(images: list[UploadFile], job_dir: Path) -> int:
    """Persist uploads as ``in_00.<ext>``, ``in_01.<ext>`` ... in request order.

    Returns the number of images written.
    """
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "out").mkdir(parents=True, exist_ok=True)
    for idx, upload in enumerate(images):
        ext = _ext_for(upload)
        dest = job_dir / f"in_{idx:02d}.{ext}"
        with dest.open("wb") as fh:
            fh.write(upload.file.read())
    return len(images)


def _job_status_payload(job: Job) -> dict[str, Any]:
    """Build the GET-status JSON: base fields + flattened result when present."""
    payload: dict[str, Any] = {
        "job_id": job.job_id,
        "status": job.status.value,
        "attempts": job.attempts,
    }
    if job.error is not None:
        payload["error"] = job.error
    if job.result is not None:
        result = job.result
        payload["top"] = result.top.model_dump()
        payload["recommend_list"] = [t.model_dump() for t in result.recommend_list]
        payload["track_url"] = f"/jobs/{job.job_id}/track.mp3"
    return payload


def build_app(settings: Settings) -> FastAPI:
    """Construct the FastAPI app bound to a given :class:`Settings`."""
    app = FastAPI(title="music-enrichment API", version="1.0.0")
    store = JobStore(settings)
    work_dir = Path(settings.work_dir)

    @app.post("/v1/music-jobs", status_code=202)
    async def create_job(
        images: list[UploadFile],
        callback_url: str | None = Form(default=None),
        idempotency_key: str | None = Form(default=None),
        # The post's published_at as a UNIX timestamp; the worker runs the
        # highest-priority (freshest) job first. Omitted by old clients ->
        # defaults to submission time.
        priority: float | None = Form(default=None),
        post_caption: str | None = Form(default=None),
    ) -> dict[str, str]:
        """Accept a pick job. Returns 202 {job_id, status:"queued"}.

        Idempotent on ``idempotency_key``: a repeated key returns the original
        job and does NOT re-save files or re-enqueue — UNLESS that original
        job already reached the terminal FAILED state, in which case a fresh
        job is created so a fixed-and-retried caller isn't stuck replaying a
        dead job for the full 24h idempotency-key TTL.
        """
        if not images or len(images) > settings.max_images:
            raise HTTPException(
                status_code=400,
                detail=f"images must be 1..{settings.max_images} files",
            )

        if idempotency_key is not None:
            existing = await run_in_threadpool(store.idem_get, idempotency_key)
            if existing is not None:
                existing_job = await run_in_threadpool(store.get, existing)
                if existing_job is None or existing_job.status != JobStatus.FAILED:
                    status = (
                        existing_job.status.value
                        if existing_job is not None
                        else JobStatus.QUEUED.value
                    )
                    _log.info(
                        "job.idempotent_hit",
                        job_id=existing,
                        idempotency_key=idempotency_key,
                    )
                    return {"job_id": existing, "status": status}
                _log.info(
                    "job.idempotent_retry_after_failure",
                    old_job_id=existing,
                    idempotency_key=idempotency_key,
                )

        job_id = uuid.uuid4().hex[:12]
        job_dir = work_dir / job_id

        image_count = await run_in_threadpool(_save_images, images, job_dir)

        now = datetime.now(timezone.utc)
        score = priority if priority is not None else now.timestamp()
        job = Job(
            job_id=job_id,
            status=JobStatus.QUEUED,
            attempts=0,
            callback_url=callback_url,
            idempotency_key=idempotency_key,
            image_count=image_count,
            priority=priority,
            post_caption=(post_caption or "").strip() or None,
            created_at=now,
            updated_at=now,
        )
        await run_in_threadpool(store.create, job)
        if idempotency_key is not None:
            await run_in_threadpool(store.idem_set, idempotency_key, job_id)
        await run_in_threadpool(store.enqueue, job_id, score)

        _log.info(
            "job.created", job_id=job_id, image_count=image_count, priority=score
        )
        return {"job_id": job_id, "status": JobStatus.QUEUED.value}

    @app.get("/v1/music-jobs/{job_id}")
    async def get_job(job_id: str) -> dict[str, Any]:
        """Return a job's status (+ flattened result when done). 404 if unknown."""
        job = await run_in_threadpool(store.get, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        return _job_status_payload(job)

    @app.get("/jobs/{job_id}/track.mp3")
    async def get_track(job_id: str) -> FileResponse:
        """Serve the picked mp3 as audio/mpeg. 400 on bad id, 404 if not produced."""
        if not job_id.isalnum():
            raise HTTPException(status_code=400, detail="invalid job_id")
        mp3_path = work_dir / job_id / "out" / "top_track.mp3"
        if not mp3_path.is_file():
            raise HTTPException(status_code=404, detail="track not ready")
        return FileResponse(
            path=str(mp3_path),
            media_type="audio/mpeg",
            filename="top_track.mp3",
        )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        """Liveness + queue snapshot."""
        depth = await run_in_threadpool(store.queue_depth)
        return {
            "ok": True,
            "role": "api",
            "queue_depth": depth,
            "busy": depth > 0,
        }

    return app


# Module-level app for ``uvicorn app.api:app``. Logging is configured here so
# the app is fully wired whether started via uvicorn directly or via run.py.
configure_logging()
app = build_app(get_settings())
