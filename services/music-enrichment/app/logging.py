"""Structured logging via structlog.

WHY structlog: structured key/value events render as JSON in prod (greppable
in log shippers) and as friendly colorized console output during local dev.
One ``configure_logging()`` call wires it for the whole process; modules call
``get_logger(__name__)`` and bind context as they go.
"""
from __future__ import annotations

import logging
import os
import sys

import structlog


def configure_logging() -> None:
    """Configure structlog + stdlib logging once at process start.

    Level comes from env ``MUSIC_LOG_LEVEL`` (default INFO). Renderer is chosen
    by TTY: a human-readable console renderer when stderr is a terminal, JSON
    otherwise (prod / piped logs).
    """
    level_name = os.environ.get("MUSIC_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    logging.basicConfig(format="%(message)s", stream=sys.stderr, level=level)

    renderer: structlog.types.Processor = (
        structlog.dev.ConsoleRenderer()
        if sys.stderr.isatty()
        else structlog.processors.JSONRenderer()
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a bound logger for ``name`` (typically ``__name__``)."""
    logger: structlog.stdlib.BoundLogger = structlog.get_logger(name)
    return logger
