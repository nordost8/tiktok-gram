#!/usr/bin/env python3
"""Long-running RQ worker for media-cache queue."""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
from pathlib import Path

from rq import Worker

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from media_queue_lib import (  # noqa: E402
    MEDIA_CACHE_QUEUE,
    MEDIA_CACHE_TEST_QUEUE,
    drain_pending_media_enqueues,
    get_redis_connection,
)
from telegram_collector_lib import load_env, tiktok_gram_log  # noqa: E402

_DRAIN_LOG_INTERVAL = 60  # log drain activity at most once per minute


def _pending_enqueue_drainer(stop: threading.Event) -> None:
    last_log = 0.0
    while not stop.is_set():
        try:
            drained = drain_pending_media_enqueues(max_items=16)
            now = time.monotonic()
            if drained > 0 or now - last_log >= _DRAIN_LOG_INTERVAL:
                tiktok_gram_log(
                    f"[media-worker] drain drained={drained}",
                    file_env="TIKTOK_GRAM_MEDIA_LOG",
                )
                last_log = now
        except Exception as exc:  # noqa: BLE001
            tiktok_gram_log(
                f"[media-worker] ERROR drain failed: {exc}",
                file_env="TIKTOK_GRAM_MEDIA_LOG",
            )
        stop.wait(1.0)


def main() -> None:
    load_env()
    connection = get_redis_connection()
    queues = [MEDIA_CACHE_QUEUE]
    if "--with-test-queue" in sys.argv:
        queues.append(MEDIA_CACHE_TEST_QUEUE)

    worker_name = os.environ.get(
        "MEDIA_CACHE_WORKER_NAME",
        f"tiktok-gram-media-cache-{socket.gethostname()}",
    )
    tiktok_gram_log(
        f"[media-worker] START worker={worker_name} queues={queues} pid={os.getpid()}",
        file_env="TIKTOK_GRAM_MEDIA_LOG",
    )

    stop_drainer = threading.Event()
    drainer = threading.Thread(
        target=_pending_enqueue_drainer,
        args=(stop_drainer,),
        name="media-cache-pending-drainer",
        daemon=True,
    )
    drainer.start()

    worker = Worker(queues, connection=connection, name=worker_name)
    try:
        worker.work(with_scheduler=True)
    finally:
        tiktok_gram_log("[media-worker] SHUTDOWN", file_env="TIKTOK_GRAM_MEDIA_LOG")
        stop_drainer.set()
        drainer.join(timeout=3)


if __name__ == "__main__":
    main()
