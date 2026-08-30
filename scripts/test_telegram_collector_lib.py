"""Unit tests for merge_album_rows() in telegram_collector_lib."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from telegram_collector_lib import merge_album_rows


def _media(video_id: str) -> dict:
    return {
        "type": "video",
        "telegramDocumentId": video_id,
        "telegramPhotoId": None,
        "telegramAccessHash": "12345",
        "telegramFileReference": None,
        "telegramDcId": 4,
        "mimeType": "video/mp4",
        "width": 720,
        "height": 1280,
        "duration": 30,
        "sizeBytes": 5_000_000,
        "sortOrder": 0,
    }


def _row(msg_id: str, *, grouped_id: str | None = None, text: str | None = None, media_id: str | None = None) -> dict:
    return {
        "telegramMessageId": msg_id,
        "telegramUrl": f"https://t.me/digitalnia/{msg_id}",
        "text": text,
        "caption": text,
        "publishedAt": "2024-01-01T12:00:00+00:00",
        "media": [_media(media_id or f"doc_{msg_id}")],
        "_grouped_id": grouped_id,
    }


# ── 1. Single post (no album) passes through unchanged ────────────────────────

def test_single_post_no_album():
    rows = [_row("100", text="Привіт")]
    result = merge_album_rows(rows)
    assert len(result) == 1
    assert result[0]["telegramMessageId"] == "100"
    assert result[0]["text"] == "Привіт"
    assert "_grouped_id" not in result[0]


# ── 2. Album: text on LAST message (typical Telegram behaviour) ───────────────

def test_album_text_on_last_message():
    rows = [
        _row("201", grouped_id="g1", text=None,     media_id="vid_201"),
        _row("202", grouped_id="g1", text=None,     media_id="vid_202"),
        _row("203", grouped_id="g1", text=None,     media_id="vid_203"),
        _row("204", grouped_id="g1", text=None,     media_id="vid_204"),
        _row("205", grouped_id="g1", text="Важливо: дивіться!"),
    ]
    result = merge_album_rows(rows)
    assert len(result) == 1, "5 album msgs → 1 merged post"
    post = result[0]
    assert post["telegramMessageId"] == "201", "earliest msg id"
    assert post["text"] == "Важливо: дивіться!", "text propagated from last msg"
    assert post["caption"] == "Важливо: дивіться!"
    assert len(post["media"]) == 1, "only primary (first) media kept"
    assert post["media"][0]["telegramDocumentId"] == "vid_201", "primary video is from first msg"
    assert "_grouped_id" not in post


# ── 3. Album: text on FIRST message ──────────────────────────────────────────

def test_album_text_on_first_message():
    rows = [
        _row("301", grouped_id="g2", text="Опис тут"),
        _row("302", grouped_id="g2", text=None),
        _row("303", grouped_id="g2", text=None),
    ]
    result = merge_album_rows(rows)
    assert len(result) == 1
    assert result[0]["text"] == "Опис тут"
    assert result[0]["media"][0]["telegramDocumentId"] == "doc_301"


# ── 4. Album: text on MIDDLE message ─────────────────────────────────────────

def test_album_text_on_middle_message():
    rows = [
        _row("401", grouped_id="g3", text=None),
        _row("402", grouped_id="g3", text="Текст посередині"),
        _row("403", grouped_id="g3", text=None),
    ]
    result = merge_album_rows(rows)
    assert len(result) == 1
    assert result[0]["text"] == "Текст посередині"
    assert result[0]["telegramMessageId"] == "401"
    assert result[0]["media"][0]["telegramDocumentId"] == "doc_401"


# ── 5. Album with NO text at all ─────────────────────────────────────────────

def test_album_no_text():
    rows = [
        _row("501", grouped_id="g4", text=None),
        _row("502", grouped_id="g4", text=None),
    ]
    result = merge_album_rows(rows)
    assert len(result) == 1
    assert result[0]["text"] is None
    assert result[0]["caption"] is None


# ── 6. Mix: two albums + a standalone post, order preserved ──────────────────

def test_mix_albums_and_singles():
    rows = [
        _row("601", grouped_id="ga", text=None),
        _row("602", grouped_id="ga", text="Альбом A"),
        _row("610"),                                     # standalone, no album
        _row("620", grouped_id="gb", text=None),
        _row("621", grouped_id="gb", text="Альбом B"),
    ]
    result = merge_album_rows(rows)
    assert len(result) == 3, "2 albums + 1 single = 3 posts"
    ids = [r["telegramMessageId"] for r in result]
    assert ids == ["601", "610", "620"], "chronological order by first msg id"
    assert result[0]["text"] == "Альбом A"
    assert result[1]["text"] is None
    assert result[2]["text"] == "Альбом B"


# ── 7. Messages arrive out of order (API may return them unsorted) ────────────

def test_album_out_of_order_input():
    rows = [
        _row("705", grouped_id="g5", text="Опис"),
        _row("701", grouped_id="g5", text=None, media_id="first_vid"),
        _row("703", grouped_id="g5", text=None),
    ]
    result = merge_album_rows(rows)
    assert len(result) == 1
    assert result[0]["telegramMessageId"] == "701", "earliest id wins"
    assert result[0]["media"][0]["telegramDocumentId"] == "first_vid"
    assert result[0]["text"] == "Опис"


# ── 8. _grouped_id never leaks into output ───────────────────────────────────

def test_grouped_id_stripped_from_all():
    rows = [
        _row("801", grouped_id="g6", text=None),
        _row("802", grouped_id="g6", text="Текст"),
        _row("810"),  # standalone
    ]
    result = merge_album_rows(rows)
    for post in result:
        assert "_grouped_id" not in post, f"_grouped_id leaked into post {post['telegramMessageId']}"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  ✓ {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  ✗ {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
