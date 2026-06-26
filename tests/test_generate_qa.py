"""Tests for guided listening Q&A generation (v3 — WH- comprehension questions)."""

import json

import pytest

from generate_qa import (
    _parse_llm_questions,
    _valid_v3_questions,
    add_guided_listening,
    build_guided_listening_prompt,
    generate_guided_listening,
)
from validator_v2 import validate_guided_listening, validate_pack_v2


# ── Test data ──────────────────────────────────────────────────────────────────


def _simple_story():
    return {
        "paragraphs_en": [
            "Mai goes to the park with Mom. The park has a big tree.",
            "Mai sees a red bird. The bird sings a song.",
        ],
        "sentences": [
            {"text_en": "Mai goes to the park with Mom.", "paragraph_index": 0},
            {"text_en": "The park has a big tree.", "paragraph_index": 0},
            {"text_en": "Mai sees a red bird.", "paragraph_index": 1},
            {"text_en": "The bird sings a song.", "paragraph_index": 1},
        ],
    }


def minimal_l1_pack_v2():
    return {
        "story": {
            "title": "Test Story",
            "paragraphs_en": [
                "Mai goes to the park with Mom.",
                "She sees a red bird.",
            ],
            "sentences": [
                {"text_en": "Mai goes to the park with Mom.", "paragraph_index": 0},
                {"text_en": "She sees a red bird.", "paragraph_index": 1},
            ],
        },
        "activities": [],
    }


def _mock_llm_comprehension_questions(sentence_count: int) -> str:
    """Return a JSON string with valid v3 WH- comprehension questions."""
    questions = []
    wh_words = ["Who", "What", "Where"]
    for si in range(sentence_count):
        for qn in (1, 2):
            questions.append({
                "type": "choice",
                "sentence_index": si,
                "question_en": f"{wh_words[si % 3]} went to the park?",
                "options_en": ["Mai", "Her mom", "A friend"],
                "correct_index": 0,
            })
    return json.dumps({"questions": questions})


def _mock_llm_fallback(text: str) -> str:
    """Count sentences from the prompt and return matching questions."""
    # Count how many [N] sentence markers are in the prompt
    import re
    count = len(re.findall(r"\[\d+\]", text))
    if count == 0:
        count = 2  # fallback
    return _mock_llm_comprehension_questions(count)


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_build_guided_listening_prompt_includes_sentences():
    prompt = build_guided_listening_prompt(
        "Mai goes to the park. She sees a bird.",
        ["Mai goes to the park.", "She sees a bird."],
    )
    assert "[0]" in prompt
    assert "[1]" in prompt
    assert "Mai goes to the park" in prompt
    assert "WH-" in prompt or "Who" in prompt or "comprehension" in prompt.lower()


def test_generate_guided_listening_counts():
    guided = generate_guided_listening(
        _simple_story(),
        llm_fallback=_mock_llm_fallback,
    )
    assert len(guided) == 2  # 2 paragraphs
    assert len(guided[0]["questions"]) == 4  # 2 sentences × 2 questions
    assert len(guided[1]["questions"]) == 4


def test_generate_guided_listening_all_choice_type():
    guided = generate_guided_listening(
        _simple_story(),
        llm_fallback=_mock_llm_fallback,
    )
    for entry in guided:
        for q in entry["questions"]:
            assert q["type"] == "choice"


def test_generate_guided_listening_sentence_indexes():
    guided = generate_guided_listening(
        _simple_story(),
        llm_fallback=_mock_llm_fallback,
    )
    # Paragraph 0: sentence indexes 0, 1
    para0_indexes = {q["sentence_index"] for q in guided[0]["questions"]}
    assert para0_indexes == {0, 1}
    # Paragraph 1: sentence indexes 2, 3
    para1_indexes = {q["sentence_index"] for q in guided[1]["questions"]}
    assert para1_indexes == {2, 3}


def test_generate_guided_listening_no_translate_batch():
    """v3 does not use translate_batch — questions are English-only."""
    guided = generate_guided_listening(
        _simple_story(),
        llm_fallback=_mock_llm_fallback,
    )
    for entry in guided:
        for q in entry["questions"]:
            assert "question_vi" not in q
            assert "options_vi" not in q


def test_no_vietnamese_in_questions():
    guided = generate_guided_listening(
        _simple_story(),
        llm_fallback=_mock_llm_fallback,
    )
    for entry in guided:
        for q in entry["questions"]:
            assert "question_vi" not in q
            assert "options_vi" not in q


def test_requires_llm_fallback():
    with pytest.raises(ValueError, match="llm_fallback"):
        generate_guided_listening(_simple_story())


def test_validator_accepts_well_formed_guided_listening():
    pack = add_guided_listening(
        minimal_l1_pack_v2(),
        llm_fallback=_mock_llm_fallback,
    )
    ok, errors = validate_guided_listening(pack)
    assert ok, f"Expected valid, got errors: {errors}"


def test_validator_rejects_empty_questions():
    pack = add_guided_listening(
        minimal_l1_pack_v2(),
        llm_fallback=_mock_llm_fallback,
    )
    pack["guided_listening"][0]["questions"] = []
    ok, errors = validate_guided_listening(pack)
    assert not ok


def test_validator_rejects_wrong_question_count():
    pack = add_guided_listening(
        minimal_l1_pack_v2(),
        llm_fallback=_mock_llm_fallback,
    )
    # Should have 2 questions (1 sentence × 2) but we add an extra
    extra = dict(pack["guided_listening"][0]["questions"][0])
    extra["id"] = "gl_p0_s0_q3"
    pack["guided_listening"][0]["questions"].append(extra)
    ok, errors = validate_guided_listening(pack)
    assert not ok


def test_validator_rejects_non_choice_type():
    pack = add_guided_listening(
        minimal_l1_pack_v2(),
        llm_fallback=_mock_llm_fallback,
    )
    pack["guided_listening"][0]["questions"][0]["type"] = "yes_no"
    ok, errors = validate_guided_listening(pack)
    assert not ok


def test_validator_rejects_vietnamese_fields():
    pack = add_guided_listening(
        minimal_l1_pack_v2(),
        llm_fallback=_mock_llm_fallback,
    )
    pack["guided_listening"][0]["questions"][0]["question_vi"] = "Ai đi công viên?"
    ok, errors = validate_guided_listening(pack)
    assert not ok


def test_validator_rejects_wrong_option_count():
    pack = add_guided_listening(
        minimal_l1_pack_v2(),
        llm_fallback=_mock_llm_fallback,
    )
    pack["guided_listening"][0]["questions"][0]["options_en"] = ["A", "B"]
    ok, errors = validate_guided_listening(pack)
    assert not ok


def test_validator_rejects_invalid_sentence_index():
    pack = add_guided_listening(
        minimal_l1_pack_v2(),
        llm_fallback=_mock_llm_fallback,
    )
    pack["guided_listening"][0]["questions"][0]["sentence_index"] = 999
    ok, errors = validate_guided_listening(pack)
    assert not ok


def test_validator_rejects_wrong_paragraph_sentence_index():
    pack = add_guided_listening(
        minimal_l1_pack_v2(),
        llm_fallback=_mock_llm_fallback,
    )
    # Set sentence_index to a sentence from wrong paragraph
    pack["guided_listening"][0]["questions"][0]["sentence_index"] = 1  # belongs to paragraph 1
    ok, errors = validate_guided_listening(pack)
    assert not ok


def test_validator_rejects_paragraph_count_mismatch():
    pack = add_guided_listening(
        minimal_l1_pack_v2(),
        llm_fallback=_mock_llm_fallback,
    )
    pack["guided_listening"] = pack["guided_listening"][:-1]
    ok, errors = validate_guided_listening(pack)
    assert not ok


def test_parse_llm_questions_handles_dict_with_questions_key():
    raw_dict = {"questions": [
        {"type": "choice", "sentence_index": 0, "question_en": "Who?", "options_en": ["A", "B", "C"], "correct_index": 0},
        {"type": "choice", "sentence_index": 0, "question_en": "What?", "options_en": ["A", "B", "C"], "correct_index": 1},
    ]}
    result = _parse_llm_questions(raw_dict)
    assert len(result) == 2


def test_parse_llm_questions_handles_string():
    raw = json.dumps({"questions": [
        {"type": "choice", "sentence_index": 0, "question_en": "Who?", "options_en": ["A", "B", "C"], "correct_index": 0},
        {"type": "choice", "sentence_index": 0, "question_en": "What?", "options_en": ["A", "B", "C"], "correct_index": 1},
    ]})
    result = _parse_llm_questions(raw)
    assert len(result) == 2


def test_valid_v3_questions_correct():
    questions = [
        {"sentence_index": 0, "type": "choice", "type": "choice", "question_en": "Who goes there?", "options_en": ["A", "B", "C"], "correct_index": 0},
        {"sentence_index": 0, "type": "choice", "type": "choice", "question_en": "What is it?", "options_en": ["A", "B", "C"], "correct_index": 1},
    ]
    assert _valid_v3_questions(questions, 1)


def test_valid_v3_questions_wrong_count_per_sentence():
    questions = [
        {"sentence_index": 0, "type": "choice", "type": "choice", "question_en": "Who goes there?", "options_en": ["A", "B", "C"], "correct_index": 0},
        # only 1 question for sentence 0
    ]
    assert not _valid_v3_questions(questions, 1)


def test_valid_v3_questions_rejects_yes_no():
    questions = [
        {"sentence_index": 0, "type": "yes_no", "question_en": "Is it true?", "options_en": ["A", "B", "C"], "correct_index": 0},
        {"sentence_index": 0, "type": "choice", "type": "choice", "question_en": "What is it?", "options_en": ["A", "B", "C"], "correct_index": 1},
    ]
    assert not _valid_v3_questions(questions, 1)


def test_valid_v3_questions_rejects_vietnamese():
    questions = [
        {"sentence_index": 0, "type": "choice", "question_en": "Who?", "options_en": ["A", "B", "C"], "correct_index": 0, "question_vi": "Ai?"},
        {"sentence_index": 0, "type": "choice", "question_en": "What?", "options_en": ["A", "B", "C"], "correct_index": 1},
    ]
    assert not _valid_v3_questions(questions, 1)
