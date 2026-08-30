"""Reference music-recommendation pipeline for photo-post enrichment.

This package is the one seam in the whole project that is intentionally left
as a demo, not a real recommender. Everything around it — the HTTP contract in
``app/api.py``, the Redis job queue in ``app/store.py``, the retry/callback
machinery in ``app/worker.py`` and ``app/callback.py``, and every integration
point on the tiktok-gram side (the DB columns, the collector hook, the
``<audio>`` element in the feed, the mute button) is real, tested, working
code. Only "how do we actually pick a good track for this photo post" is a
stub here.

Why: the original implementation drove the TikTok app's own recommender on a
cloud Android emulator (screen-scraping "For You" sounds). It worked, but it
was fragile (see the project's git history for the outage this caused when
TikTok changed its UI) and it isn't something to hand a stranger cloning this
repo. So this package ships two things instead:

1. ``pick_track_for_images()`` below — a WORKING stub. It ignores its input
   and always returns the same bundled placeholder track
   (``app/assets/sample-track.mp3``, "Намалюй мені ніч (1966) - Example
   Audio", provided by the repository owner — see ``source_url`` on
   ``_PLACEHOLDER_TRACK`` below). This means: turn on
   ``MUSIC_ENRICHMENT_ENABLED=1`` on the collector side and every photo post
   that qualifies gets *this* one track attached, end to end, so you can see
   the whole feature work before you build a real recommender.

2. The other modules in this package (``describe_images.py``,
   ``track_index.py``, ``build_query.py``, ``search_youtube.py``,
   ``download_audio.py``, ``rank_tracks.py``) — a REFERENCE SKETCH of one
   plausible real pipeline. Each raises ``NotImplementedError`` and documents
   its exact intended contract. None of them are called by
   ``pick_track_for_images()`` below; they exist to show the shape of a real
   implementation, not to run. Wire them in (or replace them with your own
   approach entirely) when you're ready to build this for real.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"


@dataclass(frozen=True)
class TrackCandidate:
    """A track picked for a post. This is what ``pick_track_for_images``
    returns; the worker copies ``audio_path`` into the job's output dir and
    reports ``title``/``author`` in the callback."""

    title: str
    author: str
    audio_path: Path
    source_url: str | None = None
    license: str | None = None


_PLACEHOLDER_TRACK = TrackCandidate(
    title="Намалюй мені ніч (1966) - Example Audio",
    author="",
    audio_path=_ASSETS_DIR / "sample-track.mp3",
    source_url="https://youtu.be/PbPL1uChWfQ",
    license="Provided by the repository owner as a placeholder example track",
)


def pick_track_for_images(
    images: list[Path], caption: str = ""
) -> TrackCandidate | None:
    """Pick a soundtrack for a photo post. Returns ``None`` when nothing fits.

    This is the ONLY function the worker calls (see ``app/worker.py``). Swap
    its body for a real implementation when you're ready; nothing else in the
    service needs to change.

    Reference flow this stub deliberately skips (each step below is
    unimplemented — see that module's docstring for its exact contract):

        1. ``describe_images.describe()``   — what is in these photos, what
           mood do they set (a vision-capable LLM call).
        2. ``track_index.search()``         — is there already a good match
           in a local library of tracks + embeddings (a RAG lookup)? If so,
           return it immediately — this is the fast path.
        3. ``build_query.build()``          — otherwise, turn the description
           into a search query for finding new candidate tracks.
        4. ``search_youtube.search()``      — fetch ~10 candidate videos for
           that query.
        5. ``download_audio.download()``    — pull the audio for each
           candidate.
        6. ``rank_tracks.rank()``           — hand the description and the
           downloaded candidates to an LLM and let it choose the best fit.

    A real implementation would look roughly like:

        >>> description = describe_images.describe(images, caption)
        >>> hit = track_index.search(description)
        >>> if hit is not None:
        ...     return hit
        >>> query = build_query.build(description)
        >>> candidates = search_youtube.search(query, limit=10)
        >>> downloaded = [download_audio.download(c) for c in candidates]
        >>> return rank_tracks.rank(description, downloaded)

    This stub takes the shortcut instead: it always returns the bundled
    placeholder track, so a fresh clone with ``MUSIC_ENRICHMENT_ENABLED=1``
    has something to show rather than failing every job.
    """
    return _PLACEHOLDER_TRACK
