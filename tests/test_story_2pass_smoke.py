"""Smoke tests for V2.5 story 2-pass polish.

Exercises generate_pack_v2 with READ2LEAD_STORY_2PASS=1 and a mocked OpenAI
client. The draft call returns a full pack; the polish call is varied per test
(valid rewrite, raising, invalid response) to prove:

1. polish rewrites only the story and preserves activity content,
2. a polish exception falls back to the draft story without bubbling,
3. an invalid polish response falls back to the draft story and logs the reason.

No real OpenAI/Anthropic calls — everything is mocked.
"""
from __future__ import annotations

import copy
import json
import os
from unittest.mock import MagicMock, patch

from generator_v2 import generate_pack_v2

from tests.fixtures.sample_pack_v2_l1 import minimal_l1_pack_v2


def _openai_response(content: str):
    response = MagicMock()
    choice = MagicMock()
    choice.message = MagicMock(content=content)
    choice.finish_reason = "stop"
    response.choices = [choice]
    response.usage = MagicMock(prompt_tokens=120, completion_tokens=80)
    return response


def _draft_response():
    return _openai_response(json.dumps(minimal_l1_pack_v2()))


_POLISHED_STORY = {
    "title": "Pilot and the Golden Pancake",
    "paragraphs_en": [
        "Pilot wanted one perfect pancake. The kitchen smelled of warm milk.",
        "The first pancake stuck to the pan. He frowned, then tried again.",
        "This time it slid free, golden and round. Pilot grinned so wide his cheeks hurt.",
    ],
    "sentences": [
        {"text_en": "Pilot wanted one perfect pancake.", "paragraph_index": 0},
        {"text_en": "The kitchen smelled of warm milk.", "paragraph_index": 0},
        {"text_en": "The first pancake stuck to the pan.", "paragraph_index": 1},
        {"text_en": "He frowned, then tried again.", "paragraph_index": 1},
        {"text_en": "This time it slid free, golden and round.", "paragraph_index": 2},
        {"text_en": "Pilot grinned so wide his cheeks hurt.", "paragraph_index": 2},
    ],
    "trivia_vi": "Nha Felix hay lam pancake vang uom vao sang cuoi tuan.",
}


@patch.dict(
    os.environ,
    {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test", "READ2LEAD_STORY_2PASS": "1"},
)
def test_polish_preserves_activity_content():
    draft_pack = minimal_l1_pack_v2()
    expected_activities = copy.deepcopy(draft_pack["activities"])

    with patch("generator_v2.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [
            _openai_response(json.dumps(draft_pack)),
            _openai_response(json.dumps({"story": _POLISHED_STORY})),
        ]
        mock_openai_cls.return_value = mock_client

        pack, usage = generate_pack_v2("Pilot", 7, "L1", "boy", attempt_index=0)

    # Story was rewritten by pass 2 ...
    assert pack["story"]["title"] == "Pilot and the Golden Pancake"
    assert usage["polish_model"] == "gpt-5.4-mini"
    assert usage["polish_input_tokens"] == 120
    assert usage["polish_output_tokens"] == 80
    # ... but activities are untouched by the polish pass.
    assert pack["activities"] == expected_activities
    assert mock_client.chat.completions.create.call_count == 2


@patch.dict(
    os.environ,
    {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test", "READ2LEAD_STORY_2PASS": "1"},
)
def test_polish_failure_falls_back_to_draft(capsys):
    draft_pack = minimal_l1_pack_v2()
    draft_story = copy.deepcopy(draft_pack["story"])

    with patch("generator_v2.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [
            _openai_response(json.dumps(draft_pack)),
            RuntimeError("openai polish boom"),
        ]
        mock_openai_cls.return_value = mock_client

        pack, usage = generate_pack_v2("Pilot", 7, "L1", "boy", attempt_index=0)

    # No exception bubbled; story is the original draft.
    assert pack["story"] == draft_story
    assert "polish_model" not in usage
    assert "[story-2pass] polish failed" in capsys.readouterr().out


@patch.dict(
    os.environ,
    {"ANTHROPIC_API_KEY": "test", "OPENAI_API_KEY": "test", "READ2LEAD_STORY_2PASS": "1"},
)
def test_polish_invalid_response_falls_back(capsys):
    draft_pack = minimal_l1_pack_v2()
    draft_story = copy.deepcopy(draft_pack["story"])

    # Polish returns a story object missing required keys (paragraphs_en, sentences, trivia_vi).
    with patch("generator_v2.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [
            _openai_response(json.dumps(draft_pack)),
            _openai_response(json.dumps({"story": {"title": "only a title"}})),
        ]
        mock_openai_cls.return_value = mock_client

        pack, usage = generate_pack_v2("Pilot", 7, "L1", "boy", attempt_index=0)

    assert pack["story"] == draft_story
    assert "polish_model" not in usage
    out = capsys.readouterr().out
    assert "polish failed" in out
    assert "missing keys" in out
