# ─── REFERENCE SKETCH — NOT A WORKING IMPLEMENTATION ────────────────────────
# See app/pipeline/__init__.py for what this package is and why this module
# is a stub, not working code.
"""Step 5: pull the audio track for one candidate video to a local file.

Contract for a real implementation:

    def download(candidate: VideoResult, dest_dir: Path) -> Path:
        '''Download `candidate`'s audio to `dest_dir` and return the local
        mp3 path. Raise on a genuine failure (network error, video removed,
        etc); the caller (the top-level pipeline) treats one candidate
        failing as "skip it and try the next one", not as a fatal error for
        the whole job.
        '''

Sketch of a real body, using yt-dlp:

    # import yt_dlp
    #
    # def download(candidate, dest_dir):
    #     dest_dir.mkdir(parents=True, exist_ok=True)
    #     out_path = dest_dir / f"{candidate.video_id}.mp3"
    #     opts = {
    #         "format": "bestaudio/best",
    #         "outtmpl": str(out_path.with_suffix("")),
    #         "postprocessors": [{
    #             "key": "FFmpegExtractAudio",
    #             "preferredcodec": "mp3",
    #             "preferredquality": "128",
    #         }],
    #         "quiet": True,
    #     }
    #     with yt_dlp.YoutubeDL(opts) as ydl:
    #         ydl.download([candidate.url])
    #     return out_path
    #
    # Note: check the license/terms for whatever you download before using
    # it in a shipped product.
"""
from __future__ import annotations

from pathlib import Path

from .search_youtube import VideoResult


def download(candidate: VideoResult, dest_dir: Path) -> Path:
    """Download a candidate's audio to a local file. See module docstring."""
    raise NotImplementedError(
        "download_audio.download() is a reference sketch — wire it to "
        "yt-dlp or another downloader, or delete this pipeline and build "
        "your own."
    )
