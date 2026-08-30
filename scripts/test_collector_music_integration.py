"""Unit tests for collector-sync ingest_post: mixed-skip + default status inserts.

Uses a FakeCursor that records every execute(sql, params) and mimics the few
fetchone() contracts ingest_post relies on (album lookup, single-insert RETURNING).
No real DB is touched.

Photo lifecycle tagging (``needs_audio``) is owned by media_cache_job after
cache — the collector only inserts descriptions with the DB default ``caching``.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

# collector-sync.py has a hyphen, so import by file path.
_spec = importlib.util.spec_from_file_location(
    "collector_sync", SCRIPTS / "collector-sync.py"
)
collector_sync = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(collector_sync)
ingest_post = collector_sync.ingest_post


# ── Fake DB cursor ────────────────────────────────────────────────────────────

class FakeCursor:
    """Records executes; serves canned fetchone() results in order.

    ``album_existing`` controls the first fetchone (the album lookup): None ->
    no existing description; a dict -> existing row. For the single-post branch
    the INSERT ... RETURNING id fetchone returns a truthy row unless
    ``single_conflict`` is True (simulating ON CONFLICT DO NOTHING).
    """

    def __init__(self, *, album_existing=None, single_conflict=False):
        self.calls: list[tuple[str, tuple]] = []
        self._album_existing = album_existing
        self._single_conflict = single_conflict

    def execute(self, sql, params=None):
        self.calls.append((sql, tuple(params) if params else ()))
        sql_norm = " ".join(sql.split())
        self._last_sql = sql_norm
        if sql_norm.startswith("SELECT id, text FROM telegram_post_descriptions"):
            self._next_fetch = self._album_existing
        elif "RETURNING id" in sql_norm:
            self._next_fetch = None if self._single_conflict else {"id": "x"}
        else:
            self._next_fetch = None

    def fetchone(self):
        return getattr(self, "_next_fetch", None)

    # convenience helpers for assertions ─────────────────────────────────────
    def description_insert(self):
        for sql, params in self.calls:
            n = " ".join(sql.split())
            if n.startswith("INSERT INTO telegram_post_descriptions"):
                return n, params
        return None

    def description_update_music(self):
        for sql, params in self.calls:
            n = " ".join(sql.split())
            if n.startswith("UPDATE telegram_post_descriptions") and "audio_cache_status" in n:
                return n, params
        return None

    def wrote_audio_status(self):
        return any("audio_cache_status" in " ".join(s.split()) for s, _ in self.calls)


# ── fixtures ──────────────────────────────────────────────────────────────────

def _media(mtype: str, idx: int = 0) -> dict:
    return {
        "type": mtype,
        "telegramAccessHash": "hash",
        "telegramDocumentId": f"doc{idx}" if mtype != "photo" else None,
        "telegramPhotoId": f"ph{idx}" if mtype == "photo" else None,
        "telegramFileReference": None,
        "telegramDcId": 4,
        "mimeType": "image/jpeg" if mtype == "photo" else "video/mp4",
        "width": 720,
        "height": 1280,
        "duration": None,
        "sizeBytes": 1000,
    }


def _row(media: list[dict], *, grouped_id=None) -> dict:
    return {
        "telegramMessageId": "100",
        "telegramUrl": "https://t.me/c/100",
        "text": "hi",
        "caption": "hi",
        "publishedAt": "2024-01-01T12:00:00+00:00",
        "media": media,
        "groupedId": grouped_id,
    }


def _photos(n: int) -> list[dict]:
    return [_media("photo", i) for i in range(n)]


class _Env:
    """Context manager to set/unset env for one test, restoring afterwards."""

    def __init__(self, **kv):
        self._kv = kv
        self._old = {}

    def __enter__(self):
        for k, v in self._kv.items():
            self._old[k] = os.environ.get(k)
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return self

    def __exit__(self, *a):
        for k, v in self._old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# Common base: video-only OFF so photo posts are eligible (mirrors prod).
def _base_env(**extra):
    env = {"COLLECTOR_VIDEO_ONLY": "0"}
    env.update(extra)
    return _Env(**env)


# ── (a) mixed post: skipped when COLLECTOR_SKIP_MIXED=1, ingested when =0 ──────

def test_mixed_skipped_when_skip_flag_on():
    with _base_env(COLLECTOR_SKIP_MIXED="1"):
        cur = FakeCursor()
        ids = ingest_post(cur, "ch", _row([_media("video", 0), _media("photo", 1)]))
    assert ids == [], "mixed post must be skipped"
    assert cur.calls == [], "nothing inserted for a skipped mixed post"


def test_mixed_ingested_when_skip_flag_off():
    with _base_env(COLLECTOR_SKIP_MIXED="0"):
        cur = FakeCursor(single_conflict=False)
        ids = ingest_post(cur, "ch", _row([_media("video", 0), _media("photo", 1)]))
    assert len(ids) == 2, "mixed post ingests both media rows when skip disabled"
    desc = cur.description_insert()
    assert desc is not None
    assert "audio_cache_status" not in desc[0], "mixed never tagged music_needed"


# ── photo-only inserts never touch legacy audio_cache_status ─────────────────

def test_photo_only_never_writes_audio_cache_status():
    with _base_env(MUSIC_ENRICHMENT_ENABLED="1"):
        cur = FakeCursor(single_conflict=False)
        ids = ingest_post(cur, "ch", _row(_photos(3)))
    assert len(ids) == 3
    assert not cur.wrote_audio_status(), (
        "collector must not write audio_cache_status; media_cache_job sets status"
    )


def test_photo_only_same_sql_regardless_of_music_flag():
    with _base_env(MUSIC_ENRICHMENT_ENABLED="0"):
        cur_off = FakeCursor(single_conflict=False)
        ingest_post(cur_off, "ch", _row(_photos(3)))
    with _base_env(MUSIC_ENRICHMENT_ENABLED="1"):
        cur_on = FakeCursor(single_conflict=False)
        ingest_post(cur_on, "ch", _row(_photos(3)))
    assert cur_off.description_insert()[0] == cur_on.description_insert()[0]


# ── (c) video-only, >10 photos, mixed → never music_needed ────────────────────

def test_video_only_never_music_needed():
    with _base_env(MUSIC_ENRICHMENT_ENABLED="1"):
        cur = FakeCursor(single_conflict=False)
        ids = ingest_post(cur, "ch", _row([_media("video", 0)]))
    assert len(ids) == 1
    assert not cur.wrote_audio_status(), "video post stays at DB-default 'none'"


def test_eleven_photos_never_music_needed():
    with _base_env(MUSIC_ENRICHMENT_ENABLED="1"):
        cur = FakeCursor(single_conflict=False)
        ids = ingest_post(cur, "ch", _row(_photos(11)))
    assert len(ids) == 11
    assert not cur.wrote_audio_status(), ">10 photos disqualifies music_needed"


def test_mixed_never_music_needed_even_with_music_on():
    # Mixed + skip OFF + music ON: ingested, but not a qualifying photo post.
    with _base_env(COLLECTOR_SKIP_MIXED="0", MUSIC_ENRICHMENT_ENABLED="1"):
        cur = FakeCursor(single_conflict=False)
        ids = ingest_post(cur, "ch", _row([_media("photo", 0), _media("video", 1)]))
    assert len(ids) == 2
    assert not cur.wrote_audio_status(), "mixed never qualifies for music_needed"


# ── grouped-album branches ────────────────────────────────────────────────────

def test_album_new_photo_post_no_audio_column():
    with _base_env(MUSIC_ENRICHMENT_ENABLED="1"):
        cur = FakeCursor(album_existing=None)
        ids = ingest_post(cur, "ch", _row(_photos(2), grouped_id="g1"))
    assert len(ids) == 2
    desc = cur.description_insert()
    assert desc is not None and "audio_cache_status" not in desc[0]


def test_album_existing_no_music_update():
    existing = {"id": "d1", "text": "already"}
    with _base_env(MUSIC_ENRICHMENT_ENABLED="1"):
        cur = FakeCursor(album_existing=existing)
        ingest_post(cur, "ch", _row(_photos(2), grouped_id="g1"))
    assert cur.description_update_music() is None


# ── (d) both flags off (defaults) → SQL identical to legacy path ──────────────

def test_both_flags_default_single_video_unchanged():
    # No COLLECTOR_* music/skip flags set; COLLECTOR_VIDEO_ONLY=0 to allow ingest.
    with _Env(
        COLLECTOR_VIDEO_ONLY="0",
        COLLECTOR_SKIP_MIXED=None,
        MUSIC_ENRICHMENT_ENABLED=None,
    ):
        cur = FakeCursor(single_conflict=False)
        ids = ingest_post(cur, "ch", _row([_media("video", 0)]))
    assert len(ids) == 1
    assert not cur.wrote_audio_status()
    desc = cur.description_insert()
    expected = (
        "INSERT INTO telegram_post_descriptions ( "
        "id, channel_id, telegram_message_id, "
        "telegram_url, text, caption, published_at "
        ") VALUES (%s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (channel_id, telegram_message_id) DO NOTHING RETURNING id"
    )
    assert desc[0] == expected, f"legacy single-insert SQL changed:\n{desc[0]}"


def test_default_skip_mixed_is_on():
    # COLLECTOR_SKIP_MIXED unset => default ON => mixed dropped.
    with _Env(COLLECTOR_VIDEO_ONLY="0", COLLECTOR_SKIP_MIXED=None):
        cur = FakeCursor()
        ids = ingest_post(cur, "ch", _row([_media("video", 0), _media("photo", 1)]))
    assert ids == [], "skip-mixed defaults ON"
    assert cur.calls == []


def test_default_music_enabled_is_off():
    with _Env(COLLECTOR_VIDEO_ONLY="0", MUSIC_ENRICHMENT_ENABLED=None):
        cur = FakeCursor(single_conflict=False)
        ingest_post(cur, "ch", _row(_photos(3)))
    assert not cur.wrote_audio_status(), "music tagging defaults OFF"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok  {t.__name__}")
            passed += 1
        except Exception as e:  # noqa: BLE001
            print(f"  XX  {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
