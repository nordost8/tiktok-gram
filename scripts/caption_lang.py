"""Language detection for post captions via fastText lid.176."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DEFAULT_MODEL = Path("/app/models/lid.176.ftz")
MIN_TEXT_LEN = int(os.environ.get("CAPTION_LANG_MIN_LEN", "30"))
MIN_TRANSLATE_CONF = float(os.environ.get("CAPTION_LANG_MIN_CONF", "0.80"))
UK_SKIP_IF_PROB = float(os.environ.get("CAPTION_LANG_UK_SKIP_PROB", "0.35"))

_LABEL_MAP = {
    "ukr": "uk",
    "rus": "ru",
    "eng": "en",
    "deu": "de",
    "pol": "pl",
    "bel": "be",
    "bul": "bg",
    "ces": "cs",
    "ron": "ro",
    "fra": "fr",
    "spa": "es",
    "ita": "it",
    "tur": "tr",
    "ara": "ar",
}


def _norm_label(raw: str) -> str:
    key = raw.replace("__label__", "")
    return _LABEL_MAP.get(key, key)


@dataclass(frozen=True)
class LangDetectResult:
    language: str
    confidence: float
    top3: tuple[tuple[str, float], ...]
    should_translate: bool
    skip_reason: str | None


def post_body_text(*, caption: str | None, text: str | None) -> str:
    cap = (caption or "").strip()
    body = (text or "").strip()
    if cap and body and cap != body:
        return f"{cap}\n\n{body}" if body not in cap else cap
    return cap or body


def _uk_probability(labels: list[str], probs: list[float]) -> float:
    total = 0.0
    for label, prob in zip(labels, probs, strict=False):
        if _norm_label(label) == "uk":
            total += float(prob)
    return total


@lru_cache(maxsize=1)
def _load_model():
    import fasttext  # lazy — heavy import

    path = Path(os.environ.get("FASTTEXT_MODEL_PATH", str(DEFAULT_MODEL)))
    if not path.is_file():
        raise FileNotFoundError(f"fastText model not found: {path}")
    return fasttext.load_model(str(path))


def detect_language(body: str) -> LangDetectResult:
    cleaned = re.sub(r"\s+", " ", (body or "").strip())
    if len(cleaned) < MIN_TEXT_LEN:
        return LangDetectResult(
            language="und",
            confidence=0.0,
            top3=(),
            should_translate=False,
            skip_reason="too_short",
        )

    model = _load_model()
    labels, probs = model.predict(cleaned, k=3)
    top3 = tuple(
        (_norm_label(str(l)), float(p)) for l, p in zip(labels, probs, strict=False)
    )
    lang, conf = top3[0]
    uk_prob = _uk_probability(list(labels), list(probs))

    if lang == "uk" or uk_prob >= UK_SKIP_IF_PROB:
        return LangDetectResult(
            language="uk",
            confidence=conf if lang == "uk" else uk_prob,
            top3=top3,
            should_translate=False,
            skip_reason="ukrainian",
        )

    if conf < MIN_TRANSLATE_CONF:
        return LangDetectResult(
            language=lang,
            confidence=conf,
            top3=top3,
            should_translate=False,
            skip_reason="low_confidence",
        )

    return LangDetectResult(
        language=lang,
        confidence=conf,
        top3=top3,
        should_translate=True,
        skip_reason=None,
    )
