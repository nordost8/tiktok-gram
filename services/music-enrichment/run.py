"""Launcher: ``python run.py <role>`` where role is ``api`` or ``worker``.

WHY a gate-first launcher: the service won't boot with a type error. Before
dispatching to any role we run the strict mypy gate; on a non-zero result we
print mypy's output and exit without starting the role. The gate can be
skipped with ``MUSIC_SKIP_MYPY=1`` (used inside the container, where the
image was already type-checked at build time).
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from app.logging import configure_logging, get_logger

_ROLES = ("api", "worker")
_PKG_DIR = Path(__file__).resolve().parent
_log = get_logger(__name__)


def run_mypy_gate() -> int:
    """Run the strict mypy gate over the package. Return mypy's exit code."""
    proc = subprocess.run(
        [sys.executable, "-m", "mypy", "--config-file", "mypy.ini", "app", "run.py"],
        cwd=_PKG_DIR,
    )
    return proc.returncode


def run_api() -> None:
    """Start the FastAPI API role. Binds to ``settings.bind:settings.port``."""
    import uvicorn

    import app.api
    from app.settings import get_settings

    configure_logging()
    settings = get_settings()
    _log.info("api.start", bind=settings.bind, port=settings.port)
    uvicorn.run(app.api.app, host=settings.bind, port=settings.port)


def run_worker() -> None:
    """Start the single serial worker role."""
    import app.worker
    from app.settings import get_settings

    app.worker.run_worker(get_settings())


def main(argv: list[str]) -> int:
    """Parse the role, run the gate (unless skipped), then dispatch."""
    configure_logging()

    if len(argv) < 2 or argv[1] not in _ROLES:
        print(f"usage: python run.py {{{'|'.join(_ROLES)}}}", file=sys.stderr)
        return 2
    role = argv[1]

    if os.environ.get("MUSIC_SKIP_MYPY") != "1":
        code = run_mypy_gate()
        if code != 0:
            _log.error("mypy_gate.failed", exit_code=code)
            return 1
        _log.info("mypy_gate.passed")

    if role == "api":
        run_api()
    else:
        run_worker()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
