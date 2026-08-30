"""The single serial worker — pops jobs, runs the pipeline, sends callbacks.

Jobs are processed strictly one at a time on the main thread. State machine
per job: ``queued -> running -> done | failed``.

The pipeline (``app/pipeline``) is a stub that always succeeds with a bundled
placeholder track (see its docstring) — retries exist here for when someone
plugs in a real, occasionally-flaky implementation (an LLM call, a network
download) later. We never silently degrade: a ``done`` job always has a real
mp3 written to its output dir.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from .callback import send_callback
from .logging import configure_logging, get_logger
from .models import Job, JobStatus, PickResult, TrackInfo
from .pipeline import pick_track_for_images
from .settings import Settings
from .store import JobStore

_log = get_logger(__name__)

# How long the worker blocks on the queue before looping (lets shutdown
# checks run even when no jobs arrive).
_DEQUEUE_TIMEOUT_SECONDS = 5


def _job_dirs(settings: Settings, job_id: str) -> tuple[list[Path], Path]:
    """Resolve the input image paths and output dir for a job.

    The API saved uploads as ``{work_dir}/{job_id}/in_NN.<ext>`` in request
    order and created ``{work_dir}/{job_id}/out/``.
    """
    job_root = Path(settings.work_dir) / job_id
    out_dir = job_root / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    images = sorted(job_root.glob("in_*"))
    return images, out_dir


def _run_pick_with_retries(settings: Settings, job: Job) -> PickResult:
    """Run the pipeline, retrying transient failures up to ``max_attempts``.

    Raises the last exception if every attempt fails (or if no track is
    picked at all) — the caller marks the job FAILED in that case.
    """
    images, out_dir = _job_dirs(settings, job.job_id)
    max_attempts = max(1, settings.max_attempts)

    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        job.attempts = attempt
        try:
            track = pick_track_for_images(
                images, caption=job.post_caption or ""
            )
            if track is None:
                raise RuntimeError("pipeline found no fitting track for this post")

            dest = out_dir / "top_track.mp3"
            shutil.copyfile(track.audio_path, dest)

            top = TrackInfo(
                title=track.title,
                author=track.author,
                source_url=track.source_url,
                license=track.license,
            )
            _log.info("worker.pick.done", job_id=job.job_id, attempt=attempt)
            return PickResult(top=top, recommend_list=[top], ts=int(job.updated_at.timestamp()))
        except Exception as exc:  # noqa: BLE001 — retried below, re-raised at the end
            _log.warning(
                "worker.pick.error", job_id=job.job_id, attempt=attempt, error=str(exc)
            )
            last_error = exc

    assert last_error is not None
    raise last_error


def _process_job(settings: Settings, store: JobStore, job_id: str) -> None:
    """Take one job from queued through a terminal state and fire its callback."""
    job = store.get(job_id)
    if job is None:
        # The job blob vanished (TTL / manual delete) — nothing to do.
        _log.warning("worker.job.missing", job_id=job_id)
        return

    try:
        job.status = JobStatus.RUNNING
        store.save(job)
        job.result = _run_pick_with_retries(settings, job)
        job.status = JobStatus.DONE
        job.error = None
        store.save(job)
    except Exception as exc:  # noqa: BLE001 — every attempt exhausted
        job.status = JobStatus.FAILED
        job.error = str(exc)
        store.save(job)
        _log.error("worker.job.failed", job_id=job_id, attempts=job.attempts)
    finally:
        final = store.get(job_id) or job
        if final.status in (JobStatus.DONE, JobStatus.FAILED):
            send_callback(settings, final)


def run_worker(settings: Settings) -> None:
    """Entry point for the worker role (called by ``run.py worker``)."""
    configure_logging()
    _log.info("worker.start")

    store = JobStore(settings)

    # One-time: carry any jobs still in the legacy FIFO list over to the
    # freshness-priority queue so an in-flight backlog survives an upgrade.
    migrated = store.migrate_legacy_list()
    if migrated:
        _log.info("worker.queue.migrated", count=migrated)

    while True:
        job_id = store.dequeue(timeout=_DEQUEUE_TIMEOUT_SECONDS)
        if job_id is None:
            continue
        _log.info("worker.job.dequeued", job_id=job_id)
        try:
            _process_job(settings, store, job_id)
        except Exception as exc:  # noqa: BLE001 — one bad job must not kill the loop
            _log.error("worker.job.crash", job_id=job_id, error=str(exc))
