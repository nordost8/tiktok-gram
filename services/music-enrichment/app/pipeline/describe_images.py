# ─── REFERENCE SKETCH — NOT A WORKING IMPLEMENTATION ────────────────────────
# This module is intentionally a stub. It documents one plausible first step
# of a real music-recommendation pipeline; it is not the only way to do this
# and it has never been run. Nothing in the feed depends on it: with
# MUSIC_ENRICHMENT_ENABLED=0 (the default) photo posts publish silently, and
# even with it on, ``pipeline.pick_track_for_images`` never calls this module
# — see ``app/pipeline/__init__.py``.
"""Step 1: describe a set of photos as text (scene, mood, pace).

Contract for a real implementation:

    def describe(images: list[Path], caption: str = "") -> str:
        '''Return a short natural-language description of what these photos
        show and what mood/energy they suggest, e.g. "a rainy evening walk
        through a quiet European old town, warm streetlights, slow and
        reflective". `images` is 1..10 local file paths (already downloaded
        by the API). `caption` is the post's own text, if any — useful
        context but may be empty or in a different language.

        Raises on a genuine failure (e.g. the vision API is down); returning
        an empty description is not acceptable — the caller (track_index /
        build_query) needs *something* to work with.
        '''

Sketch of a real body, using any vision-capable LLM API:

    # from PIL import Image
    # import base64
    #
    # def describe(images, caption=""):
    #     encoded = [_to_data_url(p) for p in images[:4]]  # a handful is enough
    #     prompt = (
    #         "Describe the scene and mood of these photos in one sentence, "
    #         "suitable for picking background music. "
    #         f"Post caption (may be empty): {caption!r}"
    #     )
    #     response = vision_client.describe(prompt, images=encoded)
    #     return response.text.strip()
"""
from __future__ import annotations

from pathlib import Path


def describe(images: list[Path], caption: str = "") -> str:
    """Describe a set of photos as text (scene, mood, pace). See module docstring."""
    raise NotImplementedError(
        "describe_images.describe() is a reference sketch — implement it with "
        "a vision-capable LLM call, or delete this pipeline and build your own."
    )
