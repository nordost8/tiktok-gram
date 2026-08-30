# ─── REFERENCE SKETCH — NOT A WORKING IMPLEMENTATION ────────────────────────
# See app/pipeline/__init__.py for what this package is and why this module
# is a stub, not working code.
"""Step 3: turn a photo description into a search query for finding music.

Contract for a real implementation:

    def build(description: str) -> str:
        '''Return a short search-engine-friendly query, e.g. "lofi rainy
        evening walk ambient instrumental" from a description like "a rainy
        evening walk through a quiet European old town, warm streetlights,
        slow and reflective". Deterministic in spirit (same input -> a
        reasonable query), but doesn't have to be exact — search_youtube
        fetches a batch of candidates and rank_tracks does the real
        selection.
        '''

Sketch of a real body — this step barely needs an LLM at all:

    # def build(description):
    #     prompt = (
    #         "Turn this scene description into a short YouTube search query "
    #         "for finding a fitting instrumental background track "
    #         "(genre + mood + 'instrumental', no artist names): "
    #         f"{description!r}"
    #     )
    #     return llm_client.complete(prompt).text.strip()
"""
from __future__ import annotations


def build(description: str) -> str:
    """Turn a photo description into a music search query. See module docstring."""
    raise NotImplementedError(
        "build_query.build() is a reference sketch — implement it with a "
        "small LLM call or a keyword heuristic, or delete this pipeline and "
        "build your own."
    )
