"""Concrete LLM providers: Anthropic, OpenAI, and OpenAI-compatible endpoints."""
from __future__ import annotations

from .base import LLMProvider


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, model: str, api_key: str):
        super().__init__(model)
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key)

    def complete_json(self, system: str, user: str) -> str:
        resp = self._client.messages.create(
            model=self.model,
            max_tokens=8000,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
        return "".join(parts)

    def complete_text(self, system: str, user: str) -> str:
        return self.complete_json(system, user)


class OpenAIProvider(LLMProvider):
    """Works for OpenAI and any OpenAI-compatible endpoint (via base_url)."""

    name = "openai"

    def __init__(self, model: str, api_key: str, base_url: str | None = None):
        super().__init__(model)
        from openai import OpenAI

        kwargs = {"api_key": api_key or "not-needed"}
        if base_url:
            kwargs["base_url"] = base_url
            self.name = "openai_compatible"
        self._client = OpenAI(**kwargs)

    def complete_json(self, system: str, user: str) -> str:
        resp = self._client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        return resp.choices[0].message.content or ""

    def complete_text(self, system: str, user: str) -> str:
        resp = self._client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
        )
        return resp.choices[0].message.content or ""


def build_provider(provider: str, model: str, *, anthropic_key: str,
                   openai_key: str, base_url: str) -> LLMProvider | None:
    """Return a configured provider, or None if no usable credentials."""
    provider = (provider or "").lower()
    if provider == "anthropic" and anthropic_key:
        return AnthropicProvider(model, anthropic_key)
    if provider == "openai" and openai_key:
        return OpenAIProvider(model, openai_key)
    if provider == "openai_compatible" and (openai_key or base_url):
        return OpenAIProvider(model, openai_key, base_url=base_url)
    return None
