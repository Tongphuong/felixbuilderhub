"""Smoke tests for V2 Read2Lead pack validator.

Phase V2 W1: minimum viable test coverage. Verifies the validator
accepts the fixture packs and rejects common breaks.
"""
from __future__ import annotations

from copy import deepcopy

import pytest

from validator_v2 import validate_pack_v2

from tests.fixtures.sample_pack_v2_l1 import minimal_l1_pack_v2
from tests.fixtures.sample_pack_v2_l3 import minimal_l3_pack_v2


# ---------------- Happy path ----------------

def test_minimal_l1_pack_v2_validates_ok():
    pack = minimal_l1_pack_v2()
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert ok, f"Expected pass, got errors: {errors}"
    assert errors == []


def test_minimal_l3_pack_v2_validates_ok():
    pack = minimal_l3_pack_v2()
    ok, errors = validate_pack_v2(pack, expected_level="L3")
    assert ok, f"Expected pass, got errors: {errors}"
    assert errors == []


# ---------------- Schema-level rejections ----------------

def test_missing_schema_version_allowed_for_lean_llm_shape():
    pack = minimal_l1_pack_v2()
    del pack["schema_version"]
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert ok, f"schema_version is server-derived in the lean LLM shape: {errors}"


def test_wrong_schema_version_rejected():
    pack = minimal_l1_pack_v2()
    pack["schema_version"] = 1
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok


def test_missing_activities_rejected():
    pack = minimal_l1_pack_v2()
    del pack["activities"]
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok


def test_wrong_activity_count_rejected():
    pack = minimal_l1_pack_v2()
    pack["activities"] = pack["activities"][:3]
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("activities" in e.lower() for e in errors)


# ---------------- Story-level rejections ----------------

def test_cost_cut_shape_without_unused_story_fields_validates():
    pack = minimal_l1_pack_v2()
    for field in ("level_label", "slug", "audio_filename", "parent_note_vi", "next_suggestion_vi"):
        pack.pop(field, None)
    pack["story"].pop("paragraphs_vi", None)
    pack["story"].pop("full_audio_url", None)
    for sentence in pack["story"]["sentences"]:
        sentence.pop("text_vi", None)
        sentence.pop("audio_url", None)
    for activity in pack["activities"]:
        for item in activity.get("items") or []:
            item.pop("audio_url", None)
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert ok, f"Expected lean cost-cut shape to validate, got: {errors}"


def test_story_word_count_too_low_l1_rejected():
    pack = minimal_l1_pack_v2()
    # New L1 floor is 50 words - use a 12-word story to ensure rejection
    pack["story"]["paragraphs_en"] = [
        "Mai sees a cat.",
        "Mai is happy.",
        "Mai pets the cat. Mai laughs.",
    ]
    pack["story"]["paragraphs_vi"] = ["Mai nhìn thấy mèo.", "Mai vui.", "Mai vuốt ve mèo. Mèo gừ gừ. Mai cười."]
    pack["story"]["sentences"] = pack["story"]["sentences"][:4]
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("word count" in e for e in errors)


def test_story_word_count_above_old_max_l1_accepted():
    """Long stories pass now — only min_words floor is enforced, not max_words."""
    pack = minimal_l1_pack_v2()
    pad = " Mai watches the little cat play in the warm sun. "
    for i, para in enumerate(pack["story"]["paragraphs_en"]):
        pack["story"]["paragraphs_en"][i] = para + pad * 8
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert ok, f"Expected long L1 story to pass (no max_words), got: {errors}"


def test_story_sentence_count_above_ceiling_l1_rejected():
    """Sentence ceiling is still enforced as a token/TTS cost guard."""
    pack = minimal_l1_pack_v2()
    extra = [
        {"text_en": f"Mai walks to the park number {i}.", "paragraph_index": 0}
        for i in range(25)
    ]
    pack["story"]["sentences"] = pack["story"]["sentences"] + extra
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("sentences count" in e for e in errors)


def test_sentence_not_in_paragraph_rejected():
    pack = minimal_l1_pack_v2()
    pack["story"]["sentences"][0]["text_en"] = "Mai walks to a dog."  # invented, not in story
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("not found verbatim" in e for e in errors)


# ---------------- Activity B (order) rejections ----------------

def test_listen_and_order_indices_not_permutation_rejected():
    pack = minimal_l1_pack_v2()
    pack["activities"][1]["items"][0]["correct_order_indices"] = [0, 0, 0, 0, 0]
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("permutation" in e for e in errors)


def test_listen_and_order_reconstruction_mismatch_rejected():
    pack = minimal_l1_pack_v2()
    # Swap two tokens — reconstruction will not match original_sentence
    item = pack["activities"][1]["items"][0]
    item["correct_order_indices"] = [4, 1, 3, 2, 0]  # wrong order
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("reconstructed" in e for e in errors)


def test_listen_and_order_original_not_in_story_rejected():
    pack = minimal_l1_pack_v2()
    pack["activities"][1]["items"][0]["original_sentence"] = "This is a totally new sentence."
    pack["activities"][1]["items"][0]["scrambled_tokens"] = ["sentence.", "is", "a", "new", "totally", "This"]
    pack["activities"][1]["items"][0]["correct_order_indices"] = [5, 1, 2, 4, 3, 0]
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("not found verbatim" in e for e in errors)


def test_listen_and_order_sentence_in_paragraph_but_missing_from_sentence_list_accepted():
    pack = minimal_l1_pack_v2()
    item = pack["activities"][1]["items"][4]
    original = item["original_sentence"]
    pack["story"]["sentences"] = [
        sentence for sentence in pack["story"]["sentences"]
        if sentence["text_en"] != original
    ]
    pack["activities"][3]["items"] = [
        i for i in pack["activities"][3]["items"]
        if i["text_en"] != original
    ]
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert ok, f"Expected paragraph-level story sentence match to pass, got: {errors}"


# ---------------- Activity A (listening fill blank) rejections ----------------

def test_listening_fill_blank_single_word_answer_allowed_if_present_in_source():
    pack = minimal_l1_pack_v2()
    pack["activities"][0]["items"][0]["options_en"][0] = "kitchen"
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert ok, f"Single-word drift should not fail the whole pack if answer is in source: {errors}"


def test_listening_fill_blank_source_not_in_story_rejected():
    pack = minimal_l1_pack_v2()
    pack["activities"][0]["items"][0]["source_sentence"] = "Pilot is on the moon."
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("activity[A]" in e and "not found verbatim" in e for e in errors)


# ---------------- Activity E (speak) rejections ----------------

def test_listen_and_speak_text_not_in_story_rejected():
    pack = minimal_l1_pack_v2()
    pack["activities"][3]["items"][0]["text_en"] = "An invented sentence not in the story."
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("activity[E]" in e and "not found verbatim" in e for e in errors)


def test_listen_and_speak_wrong_scoring_mode_rejected():
    pack = minimal_l1_pack_v2()
    pack["activities"][3]["scoring_mode"] = "whisper_stt"
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("scoring_mode" in e for e in errors)


# ---------------- Activity A/D (MCQ) rejections ----------------

def test_listening_fill_blank_correct_index_out_of_range_rejected():
    pack = minimal_l1_pack_v2()
    pack["activities"][0]["items"][0]["correct_index"] = 5
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok


def test_reading_comprehension_wrong_section_mix_rejected():
    pack = minimal_l1_pack_v2()
    # L1 expects ["Find It", "Find It", "Find It", "Find It", "Think About It"]
    pack["activities"][2]["questions"][0]["section"] = "Open Question"
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("section mix" in e for e in errors)


# ---------------- Level mismatch rejections ----------------

def test_level_mismatch_rejected():
    pack = minimal_l1_pack_v2()
    pack["level"] = "L2"
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("data.level" in e for e in errors)


def test_listen_and_order_missing_trailing_period_accepted():
    """Sonnet often scrambles tokens without preserving the trailing period.
    The validator should accept this - it's cosmetic, not a real ordering bug.
    Regression test for V2 W4.2 fix."""
    pack = minimal_l1_pack_v2()
    item = pack["activities"][1]["items"][0]
    # Original sentence in fixture ends with "cat." - drop the period from the
    # token that holds it ("cat." -> "cat") to simulate Sonnet's typical drift.
    tokens = list(item["scrambled_tokens"])
    for i, tok in enumerate(tokens):
        if tok.endswith("."):
            tokens[i] = tok.rstrip(".")
            break
    item["scrambled_tokens"] = tokens
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert ok, f"Expected pass after trailing-period normalization, got: {errors}"


def test_pack_without_trivia_vi_still_validates():
    pack = minimal_l1_pack_v2()
    del pack["story"]["trivia_vi"]
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert ok, f"Expected pass without trivia_vi, got: {errors}"


def test_trivia_vi_too_short_rejected():
    pack = minimal_l1_pack_v2()
    pack["story"]["trivia_vi"] = "Qua ngan."
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("trivia_vi" in err for err in errors)


def test_trivia_vi_too_long_rejected():
    pack = minimal_l1_pack_v2()
    pack["story"]["trivia_vi"] = "A" * 201
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert not ok
    assert any("trivia_vi" in err for err in errors)
