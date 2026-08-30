# ─── REFERENCE SKETCH — NOT A WORKING IMPLEMENTATION ────────────────────────
# See app/pipeline/__init__.py for what this package is and why this module
# is a stub, not working code.
"""Step 2 (fast path): look up a matching track in a local library via RAG.

The idea: maintain a small curated library of tracks (say, a few hundred
royalty-free loops), each with a text embedding of "what kind of scene this
track fits" (generated once, offline, when the track is added to the
library). At request time, embed the photo description from
``describe_images.describe()`` and do a nearest-neighbour search — if
there's a good match, use it and skip the YouTube-search path entirely
(cheaper, faster, and the licensing is known up front).

Contract for a real implementation:

    def search(description: str, *, min_score: float = 0.75) -> TrackCandidate | None:
        '''Return the best-matching track in the local library for this photo
        description, or None if nothing clears `min_score`. Never raises for
        "no match" — that is a normal, expected outcome; only raise for a
        genuine failure (e.g. the index failed to load).
        '''

Sketch of a real body:

    # A library entry could be as simple as a JSON/CSV file:
    #   [{"title": ..., "author": ..., "audio_path": ..., "embedding": [...]}]
    # built offline by embedding a short description of each track once.
    #
    # from numpy import dot
    # from numpy.linalg import norm
    #
    # def search(description, *, min_score=0.75):
    #     query_vec = embed(description)
    #     library = _load_library()  # cached
    #     best, best_score = None, 0.0
    #     for entry in library:
    #         score = dot(query_vec, entry.embedding) / (
    #             norm(query_vec) * norm(entry.embedding)
    #         )
    #         if score > best_score:
    #             best, best_score = entry, score
    #     if best_score >= min_score:
    #         return TrackCandidate(title=best.title, author=best.author,
    #                                audio_path=best.audio_path)
    #     return None
"""
from __future__ import annotations

from . import TrackCandidate


def search(description: str, *, min_score: float = 0.75) -> TrackCandidate | None:
    """Look up a matching track in a local RAG-indexed library. See module docstring."""
    raise NotImplementedError(
        "track_index.search() is a reference sketch — build a local track "
        "library + embedding index, or delete this pipeline and build your own."
    )
