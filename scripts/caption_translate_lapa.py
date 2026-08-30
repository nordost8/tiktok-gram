"""Translate post caption to Ukrainian via Lapathoniia (OpenAI-compatible API)."""
from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://api.lapathoniia.top/v1"
DEFAULT_MODEL = "LapaLLM-Gemma-3-12B-instruct"


def _api_key() -> str | None:
    return os.environ.get("LAPATHONIIA_API_KEY", "").strip() or None


def _model() -> str:
    return os.environ.get("LAPATHONIIA_TRANSLATE_MODEL", "").strip() or DEFAULT_MODEL


def _parse_json_content(raw: str) -> dict[str, Any] | None:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def translate_to_ukrainian(text: str, *, source_lang: str) -> str | None:
    key = _api_key()
    if not key:
        return None

    system = (
        "Ти перекладач для українського новинного застосунку. "
        "Переклади текст поста з Telegram українською мовою. "
        "Збережи емодзі, хештеги, @mentions, посилання та структуру абзаців. "
        "Не додавай пояснень. Поверни ТІЛЬКИ JSON: "
        '{"translation_uk": string}'
    )
    user = f"Мова джерела (ISO): {source_lang}\n\nТекст:\n{text[:4000]}"

    base = os.environ.get("LAPATHONIIA_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": _model(),
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.1,
                "max_tokens": 2000,
            },
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]

    parsed = _parse_json_content(content)
    if not parsed:
        return None
    out = str(parsed.get("translation_uk") or "").strip()
    return out or None
