"""Tests for guided listening Q&A generation (v3 — WH- comprehension questions)."""

import json
import time

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
    assert "exact sentence_index sequence: 0, 0, 1, 1" in prompt


def test_generate_guided_listening_counts():
    guided = generate_guided_listening(
        _simple_story(),
        llm_fallback=_mock_llm_fallback,
    )
    assert len(guided) == 2  # 2 paragraphs
    assert len(guided[0]["questions"]) == 4  # 2 sentences × 2 questions
    assert len(guided[1]["questions"]) == 4


def test_guided_listening_accepts_whose_comprehension_question():
    questions = _parse_llm_questions(_mock_llm_fallback("[0] one sentence"))
    questions[0]["question_en"] = "Whose tiffin looks yummy?"

    assert _valid_v3_questions(questions, 1)


def test_guided_listening_accepts_which_comprehension_question():
    questions = _parse_llm_questions(_mock_llm_fallback("[0] one sentence"))
    questions[0]["question_en"] = "Which bird does Mai see?"

    assert _valid_v3_questions(questions, 1)


def test_generate_guided_listening_repairs_indexes_from_required_order():
    calls = 0

    def fallback(_prompt):
        nonlocal calls
        calls += 1
        questions = json.loads(_mock_llm_comprehension_questions(2))["questions"]
        for question in questions:
            question["sentence_index"] = 999
        return {"questions": questions}

    guided = generate_guided_listening(_simple_story(), llm_fallback=fallback)

    assert calls == 2
    assert [q["sentence_index"] for q in guided[0]["questions"]] == [0, 0, 1, 1]
    assert [q["sentence_index"] for q in guided[1]["questions"]] == [2, 2, 3, 3]


def test_generate_guided_listening_wraps_non_wh_question_without_retry():
    calls = 0

    def fallback(prompt):
        nonlocal calls
        calls += 1
        questions = json.loads(_mock_llm_fallback(prompt))["questions"]
        questions[0]["question_en"] = "Did Mai go to the park?"
        return {"questions": questions}

    guided = generate_guided_listening(_simple_story(), llm_fallback=fallback)

    assert calls == 2
    assert guided[0]["questions"][0]["question_en"] == (
        "What is the correct answer to this question: Did Mai go to the park?"
    )


def test_generate_guided_listening_reuses_valid_completed_pages():
    original = generate_guided_listening(
        _simple_story(), llm_fallback=_mock_llm_fallback
    )
    calls = []
    completed = []

    def fallback(prompt):
        calls.append(prompt)
        return _mock_llm_fallback(prompt)

    resumed = generate_guided_listening(
        _simple_story(),
        llm_fallback=fallback,
        completed_entries=[original[0]],
        on_paragraph_complete=completed.append,
        max_workers=3,
    )

    assert resumed == original
    assert len(calls) == 1
    assert [entry["paragraph_index"] for entry in completed] == [1]


def test_generate_guided_listening_does_not_retry_insufficient_quota():
    class QuotaError(RuntimeError):
        code = "insufficient_quota"

    calls = 0

    def fallback(_prompt):
        nonlocal calls
        calls += 1
        raise QuotaError("billing quota exhausted")

    story = {
        "paragraphs_en": ["Mai goes to the park with Mom."],
        "sentences": [
            {"text_en": "Mai goes to the park with Mom.", "paragraph_index": 0}
        ],
    }
    with pytest.raises(QuotaError, match="billing quota exhausted"):
        generate_guided_listening(story, llm_fallback=fallback)

    assert calls == 1


def test_generate_guided_listening_still_retries_transient_rate_limit():
    class TransientRateLimit(RuntimeError):
        code = "rate_limit_exceeded"

    calls = 0

    def fallback(prompt):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise TransientRateLimit("try later")
        return _mock_llm_fallback(prompt)

    story = {
        "paragraphs_en": ["Mai goes to the park with Mom."],
        "sentences": [
            {"text_en": "Mai goes to the park with Mom.", "paragraph_index": 0}
        ],
    }
    guided = generate_guided_listening(story, llm_fallback=fallback)

    assert calls == 2
    assert len(guided[0]["questions"]) == 2


def test_parallel_quota_failure_cancels_queued_paragraph_calls():
    class QuotaError(RuntimeError):
        code = "insufficient_quota"

    calls = 0

    def fallback(_prompt):
        nonlocal calls
        calls += 1
        time.sleep(0.02)
        raise QuotaError("billing quota exhausted")

    story = {
        "paragraphs_en": [f"Paragraph {index} has enough words." for index in range(12)],
        "sentences": [
            {
                "text_en": f"Paragraph {index} has enough words.",
                "paragraph_index": index,
            }
            for index in range(12)
        ],
    }
    with pytest.raises(QuotaError, match="billing quota exhausted"):
        generate_guided_listening(story, llm_fallback=fallback, max_workers=3)

    assert 1 <= calls <= 3


def test_generate_guided_listening_gives_validation_feedback_on_retry():
    prompts = []

    def fallback(prompt):
        prompts.append(prompt)
        if len(prompts) == 1:
            return json.dumps({
                "questions": [{
                    "sentence_index": 0,
                    "question_en": "Who goes to the park?",
                    "options_en": ["Mai", "Mom", "A friend"],
                    "correct_index": 0,
                }],
            })
        return _mock_llm_fallback(prompt)

    guided = generate_guided_listening(_simple_story(), llm_fallback=fallback)

    assert len(guided[0]["questions"]) == 4
    assert "CORRECTION FOR RETRY" in prompts[1]
    assert "sentence_index 0 has 1 questions; expected exactly 2" in prompts[1]


def test_generate_guided_listening_can_recover_on_third_attempt():
    prompts = []

    def fallback(prompt):
        prompts.append(prompt)
        if len(prompts) < 3:
            return json.dumps({"questions": []})
        return _mock_llm_fallback(prompt)

    guided = generate_guided_listening(_simple_story(), llm_fallback=fallback)

    assert len(guided[0]["questions"]) == 4
    assert len(prompts) >= 3
    assert "CORRECTION FOR RETRY" in prompts[2]


def test_generate_guided_listening_passes_count_to_count_aware_fallback():
    calls = []

    def fallback_with_count(prompt, sentence_count):
        calls.append((prompt, sentence_count))
        return _mock_llm_fallback(prompt)

    guided = generate_guided_listening(
        _simple_story(),
        llm_fallback_with_count=fallback_with_count,
    )

    assert [sentence_count for _, sentence_count in calls] == [2, 2]
    assert len(guided) == 2


def test_generate_guided_listening_reports_specific_validation_error():
    invalid_response = json.dumps({
        "questions": [{
            "sentence_index": 0,
            "question_en": "Who goes to the park?",
            "options_en": ["Mai", "Mom", "A friend"],
            "correct_index": 0,
        }],
    })

    with pytest.raises(
        ValueError,
        match="sentence_index 0 has 1 questions; expected exactly 2",
    ):
        generate_guided_listening(
            _simple_story(),
            llm_fallback=lambda _prompt: invalid_response,
        )


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


# ── Parallel processing tests ──────────────────────────────────────────────────


def test_generate_guided_listening_parallel_preserves_ordering():
    """max_workers=3 should produce the same output as serial (ordered by paragraph_index)."""
    story = _simple_story()
    serial_result = generate_guided_listening(story, llm_fallback=_mock_llm_fallback)
    parallel_result = generate_guided_listening(
        story, llm_fallback=_mock_llm_fallback, max_workers=3
    )
    assert len(parallel_result) == len(serial_result) == 2
    for i in range(len(serial_result)):
        assert parallel_result[i]["paragraph_index"] == serial_result[i]["paragraph_index"]
        assert len(parallel_result[i]["questions"]) == len(serial_result[i]["questions"])
        for j in range(len(serial_result[i]["questions"])):
            assert (
                parallel_result[i]["questions"][j]["sentence_index"]
                == serial_result[i]["questions"][j]["sentence_index"]
            )


def test_generate_guided_listening_max_workers_one_is_serial():
    """max_workers=1 should behave identically to the default (serial)."""
    story = _simple_story()
    default_result = generate_guided_listening(story, llm_fallback=_mock_llm_fallback)
    serial_result = generate_guided_listening(
        story, llm_fallback=_mock_llm_fallback, max_workers=1
    )
    assert len(serial_result) == len(default_result)
    for i in range(len(default_result)):
        assert serial_result[i]["paragraph_index"] == default_result[i]["paragraph_index"]


def test_generate_guided_listening_parallel_sentence_indexes_correct():
    """Parallel processing still assigns correct global sentence indexes."""
    story = _simple_story()
    guided = generate_guided_listening(
        story, llm_fallback=_mock_llm_fallback, max_workers=3
    )
    # Paragraph 0: sentence indexes 0, 1
    para0_indexes = {q["sentence_index"] for q in guided[0]["questions"]}
    assert para0_indexes == {0, 1}
    # Paragraph 1: sentence indexes 2, 3
    para1_indexes = {q["sentence_index"] for q in guided[1]["questions"]}
    assert para1_indexes == {2, 3}
