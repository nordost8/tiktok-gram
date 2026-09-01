"""Translate post captions via any OpenAI-compatible chat-completions API.

Provider is entirely your choice: OpenAI (ChatGPT), DeepSeek, a local LLM
(Ollama, vLLM, llama.cpp server), OpenRouter, etc. Lapa/LapaLLM is only the
example shown in the architecture diagram — not a dependency.

Env vars (``CAPTION_TRANSLATE_*`` preferred; ``LAPATHONIIA_*`` kept as aliases):

- ``CAPTION_TRANSLATE_API_KEY`` / ``LAPATHONIIA_API_KEY`` — Bearer token
- ``CAPTION_TRANSLATE_BASE_URL`` / ``LAPATHONIIA_BASE_URL`` — API root, e.g.
  ``https://api.openai.com/v1``, ``https://api.deepseek.com/v1``,
  ``http://localhost:11434/v1`` (Ollama)
- ``CAPTION_TRANSLATE_MODEL`` / ``LAPATHONIIA_TRANSLATE_MODEL`` — model id

Edit the system prompt below to change the target language (default: Ukrainian).
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"
# Example alternatives (set via CAPTION_TRANSLATE_BASE_URL / _MODEL):
#   DeepSeek  — https://api.deepseek.com/v1  + deepseek-chat
#   Local     — http://localhost:11434/v1    + your Ollama model name
#   Lapa      — https://api.lapathoniia.top/v1 + LapaLLM-Gemma-3-12B-instruct
# Anthropic Claude needs an OpenAI-compatible gateway (OpenRouter, LiteLLM, …).


def _env(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def _api_key() -> str | None:
    return _env("CAPTION_TRANSLATE_API_KEY", "LAPATHONIIA_API_KEY")


def _model() -> str:
    return _env("CAPTION_TRANSLATE_MODEL", "LAPATHONIIA_TRANSLATE_MODEL") or DEFAULT_MODEL


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

    base = (
        _env("CAPTION_TRANSLATE_BASE_URL", "LAPATHONIIA_BASE_URL") or DEFAULT_BASE_URL
    ).rstrip("/")
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
