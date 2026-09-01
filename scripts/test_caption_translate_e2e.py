#!/usr/bin/env python3
"""Headless E2E test: fastText detect + LLM translate on selected posts.

Usage:
  CAPTION_TRANSLATE_ENABLED=1 CAPTION_TRANSLATE_API_KEY=... FASTTEXT_MODEL_PATH=... \\
    python scripts/test_caption_translate_e2e.py

Reads POST_IDS from env (comma-separated) or uses built-in test set.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from caption_lang import detect_language, post_body_text  # noqa: E402
from caption_translate_db import maybe_translate_post_caption  # noqa: E402
from caption_translate_lapa import translate_to_ukrainian  # noqa: E402
from media_cache_job import db_connect  # noqa: E402
from psycopg2.extras import RealDictCursor  # noqa: E402
from telegram_collector_lib import load_env  # noqa: E402

# Curated from fastText eval: Russian Supernova+, Ukrainian control, edge cases
DEFAULT_TEST_IDS = [
    "a4ba3128-9808-4fbf-b130-657500de3881",  # RU Supernova Slavyansk
    "7dfe55a9-0e72-45a3-a9d2-eacfba5d1db8",  # RU Rambo John
    "beac3874-74a0-4bf8-b0f4-ac545c588e20",  # UA must skip
    "0a604f75-9475-4fea-9ba4-35f829bbfc48",  # UA LATERAL Russell
    "5e843303-ea7f-4bd1-bdd9-c552284821a4",  # UA short — must NOT translate (low conf)
]


def load_post(desc_id: str) -> dict | None:
    with db_connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, caption, text, source_lang, text_display_uk,
                       caption_translation_status
                FROM telegram_post_descriptions WHERE id = %s
                """,
                (desc_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def main() -> int:
    load_env()
    os.environ.setdefault("CAPTION_TRANSLATE_ENABLED", "1")

    ids = os.environ.get("CAPTION_TEST_POST_IDS", "").strip()
    post_ids = [x.strip() for x in ids.split(",") if x.strip()] if ids else DEFAULT_TEST_IDS

    results: list[dict] = []
    failures = 0

    for desc_id in post_ids:
        row = load_post(desc_id)
        if not row:
            print(f"FAIL {desc_id}: not in DB")
            failures += 1
            continue

        body = post_body_text(caption=row.get("caption"), text=row.get("text"))
        detect = detect_language(body)
        entry: dict = {
            "id": desc_id,
            "detect_lang": detect.language,
            "detect_conf": round(detect.confidence, 3),
            "should_translate": detect.should_translate,
            "skip_reason": detect.skip_reason,
            "body_preview": body[:100].replace("\n", " "),
        }

        if detect.should_translate:
            preview = translate_to_ukrainian(body, source_lang=detect.language)
            entry["translate_preview"] = (preview or "")[:200]
            if not preview:
                print(f"FAIL {desc_id}: LLM returned empty translation")
                failures += 1
            else:
                # Full pipeline (writes DB)
                os.environ["CAPTION_TRANSLATE_ENABLED"] = "1"
                # Reset for re-test
                with db_connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE telegram_post_descriptions
                            SET text_display_uk = NULL,
                                caption_translation_status = 'none',
                                caption_translate_attempts = 0,
                                source_lang = NULL
                            WHERE id = %s
                            """,
                            (desc_id,),
                        )
                    conn.commit()
                out = maybe_translate_post_caption(desc_id)
                entry["pipeline"] = out
                if not out.get("ok") or out.get("skipped"):
                    if out.get("skipped") not in (None, "disabled"):
                        pass
                    elif not out.get("ok"):
                        failures += 1
                row2 = load_post(desc_id)
                entry["db_status"] = row2.get("caption_translation_status") if row2 else None
                entry["db_lang"] = row2.get("source_lang") if row2 else None
        else:
            entry["translate_preview"] = None

        results.append(entry)
        print(json.dumps(entry, ensure_ascii=False, indent=2))

    print(f"\n=== summary: posts={len(results)} failures={failures} ===")
    out_path = Path("/tmp/caption_translate_e2e.json")
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"written {out_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
