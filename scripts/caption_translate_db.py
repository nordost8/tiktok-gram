"""Caption language detect + translate pipeline (fastText + Lapathoniia)."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from psycopg2.extras import RealDictCursor

from caption_lang import detect_language, post_body_text
from caption_translate_lapa import translate_to_ukrainian
from media_cache_job import db_connect
from telegram_collector_lib import tiktok_gram_log

_LOG_ENV = "TIKTOK_GRAM_MEDIA_LOG"
_MAX_ATTEMPTS = 3


def translate_enabled() -> bool:
    return os.environ.get("CAPTION_TRANSLATE_ENABLED", "0").strip() == "1"


def _load_post(desc_id: str) -> dict[str, Any] | None:
    with db_connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, status, caption, text, source_lang, text_display_uk,
                       caption_translation_status, caption_translate_attempts
                FROM telegram_post_descriptions
                WHERE id = %s
                """,
                (desc_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def _mark_skipped(desc_id: str, *, lang: str, reason: str) -> None:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET source_lang = %s,
                    caption_translation_status = 'skipped',
                    caption_translate_error = %s,
                    caption_translated_at = NOW()
                WHERE id = %s
                """,
                (lang, reason[:500], desc_id),
            )
        conn.commit()


def _mark_ready(desc_id: str, *, lang: str, translation: str) -> None:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET source_lang = %s,
                    text_display_uk = %s,
                    caption_translation_status = 'ready',
                    caption_translate_error = NULL,
                    caption_translated_at = NOW()
                WHERE id = %s
                """,
                (lang, translation, desc_id),
            )
        conn.commit()


def _mark_failed(desc_id: str, *, error: str) -> None:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET caption_translation_status =
                        CASE WHEN caption_translate_attempts >= %s THEN 'failed'::telegram_caption_translation_status
                             ELSE 'none'::telegram_caption_translation_status END,
                    caption_translate_error = %s,
                    caption_translated_at = NOW()
                WHERE id = %s
                """,
                (_MAX_ATTEMPTS, error[:2000], desc_id),
            )
        conn.commit()


def _claim(desc_id: str) -> bool:
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE telegram_post_descriptions
                SET caption_translation_status = 'pending',
                    caption_translate_attempts = caption_translate_attempts + 1
                WHERE id = %s
                  AND status = 'ready'
                  AND caption_translation_status IN ('none', 'failed')
                  AND text_display_uk IS NULL
                  AND caption_translate_attempts < %s
                RETURNING id
                """,
                (desc_id, _MAX_ATTEMPTS),
            )
            ok = cur.fetchone() is not None
        conn.commit()
    return ok


def maybe_translate_post_caption(desc_id: str) -> dict[str, Any]:
    """Detect language and translate non-UA captions. Safe to call from hooks."""
    if not translate_enabled():
        return {"ok": True, "skipped": "disabled"}

    try:
        row = _load_post(desc_id)
        if not row:
            return {"ok": False, "error": "not_found"}
        if row["status"] != "ready":
            return {"ok": True, "skipped": "not_ready"}
        if row.get("text_display_uk"):
            return {"ok": True, "skipped": "already_translated"}
        if row.get("caption_translation_status") == "ready":
            return {"ok": True, "skipped": "ready"}

        body = post_body_text(caption=row.get("caption"), text=row.get("text"))
        if not body.strip():
            _mark_skipped(desc_id, lang="und", reason="empty")
            return {"ok": True, "skipped": "empty"}

        detect = detect_language(body)
        if not detect.should_translate:
            _mark_skipped(desc_id, lang=detect.language, reason=detect.skip_reason or "skip")
            tiktok_gram_log(
                f"[caption-translate] SKIP desc={desc_id} lang={detect.language} "
                f"conf={detect.confidence:.3f} reason={detect.skip_reason}",
                file_env=_LOG_ENV,
            )
            return {
                "ok": True,
                "skipped": detect.skip_reason,
                "lang": detect.language,
                "confidence": detect.confidence,
            }

        if not _claim(desc_id):
            return {"ok": True, "skipped": "claim_lost"}

        tiktok_gram_log(
            f"[caption-translate] TRANSLATE desc={desc_id} lang={detect.language} "
            f"conf={detect.confidence:.3f}",
            file_env=_LOG_ENV,
        )
        translated = translate_to_ukrainian(body, source_lang=detect.language)
        if not translated:
            _mark_failed(desc_id, error="lapathoniia_empty_or_error")
            return {"ok": False, "error": "translate_failed"}

        _mark_ready(desc_id, lang=detect.language, translation=translated)
        tiktok_gram_log(
            f"[caption-translate] READY desc={desc_id} lang={detect.language} "
            f"chars={len(translated)}",
            file_env=_LOG_ENV,
        )
        return {
            "ok": True,
            "lang": detect.language,
            "confidence": detect.confidence,
            "chars": len(translated),
        }
    except Exception as exc:  # noqa: BLE001
        tiktok_gram_log(
            f"[caption-translate] ERROR desc={desc_id} {type(exc).__name__}: {exc}",
            file_env=_LOG_ENV,
        )
        try:
            _mark_failed(desc_id, error=str(exc))
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "error": str(exc)}
