"""Tests for V2 model routing and retry wiring.

Verifies routing:
- Attempts 1-2: gpt-5.4-mini (all levels)
- Attempt 3: Anthropic Opus 4.6 fallback

All tests use mocking — no real OpenAI/Anthropic calls.
"""
from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

from generator_v2 import (
    _build_previous_pack_context_v2,
    _generate_pack_two_call,
    generate_pack_v2,
    resolve_openai_model_for_level,
    resolve_provider_for_attempt,
    story_2pass_enabled,
)

from tests.fixtures.sample_pack_v2_l1 import minimal_l1_pack_v2


def _fake_openai_draft_with_story():
    """OpenAI draft response whose content is a pack dict containing a story."""
    pack_json = (
        '{"story": {"title": "Draft", "paragraphs_en": ["Bin runs. Bin jumps."], '
        '"sentences": [{"text_en": "Bin runs.", "paragraph_index": 0}]}, '
        '"activities": []}'
    )
    return _fake_openai_response(pack_json)


_POLISHED_STORY = {
    "title": "Bin and the Lost Kite",
    "paragraphs_en": ["Bin wanted his red kite to fly."],
    "sentences": [{"text_en": "Bin wanted his red kite to fly.", "paragraph_index": 0}],
    "trivia_vi": "Mot su that nho ve dieu sao.",
}


def test_resolve_provider_openai_for_first_two_attempts():
    assert resolve_provider_for_attempt(0) == "openai"
    assert resolve_provider_for_attempt(1) == "openai"
    assert resolve_provider_for_attempt(2) == "anthropic"
    assert resolve_provider_for_attempt(3) == "anthropic"


def test_resolve_openai_model_by_level():
    assert resolve_openai_model_for_level("L1") == "gpt-5.4-mini"
    assert resolve_openai_model_for_level("l2") == "gpt-5.4-mini"
    assert resolve_openai_model_for_level("L3") == "gpt-5.4-mini"
    assert resolve_openai_model_for_level("L4") == "gpt-5.4-mini"
    assert resolve_openai_model_for_level("L5") == "gpt-5.4-mini"


@patch.dict(os.environ, {"OPENAI_MODEL_V2": "custom-model"})
def test_resolve_openai_model_respects_env_override():
    assert resolve_openai_model_for_level("L1") == "custom-model"
    assert resolve_openai_model_for_level("L5") == "custom-model"


def _fake_anthropic_response():
    msg = MagicMock()
    msg.content = [MagicMock(text='{"ok": true, "from": "anthropic"}')]
    msg.usage = MagicMock(
        input_tokens=100,
        output_tokens=50,
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
    )
    return msg


def _fake_openai_response(text='{"ok": true, "from": "openai"}'):
    response = MagicMock()
    choice = MagicMock()
    choice.message = MagicMock(content=text)
    choice.finish_reason = "stop"
    response.choices = [choice]
    response.usage = MagicMock(
        prompt_tokens=100,
        completion_tokens=50,
        completion_tokens_details=MagicMock(reasoning_tokens=10),
    )
    return response


@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test"})
def test_attempt_zero_l2_uses_gpt54_mini():
    with patch("generator_v2.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_openai_response()
        mock_openai_cls.return_value = mock_client

        _, usage = generate_pack_v2("Bin", 7, "L2", "boy", attempt_index=0)

        assert usage["provider"] == "openai"
        assert usage["model"] == "gpt-5.4-mini"
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["model"] == "gpt-5.4-mini"


@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test"})
def test_attempt_zero_l4_uses_gpt54_mini():
    with patch("generator_v2.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_openai_response()
        mock_openai_cls.return_value = mock_client

        _, usage = generate_pack_v2("Mai", 11, "L4", "girl", attempt_index=0)

        assert usage["provider"] == "openai"
        assert usage["model"] == "gpt-5.4-mini"
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["model"] == "gpt-5.4-mini"


@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test"})
def test_attempt_two_uses_sonnet_fallback():
    with patch("generator_v2.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _fake_anthropic_response()
        mock_anthropic_cls.return_value = mock_client

        _, usage = generate_pack_v2("Bin", 7, "L2", "boy", attempt_index=2)

        assert usage["provider"] == "anthropic"
        mock_client.messages.create.assert_called_once()
        mock_anthropic_cls.assert_called_once()


@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test"})
def test_openai_reasoning_effort_is_low():
    with patch("generator_v2.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_openai_response()
        mock_openai_cls.return_value = mock_client

        generate_pack_v2("Bin", 7, "L1", "boy", attempt_index=0)

        kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert kwargs["extra_body"]["reasoning_effort"] == "low"


@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test"})
def test_previous_pack_context_appears_in_openai_retry():
    with patch("generator_v2.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_openai_response()
        mock_openai_cls.return_value = mock_client

        prev_pack = minimal_l1_pack_v2()
        validation_errors = ["story.paragraphs_en word count OUT OF RANGE"]

        generate_pack_v2(
            "Bin", 6, "L1", "boy",
            validation_errors=validation_errors,
            previous_pack=prev_pack,
            attempt_index=1,
        )

        user_msg = mock_client.chat.completions.create.call_args.kwargs["messages"][-1]["content"]
        assert "PREVIOUS ATTEMPT" in user_msg
        assert "FIX STRATEGY" in user_msg


def test_build_previous_pack_context_empty_without_story():
    assert _build_previous_pack_context_v2({}, []) == ""
    assert _build_previous_pack_context_v2({"story": {}}, []) == ""


# ---------------- V2.5 story 2-pass flag gating ----------------

@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test"})
def test_story_2pass_flag_off_skips_polish():
    os.environ.pop("READ2LEAD_STORY_2PASS", None)
    assert story_2pass_enabled() is False
    with patch("generator_v2.OpenAI") as mock_openai_cls, \
            patch("generator_v2._generate_via_openai_polish") as mock_polish:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_openai_draft_with_story()
        mock_openai_cls.return_value = mock_client

        pack, usage = generate_pack_v2("Bin", 7, "L1", "boy", attempt_index=0)

        mock_polish.assert_not_called()
        assert "polish_model" not in usage
        assert pack["story"]["title"] == "Draft"


@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test", "READ2LEAD_STORY_2PASS": "1"})
def test_story_2pass_flag_on_invokes_polish():
    assert story_2pass_enabled() is True
    with patch("generator_v2.OpenAI") as mock_openai_cls, \
            patch("generator_v2._generate_via_openai_polish", return_value=dict(_POLISHED_STORY)) as mock_polish:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_openai_draft_with_story()
        mock_openai_cls.return_value = mock_client

        pack, usage = generate_pack_v2("Bin", 7, "L1", "boy", attempt_index=0)

        mock_polish.assert_called_once()
        # Draft generated first, then polish swaps in the rewritten story.
        assert pack["story"]["title"] == "Bin and the Lost Kite"
        assert usage["polish_model"] == "gpt-5.4-mini"


@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test", "READ2LEAD_STORY_2PASS": "1"})
def test_story_2pass_only_on_attempt_zero():
    assert story_2pass_enabled() is True
    with patch("generator_v2.OpenAI") as mock_openai_cls, \
            patch("generator_v2._generate_via_openai_polish") as mock_polish:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _fake_openai_draft_with_story()
        mock_openai_cls.return_value = mock_client

        # attempt_index=1 is still the OpenAI path, but polish only runs on attempt 0.
        pack, usage = generate_pack_v2("Bin", 7, "L1", "boy", attempt_index=1)

        mock_polish.assert_not_called()
        assert pack["story"]["title"] == "Draft"


@patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test"})
def test_force_provider_override_for_tests():
    with patch("generator_v2.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _fake_anthropic_response()
        mock_anthropic_cls.return_value = mock_client

        _, usage = generate_pack_v2(
            "Bin", 7, "L2", "boy",
            attempt_index=0,
            force_provider="anthropic",
        )
        assert usage["provider"] == "anthropic"


def test_two_call_adds_wh_comprehension_questions_per_sentence():
    """v3: 2 WH- comprehension questions per sentence, all choice type."""
    story = {
        "title": "Mia at the Park",
        "paragraphs_en": ["Mia goes to the park. Mia sees a red bird. Mia claps her hands and laughs."],
        "sentences": [
            {"text_en": "Mia goes to the park.", "paragraph_index": 0},
            {"text_en": "Mia sees a red bird.", "paragraph_index": 0},
            {"text_en": "Mia claps her hands and laughs.", "paragraph_index": 0},
        ],
        "trivia_vi": "Mia tham cong vien.",
    }
    usage = {
        "provider": "openai",
        "model": "test-model",
        "input_tokens": 10,
        "output_tokens": 5,
    }

    gl_mock_response = json.dumps({
        "questions": [
            {"type": "choice", "sentence_index": 0, "question_en": "Who goes to the park?", "options_en": ["Mia", "Her mom", "Her dad"], "correct_index": 0, "answerable_from_sentence": True},
            {"type": "choice", "sentence_index": 0, "question_en": "Where does Mia go?", "options_en": ["To the park", "To school", "To the market"], "correct_index": 0, "answerable_from_sentence": True},
            {"type": "choice", "sentence_index": 1, "question_en": "What does Mia see?", "options_en": ["A red bird", "A blue kite", "A big dog"], "correct_index": 0, "answerable_from_sentence": True},
            {"type": "choice", "sentence_index": 1, "question_en": "Where is the bird?", "options_en": ["In a tree", "On the ground", "In the sky"], "correct_index": 0, "answerable_from_sentence": True},
            {"type": "choice", "sentence_index": 2, "question_en": "What does Mia do?", "options_en": ["She claps", "She cries", "She runs"], "correct_index": 0, "answerable_from_sentence": True},
            {"type": "choice", "sentence_index": 2, "question_en": "How does Mia feel?", "options_en": ["Happy", "Sad", "Angry"], "correct_index": 0, "answerable_from_sentence": True},
        ]
    })

    with patch(
        "generator_v2._generate_story_call",
        return_value=({"story": story}, usage),
    ), patch(
        "generator_v2.validate_story_only",
        return_value=(True, []),
    ), patch(
        "generator_v2._generate_activities_call",
        return_value=({"activities": [{}, {}, {}, {}]}, usage),
    ), patch(
        "generator_v2._generate_guided_listening_via_openai",
        return_value=(gl_mock_response, {"input_tokens": 50, "output_tokens": 30}),
    ):
        pack, _ = _generate_pack_two_call("Mia", 7, "L1", "girl")

    questions = pack["guided_listening"][0]["questions"]
    # 3 sentences × 2 questions = 6
    assert len(questions) == 6
    # All questions are choice type
    for q in questions:
        assert q["type"] == "choice"
        assert len(q["options_en"]) == 3
        assert "question_vi" not in q
