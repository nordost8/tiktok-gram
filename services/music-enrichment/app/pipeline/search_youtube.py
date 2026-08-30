# ─── REFERENCE SKETCH — NOT A WORKING IMPLEMENTATION ────────────────────────
# See app/pipeline/__init__.py for what this package is and why this module
# is a stub, not working code.
"""Step 4: fetch a batch of candidate videos for a search query.

Contract for a real implementation:

    @dataclass(frozen=True)
    class VideoResult:
        video_id: str
        title: str
        channel: str
        duration_s: int
        url: str

    def search(query: str, *, limit: int = 10) -> list[VideoResult]:
        '''Return up to `limit` candidate videos for `query`, most relevant
        first. Should filter out anything obviously unusable (e.g. over
        ~10 minutes) before returning. Returning fewer than `limit` results
        is fine; returning zero is a valid outcome (the caller should treat
        an empty list as "no track found", not as an error).
        '''

Sketch of a real body, using the official YouTube Data API:

    # from googleapiclient.discovery import build as build_client
    #
    # def search(query, *, limit=10):
    #     youtube = build_client("youtube", "v3", developerKey=YOUTUBE_API_KEY)
    #     resp = youtube.search().list(
    #         q=query, part="snippet", type="video",
    #         videoCategoryId="10",  # Music
    #         maxResults=limit,
    #     ).execute()
    #     return [
    #         VideoResult(
    #             video_id=item["id"]["videoId"],
    #             title=item["snippet"]["title"],
    #             channel=item["snippet"]["channelTitle"],
    #             duration_s=0,  # a second call to videos().list() gets this
    #             url=f"https://www.youtube.com/watch?v={item['id']['videoId']}",
    #         )
    #         for item in resp.get("items", [])
    #     ]
    #
    # Note: respect YouTube's Terms of Service and the licensing of whatever
    # you find — "searchable" is not the same as "cleared for this use".
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VideoResult:
    """One candidate video returned by a search."""

    video_id: str
    title: str
    channel: str
    duration_s: int
    url: str


def search(query: str, *, limit: int = 10) -> list[VideoResult]:
    """Fetch up to `limit` candidate videos for a search query. See module docstring."""
    raise NotImplementedError(
        "search_youtube.search() is a reference sketch — wire it to the "
        "YouTube Data API (or any other source of candidate tracks), or "
        "delete this pipeline and build your own."
    )
