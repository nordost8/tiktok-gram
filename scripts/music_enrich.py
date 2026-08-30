"""Music enrichment for image-only / photo-carousel Telegram posts.

PRODUCT PURPOSE
---------------
Telegram photo posts have no sound. The music-enrichment microservice
(``services/music-enrichment/``) picks a background track for a set of 1..10
photos. This module is the collector side of that contract: it detects
qualifying posts, POSTs their cached images to the service, and (via the
callback receiver) stores the picked track on the post so the feed can render
it. See ``docs/music-enrichment.md`` at the repo root for the full picture —
the recommendation logic itself is a documented stub by default (see
``services/music-enrichment/app/pipeline/``).

INSERTION POINT (Design A — post-cache hook)
--------------------------------------------
Photo *bytes* do not exist at ingest time — ``collector-sync.py`` only stores
Telegram refs (cache_status='needs_cache'); the ``media-worker`` downloads them
to R2 later (``media_cache_job.cache_media_job``). The music pick needs the
actual image files, so enrichment is triggered from the post-cache hook: once a
media row becomes ``ready``, we check whether the whole post (description) is a
fully-cached, video-free photo post and, if so, fire exactly one music job.

EVERYTHING HERE IS OFF BY DEFAULT
---------------------------------
Gated by env ``MUSIC_ENRICHMENT_ENABLED`` (default ``0``). When off,
``maybe_enrich_post_with_music`` is a no-op and photo posts go straight to
``status='ready'`` (visible in the feed without audio). When on, photo posts
park in ``needs_audio`` until the music-enrichment service finishes. The
service URL is ``MUSIC_ENRICHMENT_URL`` (default
``http://music-enrichment-api:8090``).

This module deliberately has NO heavy imports at module load (no psycopg2 / no
boto3) so that the pure functions (qualification + idempotency key) are unit
testable in isolation.
"""

from __future__ import annotations

import hashlib
import os
from typing import Any, Iterable

# Default in-stack service name (see deploy/pi/docker-compose.yml).
DEFAULT_MUSIC_ENRICHMENT_URL = "http://music-enrichment-api:8090"

# The picker accepts at most this many photos (MAX_IMAGES in the picker).
MAX_MUSIC_IMAGES = 10

# Media types that disqualify a post from music enrichment. A post is only a
# candidate when it is *image-only* (there's no audio track to attach music to
# on top of an existing video).
_VIDEO_TYPES = frozenset({"video", "animation"})
_PHOTO_TYPES = frozenset({"photo"})


def music_enabled() -> bool:
    """True only when the operator explicitly opts in. Default OFF."""
    return os.environ.get("MUSIC_ENRICHMENT_ENABLED", "0").strip() == "1"


def photo_post_status_after_cache() -> str:
    """Unified status for a fully-cached photo-only post.

    Music on  → ``needs_audio`` (hidden until the service + callback finish).
    Music off → ``ready`` (show photos silently, no enrichment job).
    """
    return "needs_audio" if music_enabled() else "ready"


def music_enrichment_url() -> str:
    """Base URL of the music service (in-stack default, overridable)."""
    raw = os.environ.get("MUSIC_ENRICHMENT_URL", "").strip()
    return raw or DEFAULT_MUSIC_ENRICHMENT_URL


def music_callback_url() -> str | None:
    """Absolute callback URL the music service POSTs results to.

    Returns None when unset — the caller then omits the callback (the receiver
    is what stores results, so without it nothing is persisted; we still create
    the job so a future poll could read it, but in practice the operator sets
    this to the callback receiver's address).
    """
    raw = os.environ.get("MUSIC_ENRICHMENT_CALLBACK_URL", "").strip()
    return raw or None


def is_qualifying_media_set(media_types: Iterable[str]) -> bool:
    """A post qualifies iff it has >=1 photo, no video/animation, and <=MAX photos.

    ``media_types`` are the ``type`` values of the post's media rows.

    Rules (intentionally strict — NO silent degradation):
    - at least one photo,
    - zero video / animation media (a single video disqualifies the whole post),
    - total photo count within the picker's MAX_MUSIC_IMAGES budget.
    """
    types = list(media_types)
    if not types:
        return False
    if any(t in _VIDEO_TYPES for t in types):
        return False
    photos = [t for t in types if t in _PHOTO_TYPES]
    if not photos:
        return False
    if len(photos) > MAX_MUSIC_IMAGES:
        return False
    # Any non-photo, non-video media type is unexpected; treat as disqualifying
    # rather than guessing.
    return all(t in _PHOTO_TYPES for t in types)


def idempotency_key(desc_id: str, attempt: int) -> str:
    """Idempotency key for a post's music job, scoped to (desc_id, attempt).

    The music service dedupes on this key. It MUST include the attempt number:
    a key derived from the desc id alone would make a *failed* job permanently
    un-retryable — the service would keep returning the dead failed job for every
    retry. Including ``attempt`` (which the claim increments) gives each retry a
    fresh job, while concurrent duplicate triggers within the *same* attempt still
    collapse to one job. Hashed so the key is opaque/fixed-length on the wire.
    """
    digest = hashlib.sha256(
        f"tiktok-gram:post-music:{desc_id}:{attempt}".encode("utf-8")
    ).hexdigest()
    return f"tiktok-gram-post-{digest[:32]}"


def select_music_image_media(media_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """From a post's media rows, pick the photos to send (ready in Postgres, in order).

    Capped at MAX_MUSIC_IMAGES.
    """
    usable = [
        m
        for m in media_rows
        if m.get("type") in _PHOTO_TYPES
        and m.get("cache_status") == "ready"
        and m.get("storage_backend") == "postgres"
    ]
    return usable[:MAX_MUSIC_IMAGES]


def post_media_all_ready(media_rows: list[dict[str, Any]]) -> bool:
    """True when every photo media row of the post is cached (bytes available).

    Enrichment waits until the whole carousel is cached so we send the complete
    image set to the picker in one job (the visual recommendation depends on all
    photos). Rows in ``skipped`` (e.g. oversize) are tolerated — they will never
    become ready and must not block the rest.
    """
    photos = [m for m in media_rows if m.get("type") in _PHOTO_TYPES]
    if not photos:
        return False
    return all(
        m.get("cache_status") in ("ready", "skipped") for m in photos
    ) and any(m.get("cache_status") == "ready" for m in photos)
