#!/usr/bin/env python3
"""Unit tests for caption_lang (fastText detect thresholds)."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

# Use local eval model if present
if Path("/tmp/fasttext-models/lid.176.ftz").is_file():
    os.environ.setdefault("FASTTEXT_MODEL_PATH", "/tmp/fasttext-models/lid.176.ftz")

from caption_lang import detect_language, post_body_text  # noqa: E402


@unittest.skipUnless(
    Path(os.environ.get("FASTTEXT_MODEL_PATH", "/app/models/lid.176.ftz")).is_file(),
    "fastText model not available",
)
class CaptionLangTests(unittest.TestCase):
    def test_russian_supernova(self) -> None:
        body = "впечатления от пережитой ночи от жителей Славянск-на-Кубани.. молилась с каждым дроном.."
        r = detect_language(body)
        self.assertEqual(r.language, "ru")
        self.assertTrue(r.should_translate)

    def test_ukrainian_skip(self) -> None:
        body = "⚡️⚡️ «Рейд» уразив один із ключових елементів енергосистеми Криму!"
        r = detect_language(body)
        self.assertFalse(r.should_translate)
        self.assertEqual(r.skip_reason, "ukrainian")

    def test_short_skip(self) -> None:
        r = detect_language("Привіт")
        self.assertFalse(r.should_translate)
        self.assertEqual(r.skip_reason, "too_short")

    def test_post_body_merge(self) -> None:
        self.assertEqual(post_body_text(caption="A", text="B"), "A\n\nB")


if __name__ == "__main__":
    unittest.main()
