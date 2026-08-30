"""Unit tests for the pure music enrichment logic.

No DB / network — exercises qualifying-post detection, idempotency-key
derivation, image selection, and the feature-flag default. Run:
    python scripts/test_music_enrich.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_enrich import (
    DEFAULT_MUSIC_ENRICHMENT_URL,
    MAX_MUSIC_IMAGES,
    idempotency_key,
    is_qualifying_media_set,
    music_enabled,
    photo_post_status_after_cache,
    post_media_all_ready,
    select_music_image_media,
    music_enrichment_url,
)


def _photo(status: str = "ready", media_id: str = "ph-1") -> dict:
    return {
        "type": "photo",
        "id": media_id,
        "cache_status": status,
        "storage_backend": "postgres" if status == "ready" else "r2",
        "mime_type": "image/jpeg",
    }


def _video(status: str = "ready") -> dict:
    return {"type": "video", "cache_status": status, "storage_key": "media/v.mp4"}


# ── qualification ────────────────────────────────────────────────────────────

def test_single_photo_qualifies():
    assert is_qualifying_media_set(["photo"]) is True


def test_carousel_photos_qualify():
    assert is_qualifying_media_set(["photo", "photo", "photo"]) is True


def test_video_disqualifies():
    assert is_qualifying_media_set(["video"]) is False


def test_animation_disqualifies():
    assert is_qualifying_media_set(["animation"]) is False


def test_mixed_photo_and_video_disqualifies():
    # A single video in the set disqualifies the whole post.
    assert is_qualifying_media_set(["photo", "video"]) is False
    assert is_qualifying_media_set(["photo", "photo", "animation"]) is False


def test_empty_set_disqualifies():
    assert is_qualifying_media_set([]) is False


def test_over_max_images_disqualifies():
    assert is_qualifying_media_set(["photo"] * MAX_MUSIC_IMAGES) is True
    assert is_qualifying_media_set(["photo"] * (MAX_MUSIC_IMAGES + 1)) is False


def test_unknown_media_type_disqualifies():
    assert is_qualifying_media_set(["photo", "sticker"]) is False


# ── idempotency key ──────────────────────────────────────────────────────────

def test_idempotency_key_stable():
    desc = "11111111-1111-1111-1111-111111111111"
    # Same (post, attempt) -> same key (dedupes concurrent triggers for one attempt).
    assert idempotency_key(desc, 1) == idempotency_key(desc, 1)


def test_idempotency_key_distinct_per_post():
    a = idempotency_key("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", 1)
    b = idempotency_key("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", 1)
    assert a != b


def test_idempotency_key_distinct_per_attempt():
    # A retry (new attempt) MUST get a fresh key so a failed job isn't reused.
    desc = "11111111-1111-1111-1111-111111111111"
    assert idempotency_key(desc, 1) != idempotency_key(desc, 2)


def test_idempotency_key_opaque_prefix():
    key = idempotency_key("some-desc-id", 1)
    assert key.startswith("tiktok-gram-post-")
    # No raw desc id leaks into the wire key.
    assert "some-desc-id" not in key


# ── all-ready gate ───────────────────────────────────────────────────────────

def test_all_ready_true_when_every_photo_ready():
    assert post_media_all_ready([_photo("ready"), _photo("ready")]) is True


def test_all_ready_false_while_one_downloading():
    assert post_media_all_ready([_photo("ready"), _photo("downloading")]) is False


def test_all_ready_tolerates_skipped_if_one_ready():
    # An oversize/skipped photo must not block the rest forever.
    assert post_media_all_ready([_photo("ready"), _photo("skipped")]) is True


def test_all_ready_false_when_all_skipped():
    assert post_media_all_ready([_photo("skipped"), _photo("skipped")]) is False


# ── image selection ──────────────────────────────────────────────────────────

def test_select_only_ready_photos_in_order():
    rows = [
        _photo("ready", "ph-a"),
        _photo("downloading", "ph-b"),
        _photo("ready", "ph-c"),
    ]
    ids = [m["id"] for m in select_music_image_media(rows)]
    assert ids == ["ph-a", "ph-c"]


def test_select_caps_at_max():
    rows = [_photo("ready", f"ph-{i}") for i in range(MAX_MUSIC_IMAGES + 5)]
    assert len(select_music_image_media(rows)) == MAX_MUSIC_IMAGES


def test_select_excludes_video():
    rows = [_photo("ready"), _video("ready")]
    selected = select_music_image_media(rows)
    assert all(m["type"] == "photo" for m in selected)


# ── feature flag / url defaults ──────────────────────────────────────────────

def test_music_disabled_by_default():
    os.environ.pop("MUSIC_ENRICHMENT_ENABLED", None)
    assert music_enabled() is False


def test_music_enabled_only_for_exactly_1():
    os.environ["MUSIC_ENRICHMENT_ENABLED"] = "1"
    assert music_enabled() is True
    for val in ("0", "true", "yes", "", "2"):
        os.environ["MUSIC_ENRICHMENT_ENABLED"] = val
        assert music_enabled() is False, val
    os.environ.pop("MUSIC_ENRICHMENT_ENABLED", None)


def test_photo_post_status_ready_when_music_off():
    os.environ.pop("MUSIC_ENRICHMENT_ENABLED", None)
    assert photo_post_status_after_cache() == "ready"
    os.environ["MUSIC_ENRICHMENT_ENABLED"] = "0"
    assert photo_post_status_after_cache() == "ready"
    os.environ.pop("MUSIC_ENRICHMENT_ENABLED", None)


def test_photo_post_status_needs_audio_when_music_on():
    os.environ["MUSIC_ENRICHMENT_ENABLED"] = "1"
    assert photo_post_status_after_cache() == "needs_audio"
    os.environ.pop("MUSIC_ENRICHMENT_ENABLED", None)


def test_default_service_url():
    os.environ.pop("MUSIC_ENRICHMENT_URL", None)
    assert music_enrichment_url() == DEFAULT_MUSIC_ENRICHMENT_URL


def test_service_url_override():
    os.environ["MUSIC_ENRICHMENT_URL"] = "http://example:9999"
    assert music_enrichment_url() == "http://example:9999"
    os.environ.pop("MUSIC_ENRICHMENT_URL", None)


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok {t.__name__}")
            passed += 1
        except Exception as e:  # noqa: BLE001
            print(f"  FAIL {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
