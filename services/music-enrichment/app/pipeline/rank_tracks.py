# ─── REFERENCE SKETCH — NOT A WORKING IMPLEMENTATION ────────────────────────
# See app/pipeline/__init__.py for what this package is and why this module
# is a stub, not working code.
"""Step 6: let an LLM pick the best-fitting track out of the downloaded candidates.

Contract for a real implementation:

    def rank(
        description: str, candidates: list[tuple[VideoResult, Path]]
    ) -> TrackCandidate | None:
        '''Given the photo description and a list of (video metadata, local
        mp3 path) pairs, choose the one that fits best and return it as a
        TrackCandidate. Return None if none of the candidates are a
        reasonable fit — that's a valid outcome, not an error.
        '''

Sketch of a real body:

    # A text-only LLM can rank on title/channel/duration alone (cheap, fast,
    # usually good enough); an audio-capable model could listen to a short
    # clip of each candidate for a better judgment call, at higher cost.
    #
    # def rank(description, candidates):
    #     options = "\\n".join(
    #         f"{i}. {video.title} — {video.channel} ({video.duration_s}s)"
    #         for i, (video, _path) in enumerate(candidates)
    #     )
    #     prompt = (
    #         f"Scene: {description}\\n\\nCandidate tracks:\\n{options}\\n\\n"
    #         "Reply with only the number of the best fit, or -1 if none fit."
    #     )
    #     choice = int(llm_client.complete(prompt).text.strip())
    #     if choice < 0 or choice >= len(candidates):
    #         return None
    #     video, path = candidates[choice]
    #     return TrackCandidate(
    #         title=video.title, author=video.channel, audio_path=path,
    #         source_url=video.url,
    #     )
"""
from __future__ import annotations

from pathlib import Path

from . import TrackCandidate
from .search_youtube import VideoResult


def rank(
    description: str, candidates: list[tuple[VideoResult, Path]]
) -> TrackCandidate | None:
    """Let an LLM choose the best-fitting candidate track. See module docstring."""
    raise NotImplementedError(
        "rank_tracks.rank() is a reference sketch — wire it to an LLM call, "
        "or delete this pipeline and build your own."
    )
