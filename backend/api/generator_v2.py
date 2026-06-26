"""V2 Read2Lead pack generator with level-based OpenAI routing + Opus fallback.

Routing (Felix cost-cut decision, 2026-06-06; Opus fallback update 2026-06-19):
- Attempts 1-2: OpenAI primary — L1/L2 -> gpt-5-mini, L3-L5 -> gpt-5.4-mini
- Attempt 3: Anthropic Opus 4.6 fallback after two failed validation attempts

Surgical retry: on validation failure, the next attempt sees the previous failed
pack as context so it can fix specifically rather than re-roll from scratch.
"""
from __future__ import annotations

import json
import os

from anthropic import Anthropic
import re as _re

from openai import OpenAI

from generate_qa import add_guided_listening, build_guided_listening_prompt
from prompt_v2 import (
    ACTIVITY_FROM_STORY_SYSTEM_PROMPT,
    NARRATIVE_RUBRIC,
    SYSTEM_PROMPT_V2,
    build_activity_from_story_user_message,
    build_story_only_user_message,
    build_story_polish_user_message,
    build_story_system_prompt,
    build_user_message_v2,
)
from validator_v2 import validate_story_only

DEFAULT_MODEL_V2 = "claude-opus-4-6-20250610"
DEFAULT_OPENAI_MODEL_L12 = "gpt-5-mini"
DEFAULT_OPENAI_MODEL_L345 = "gpt-5.4-mini"
PRIMARY_OPENAI_ATTEMPTS = 2

# V2.5 story 2-pass polish (behind READ2LEAD_STORY_2PASS). Pass 2 rewrites only
# story.* on top of the pass-1 draft; activities are never regenerated.
STORY_POLISH_MODEL = "gpt-5.4-mini"
STORY_POLISH_REQUIRED_KEYS = ("title", "paragraphs_en", "sentences", "trivia_vi")


def story_2pass_enabled() -> bool:
    """Return True only when READ2LEAD_STORY_2PASS is explicitly truthy."""
    return os.environ.get("READ2LEAD_STORY_2PASS", "").strip().lower() in ("1", "true", "yes")


def two_call_enabled() -> bool:
    """Return True when READ2LEAD_GEN_MODE=two_call (story-first pipeline)."""
    return os.environ.get("READ2LEAD_GEN_MODE", "").strip().lower() == "two_call"


def normalize_level(level: str) -> str:
    """Normalize hub/form level labels to L1-L5."""
    raw = (level or "L2").strip().upper()
    if raw.startswith("L") and len(raw) >= 2 and raw[1].isdigit():
        return f"L{raw[1]}"
    return raw


def resolve_openai_model_for_level(level: str) -> str:
    """Pick the cheaper OpenAI model for the student's reading level."""
    lv = normalize_level(level)
    if lv in ("L1", "L2"):
        return os.environ.get("OPENAI_MODEL_V2_L12", DEFAULT_OPENAI_MODEL_L12)
    return os.environ.get("OPENAI_MODEL_V2_L345", DEFAULT_OPENAI_MODEL_L345)


def resolve_provider_for_attempt(attempt_index: int) -> str:
    """Route attempts 0-1 to OpenAI; attempt 2+ to Anthropic Sonnet fallback."""
    if attempt_index < PRIMARY_OPENAI_ATTEMPTS:
        return "openai"
    return "anthropic"


def _openai_api_key() -> str:
    key = os.environ.get("READ2LEAD_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise ValueError("READ2LEAD_OPENAI_API_KEY or OPENAI_API_KEY is required for OpenAI routing")
    return key


def _build_previous_pack_context_v2(previous_pack: dict, validation_errors: list[str]) -> str:
    """Serialize the failed previous V2 pack so the LLM can fix it surgically."""
    if not isinstance(previous_pack, dict):
        return ""

    story = previous_pack.get("story") or {}
    paragraphs_en = story.get("paragraphs_en") or []
    if not isinstance(paragraphs_en, list) or not paragraphs_en:
        return ""

    prev_story = "\n\n".join(str(p) for p in paragraphs_en)
    prev_word_count = sum(len(str(p).split()) for p in paragraphs_en)
    activities = previous_pack.get("activities") or []
    activity_types = [a.get("type", "?") for a in activities if isinstance(a, dict)]

    parts = [
        "",
        "=== PREVIOUS ATTEMPT (failed validation — fix it, do not re-roll) ===",
        f"PREVIOUS story.paragraphs_en (~{prev_word_count} words):",
        prev_story,
        "",
        f"PREVIOUS activity types in order: {activity_types}",
        "",
        "Validation errors from the previous attempt:",
    ]
    for err in (validation_errors or [])[:10]:
        parts.append(f"  - {err}")

    parts.extend([
        "",
        "FIX STRATEGY:",
        "- If word count is OUT OF RANGE: edit story length only; keep activities aligned to the (possibly edited) story sentences.",
        "- If a sentence was 'not found verbatim': either copy the exact story sentence into the activity item, OR add that sentence to the story (preserving word count).",
        "- If scrambled_tokens reconstruction failed: rebuild tokens + indices for that item from scratch using simple whitespace split.",
        "- If section mix is wrong: re-order reading_comprehension questions to match the level's expected mix.",
        "- DO NOT abandon the previous story and write a new one — that produces the same class of failure.",
        "=== END PREVIOUS ATTEMPT ===",
    ])
    return "\n".join(parts)


def _build_user_message(
    child_name: str,
    age: int,
    level: str,
    gender: str,
    interests: str,
    topic: str,
    validation_errors: list[str] | None,
    previous_pack: dict | None,
    rank_points: int | None = None,
    level_progress_percent: int | None = None,
) -> str:
    user_msg = build_user_message_v2(
        child_name, age, level, gender, interests=interests, topic=topic, rank_points=rank_points,
        level_progress_percent=level_progress_percent,
    )

    if validation_errors:
        error_lines = "\n".join(f"- {err}" for err in validation_errors[:8])
        user_msg += f"""

IMPORTANT: The previous JSON failed Read2Lead V2 validation. Fix these specific issues:
{error_lines}"""

        if previous_pack and isinstance(previous_pack, dict):
            user_msg += _build_previous_pack_context_v2(previous_pack, validation_errors)

    return user_msg


def generate_pack_v2(
    child_name: str,
    age: int,
    level: str,
    gender: str,
    interests: str = "",
    topic: str = "",
    rank_points: int | None = None,
    level_progress_percent: int | None = None,
    validation_errors: list[str] | None = None,
    previous_pack: dict | None = None,
    attempt_index: int = 0,
    force_provider: str | None = None,
) -> tuple[dict, dict]:
    """Generate a V2 Read2Lead pack via routed LLM provider.

    Args:
        attempt_index: 0-based retry index from server loop (0-1 OpenAI, 2 Sonnet).
        force_provider: Test override — "openai" or "anthropic".

    Returns:
        (pack_dict, usage_dict)

    usage_dict shape:
        {"provider": str, "model": str, "input_tokens": int,
         "output_tokens": int, "cache_creation_input_tokens": int,
         "cache_read_input_tokens": int}
    """
    if two_call_enabled():
        return _generate_pack_two_call(
            child_name, age, level, gender, interests, topic,
            rank_points, level_progress_percent,
            force_provider=force_provider,
        )

    user_msg = _build_user_message(
        child_name, age, level, gender, interests, topic, validation_errors, previous_pack, rank_points,
        level_progress_percent,
    )

    provider = (force_provider or resolve_provider_for_attempt(attempt_index)).lower()
    if provider == "openai":
        model = resolve_openai_model_for_level(level)
        pack, usage = _generate_via_openai_v2(user_msg, model=model)
    else:
        pack, usage = _generate_via_anthropic_v2(user_msg)

    # V2.5 story 2-pass polish: only on the first attempt of the OpenAI draft
    # path, only when the flag is on. Flag off OR polish failure leaves the
    # single-pass behavior byte-identical to the legacy path.
    if (
        story_2pass_enabled()
        and attempt_index == 0
        and provider == "openai"
        and isinstance(pack, dict)
        and isinstance(pack.get("story"), dict)
    ):
        polish_usage: dict = {}
        polished = _generate_via_openai_polish(
            pack, level, child_name, topic, usage_out=polish_usage
        )
        if polished:
            pack["story"] = polished
            usage["polish_model"] = STORY_POLISH_MODEL
            usage["polish_input_tokens"] = polish_usage.get("input_tokens", 0)
            usage["polish_output_tokens"] = polish_usage.get("output_tokens", 0)
            print(
                f"[story-2pass] polished story for {child_name} L{level}, "
                f"sentences={len(polished.get('sentences', []))}"
            )

    return pack, usage


def _generate_via_anthropic_v2(user_msg: str, system_prompt: str = SYSTEM_PROMPT_V2) -> tuple[dict, dict]:
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    model = os.environ.get("ANTHROPIC_MODEL_V2", DEFAULT_MODEL_V2)

    response = client.messages.create(
        model=model,
        max_tokens=8192,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_msg}],
        timeout=180.0,
    )

    raw_text = response.content[0].text
    usage_obj = getattr(response, "usage", None)
    usage = {
        "provider": "anthropic",
        "model": model,
        "input_tokens": getattr(usage_obj, "input_tokens", 0) if usage_obj else 0,
        "output_tokens": getattr(usage_obj, "output_tokens", 0) if usage_obj else 0,
        "cache_creation_input_tokens": getattr(usage_obj, "cache_creation_input_tokens", 0) if usage_obj else 0,
        "cache_read_input_tokens": getattr(usage_obj, "cache_read_input_tokens", 0) if usage_obj else 0,
    }
    return _parse_json(raw_text), usage


def _generate_via_openai_v2(user_msg: str, *, model: str, system_prompt: str = SYSTEM_PROMPT_V2) -> tuple[dict, dict]:
    """Generate pack via OpenAI Chat Completions. Handles GPT-5 reasoning quirks."""
    client = OpenAI(api_key=_openai_api_key())
    is_reasoning = (
        model.startswith("gpt-5")
        or model.startswith("o1")
        or model.startswith("o3")
        or model.startswith("o4")
    )

    openai_kwargs = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        "max_completion_tokens": 12288,
        "timeout": 180.0,
    }
    if is_reasoning:
        # "low" required for STORY-FIRST adherence; "minimal" skips re-read step.
        openai_kwargs["extra_body"] = {"reasoning_effort": "low"}

    response = client.chat.completions.create(**openai_kwargs)
    choice = response.choices[0] if response.choices else None
    if not choice:
        raise ValueError(f"OpenAI returned no choices. model={model}")

    finish_reason = getattr(choice, "finish_reason", None)
    raw_text = (choice.message.content or "").strip()

    usage = getattr(response, "usage", None)
    if usage is not None:
        details = getattr(usage, "completion_tokens_details", None)
        reasoning_tokens = getattr(details, "reasoning_tokens", None) if details else None
        print(
            f"[openai-v2] model={model} finish={finish_reason} "
            f"in={usage.prompt_tokens} out={usage.completion_tokens} "
            f"reasoning={reasoning_tokens}"
        )

    if not raw_text:
        raise ValueError(
            f"OpenAI returned empty content. model={model} finish={finish_reason}. "
            f"If finish=length, increase max_completion_tokens or lower reasoning_effort. "
            f"If finish=content_filter, the prompt was blocked."
        )

    if finish_reason == "content_filter":
        raise ValueError(f"OpenAI content filter blocked output. model={model}")

    openai_usage = {
        "provider": "openai",
        "model": model,
        "input_tokens": getattr(usage, "prompt_tokens", 0) if usage else 0,
        "output_tokens": getattr(usage, "completion_tokens", 0) if usage else 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    return _parse_json(raw_text), openai_usage


def _generate_via_openai_polish(
    draft_pack: dict,
    level: str,
    child_name: str,
    topic: str = "",
    usage_out: dict | None = None,
) -> dict | None:
    """Pass-2 story polish via OpenAI gpt-5.4-mini.

    Rewrites ONLY the story (title/paragraphs_en/sentences/trivia_vi) against
    the narrative arc rubric. Returns the polished story dict, or None on any
    failure (caller falls back to the unmodified draft story).

    When ``usage_out`` is provided, polish token counts are written to it.
    """
    try:
        polish_user_msg = build_story_polish_user_message(
            draft_pack, level, child_name, topic
        )

        client = OpenAI(api_key=_openai_api_key())
        response = client.chat.completions.create(
            model=STORY_POLISH_MODEL,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": NARRATIVE_RUBRIC},
                {"role": "user", "content": polish_user_msg},
            ],
            max_completion_tokens=4096,
            extra_body={"reasoning_effort": "low"},
            timeout=180.0,
        )

        choice = response.choices[0] if response.choices else None
        if not choice:
            raise ValueError("OpenAI polish returned no choices")
        raw_text = (choice.message.content or "").strip()
        if not raw_text:
            raise ValueError(
                f"OpenAI polish returned empty content (finish="
                f"{getattr(choice, 'finish_reason', None)})"
            )

        parsed = _parse_json(raw_text)
        story = parsed.get("story") if isinstance(parsed.get("story"), dict) else parsed
        if not isinstance(story, dict):
            raise ValueError("polish response missing story object")
        missing = [k for k in STORY_POLISH_REQUIRED_KEYS if k not in story]
        if missing:
            raise ValueError(f"polish story missing keys: {missing}")

        if usage_out is not None:
            usage = getattr(response, "usage", None)
            usage_out["input_tokens"] = getattr(usage, "prompt_tokens", 0) if usage else 0
            usage_out["output_tokens"] = getattr(usage, "completion_tokens", 0) if usage else 0

        return story
    except Exception as exc:  # noqa: BLE001 — polish is best-effort, never fatal
        print(f"[story-2pass] polish failed: {exc}")
        return None


_SENTENCE_SPLIT_RE = _re.compile(r"(?<=[.!?])\s+")
_MIN_SENTENCE_WORDS = 3


def _split_paragraphs_into_sentences(paragraphs: list[str]) -> list[dict]:
    """Split paragraphs_en into a sentences array (server-side, deterministic).

    After regex splitting on .!?, merges short fragments (< 3 words) into the
    next sentence. Handles sound effects ("Splash! The water hit his face." →
    one sentence) and abbreviation false positives ("Mr. Tran smiled." → one).
    """
    sentences: list[dict] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        text = str(paragraph).strip()
        if not text:
            continue
        raw_parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(text) if p.strip()]
        merged: list[str] = []
        for part in raw_parts:
            if merged and len(merged[-1].split()) < _MIN_SENTENCE_WORDS:
                merged[-1] = merged[-1] + " " + part
            else:
                merged.append(part)
        # Handle trailing fragment (last part too short — merge into previous)
        if len(merged) > 1 and len(merged[-1].split()) < _MIN_SENTENCE_WORDS:
            merged[-2] = merged[-2] + " " + merged[-1]
            merged.pop()
        for part in merged:
            sentences.append({"text_en": part, "paragraph_index": paragraph_index})
    return sentences


def _generate_story_call(
    child_name: str,
    age: int,
    level: str,
    gender: str,
    interests: str = "",
    topic: str = "",
    rank_points: int | None = None,
    level_progress_percent: int | None = None,
    previous_story: dict | None = None,
    story_errors: list[str] | None = None,
    attempt_index: int = 0,
    force_provider: str | None = None,
) -> tuple[dict, dict]:
    """Call 1 of two-call pipeline: generate story only."""
    user_msg = build_story_only_user_message(
        child_name, age, level, gender, interests, topic,
        rank_points, level_progress_percent,
        previous_story=previous_story, story_errors=story_errors,
    )
    system_prompt = build_story_system_prompt(level)
    provider = (force_provider or resolve_provider_for_attempt(attempt_index)).lower()
    if provider == "openai":
        model = resolve_openai_model_for_level(level)
        return _generate_via_openai_v2(user_msg, model=model, system_prompt=system_prompt)
    return _generate_via_anthropic_v2(user_msg, system_prompt=system_prompt)


def _generate_activities_call(
    story: dict,
    level: str,
    child_name: str,
    topic: str = "",
    rank_points: int | None = None,
    level_progress_percent: int | None = None,
    previous_activities: list | None = None,
    activity_errors: list[str] | None = None,
    attempt_index: int = 0,
    force_provider: str | None = None,
) -> tuple[dict, dict]:
    """Call 2 of two-call pipeline: generate activities from a validated story."""
    user_msg = build_activity_from_story_user_message(
        story, level, child_name, topic,
        rank_points, level_progress_percent,
        previous_activities=previous_activities, activity_errors=activity_errors,
    )
    provider = (force_provider or resolve_provider_for_attempt(attempt_index)).lower()
    if provider == "openai":
        model = resolve_openai_model_for_level(level)
        return _generate_via_openai_v2(user_msg, model=model, system_prompt=ACTIVITY_FROM_STORY_SYSTEM_PROMPT)
    return _generate_via_anthropic_v2(user_msg, system_prompt=ACTIVITY_FROM_STORY_SYSTEM_PROMPT)


def _generate_guided_listening_via_openai(prompt: str) -> tuple[str, dict]:
    """Generate guided listening questions via OpenAI (lightweight model).

    Returns (raw_json_text, usage_dict).
    """
    client = OpenAI(api_key=_openai_api_key())
    model = "gpt-5-mini"

    response = client.chat.completions.create(
        model=model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": "You are a listening comprehension question generator. Output only JSON."},
            {"role": "user", "content": prompt},
        ],
        max_completion_tokens=4096,
        timeout=180.0,
        extra_body={"reasoning_effort": "low"},
    )
    choice = response.choices[0] if response.choices else None
    if not choice:
        raise ValueError(f"OpenAI returned no choices for guided_listening. model={model}")

    raw_text = (choice.message.content or "").strip()
    if not raw_text:
        raise ValueError(f"OpenAI returned empty content for guided_listening. model={model}")

    usage = getattr(response, "usage", None)
    gl_usage = {
        "provider": "openai",
        "model": model,
        "input_tokens": getattr(usage, "prompt_tokens", 0) if usage else 0,
        "output_tokens": getattr(usage, "completion_tokens", 0) if usage else 0,
    }
    return raw_text, gl_usage


def _generate_pack_two_call(
    child_name: str,
    age: int,
    level: str,
    gender: str,
    interests: str = "",
    topic: str = "",
    rank_points: int | None = None,
    level_progress_percent: int | None = None,
    force_provider: str | None = None,
) -> tuple[dict, dict]:
    """Two-call pipeline: story generation (Call 1) then activity generation (Call 2).

    Story retries are handled internally (up to 3 attempts) before proceeding to
    activity generation. Activity retries are also internal (up to 3 attempts) with
    the validated story preserved across attempts. The server's outer retry loop acts
    as a final safety net if the merged pack still fails full validation.
    """
    # --- Call 1: Story generation with internal retry ---
    story: dict = {}
    story_usage: dict = {}
    previous_story: dict | None = None
    story_errors: list[str] | None = None

    for story_attempt in range(3):
        raw, usage = _generate_story_call(
            child_name, age, level, gender, interests, topic,
            rank_points, level_progress_percent,
            previous_story=previous_story,
            story_errors=story_errors,
            attempt_index=story_attempt,
            force_provider=force_provider,
        )
        story_usage = usage
        candidate = raw.get("story") if isinstance(raw, dict) else None
        if not isinstance(candidate, dict):
            previous_story = None
            story_errors = ["story object missing from LLM response"]
            print(f"[two-call] story attempt {story_attempt}: no story object in response")
            continue

        # Server-side sentence splitting — LLM no longer produces sentences array
        paragraphs = candidate.get("paragraphs_en") or []
        if paragraphs and not candidate.get("sentences"):
            candidate["sentences"] = _split_paragraphs_into_sentences(paragraphs)

        valid, errors = validate_story_only(candidate, level)
        if valid:
            story = candidate
            print(
                f"[two-call] story attempt {story_attempt}: OK "
                f"({len(candidate.get('sentences', []))} sentences)"
            )
            break
        previous_story = candidate
        story_errors = errors
        print(f"[two-call] story attempt {story_attempt} failed: {errors[:3]}")
    else:
        # All story attempts failed — use last candidate as best effort so the
        # server's repair chain + validator can still try to salvage it.
        story = previous_story or {}
        if story.get("paragraphs_en") and not story.get("sentences"):
            story["sentences"] = _split_paragraphs_into_sentences(story["paragraphs_en"])
        print("[two-call] all story attempts failed, using last candidate for Call 2")

    # --- Call 2: Activity generation from the (validated or best-effort) story ---
    activities: list = []
    activity_usage: dict = {}
    previous_activities: list | None = None
    activity_errors: list[str] | None = None

    for act_attempt in range(3):
        raw, usage = _generate_activities_call(
            story, level, child_name, topic,
            rank_points, level_progress_percent,
            previous_activities=previous_activities,
            activity_errors=activity_errors,
            attempt_index=act_attempt,
            force_provider=force_provider,
        )
        activity_usage = usage
        candidate_acts = raw.get("activities") if isinstance(raw, dict) else None
        if isinstance(candidate_acts, list) and len(candidate_acts) == 4:
            activities = candidate_acts
            print(f"[two-call] activities attempt {act_attempt}: OK")
            break
        previous_activities = candidate_acts if isinstance(candidate_acts, list) else None
        count = len(candidate_acts) if isinstance(candidate_acts, list) else 0
        activity_errors = [f"activities list has {count} items, expected 4"]
        print(f"[two-call] activities attempt {act_attempt} failed ({count} activities)")

    # --- Call 3: Guided listening generation (LLM-based WH- comprehension questions) ---
    gl_usage_total: dict[str, int] = {"input_tokens": 0, "output_tokens": 0}

    def gl_fallback(prompt: str) -> str:
        raw, usage = _generate_guided_listening_via_openai(prompt)
        gl_usage_total["input_tokens"] += usage.get("input_tokens", 0)
        gl_usage_total["output_tokens"] += usage.get("output_tokens", 0)
        return raw

    try:
        pack = add_guided_listening(
            {"story": story, "activities": activities},
            llm_fallback=gl_fallback,
        )
        gl_model = "gpt-5-mini"
    except Exception as exc:
        print(f"[two-call] guided_listening generation failed, proceeding without: {exc}")
        pack = {"story": story, "activities": activities}
        gl_model = "failed"
    combined_usage = {
        "provider": story_usage.get("provider", "openai"),
        "model": story_usage.get("model", "unknown"),
        "input_tokens": (story_usage.get("input_tokens") or 0) + (activity_usage.get("input_tokens") or 0) + gl_usage_total["input_tokens"],
        "output_tokens": (story_usage.get("output_tokens") or 0) + (activity_usage.get("output_tokens") or 0) + gl_usage_total["output_tokens"],
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "two_call_story_model": story_usage.get("model"),
        "two_call_activity_model": activity_usage.get("model"),
        "two_call_gl_model": gl_model,
    }
    return pack, combined_usage


def _parse_json(raw_text: str) -> dict:
    raw_text = raw_text.strip()
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        if lines and lines[-1].strip() == "```":
            raw_text = "\n".join(lines[1:-1])
        else:
            raw_text = "\n".join(lines[1:])
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"V2 LLM returned invalid JSON: {e}\nRaw output (first 500 chars): {raw_text[:500]}"
        )
