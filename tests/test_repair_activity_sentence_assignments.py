"""Tests for deterministic activity sentence assignment repair (L3 gen root cause)."""
from __future__ import annotations

import copy
import os

from tests.fixtures.sample_pack_v2_l3 import minimal_l3_pack_v2

for key in [
    "ANTHROPIC_API_KEY",
    "READ2LEAD_BACKEND_SECRET",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
    "OPENAI_API_KEY",
]:
    os.environ.setdefault(key, "test")


def _run_full_repair_pipeline(pack: dict, *, level: str = "L3") -> dict:
    from server import (
        _hydrate_v2_pack_defaults,
        _repair_activity_b_tokens,
        _repair_activity_sentence_assignments,
        _repair_story_sentences,
        _rotate_v2_mcq_answers,
    )

    pack = _hydrate_v2_pack_defaults(
        pack,
        child_name=pack.get("student_name") or "Linh",
        level=level,
        topic="imagination",
    )
    pack = _repair_story_sentences(pack)
    pack = _repair_activity_sentence_assignments(pack)
    pack = _repair_activity_b_tokens(pack)
    pack = _rotate_v2_mcq_answers(pack)
    return pack


def test_placeholder_order_and_speak_refs_replaced():
    from validator_v2 import validate_pack_v2

    pack = minimal_l3_pack_v2()
    for activity in pack["activities"]:
        if activity["type"] == "listen_and_order":
            for item in activity["items"]:
                item["original_sentence"] = "A"
                item["id"] = 1
        elif activity["type"] == "listen_and_speak":
            for item in activity["items"]:
                item["text_en"] = "A"
                item["id"] = 1

    repaired = _run_full_repair_pipeline(pack, level="L3")

    assert all(isinstance(item["id"], str) for item in repaired["activities"][0]["items"])
    assert all(item["original_sentence"] != "A" for item in repaired["activities"][1]["items"])
    assert all(item["text_en"] != "A" for item in repaired["activities"][3]["items"])

    ok, errors = validate_pack_v2(repaired, expected_level="L3")
    assert ok, errors


def test_invalid_fill_blank_source_is_not_reassigned_away_from_translation():
    from validator_v2 import validate_pack_v2

    pack = minimal_l3_pack_v2()
    item = pack["activities"][0]["items"][0]
    invalid_source = "This sentence never appears in the story."
    item["source_sentence"] = invalid_source
    expected_translation = "Bản dịch phải tiếp tục thuộc về câu tiếng Anh ban đầu."
    item["explanation_vi"] = expected_translation

    repaired = _run_full_repair_pipeline(pack, level="L3")
    repaired_item = repaired["activities"][0]["items"][0]

    assert repaired_item["source_sentence"] == invalid_source
    assert repaired_item["explanation_vi"] == expected_translation
    ok, errors = validate_pack_v2(repaired, expected_level="L3")
    assert not ok
    assert any("source_sentence not found verbatim" in error for error in errors)


def test_l3_section_mix_forced_during_hydrate():
    from server import _hydrate_v2_pack_defaults

    pack = minimal_l3_pack_v2()
    rc = pack["activities"][2]
    for question in rc["questions"]:
        question["section"] = "Find It"

    hydrated = _hydrate_v2_pack_defaults(
        pack,
        child_name="Linh",
        level="L3",
        topic="imagination",
    )
    sections = [q["section"] for q in hydrated["activities"][2]["questions"]]
    assert sections == ["Find It", "Find It", "Find It", "Think About It", "Think About It"]


def test_short_partial_match_does_not_snap_to_first_sentence():
    from server import _best_story_sentence_match

    canonical = [
        "After school, Linh sat on the grass in the small park.",
        "She picked up a silver leaf and smiled.",
    ]
    assert _best_story_sentence_match("A", canonical) is None
    assert _best_story_sentence_match("Linh", canonical) is None


def test_fuzzy_match_snaps_paraphrased_sentence():
    from server import _best_story_sentence_match

    canonical = [
        "Pilot is in the kitchen.",
        "He wants to make pancakes for breakfast.",
        "Mom helps him find the flour and eggs.",
    ]
    assert _best_story_sentence_match("Pilot was in the kitchen.", canonical) == canonical[0]
    assert _best_story_sentence_match("He wants to make pancakes for his breakfast.", canonical) == canonical[1]
    assert _best_story_sentence_match("A totally unrelated sentence about rockets.", canonical) is None


def test_activity_a_paraphrased_source_repaired():
    from validator_v2 import validate_pack_v2
    from tests.fixtures.sample_pack_v2_l1 import minimal_l1_pack_v2

    pack = minimal_l1_pack_v2()
    for item in pack["activities"][0]["items"]:
        original = item["source_sentence"]
        words = original.split()
        if len(words) > 2:
            words[1] = "was"
        item["source_sentence"] = " ".join(words)

    ok_before, _ = validate_pack_v2(pack, expected_level="L1")
    assert not ok_before

    repaired = _run_full_repair_pipeline(pack, level="L1")
    ok, errors = validate_pack_v2(repaired, expected_level="L1")
    assert ok, f"Activity A repair should fix paraphrased source_sentences: {errors}"


def test_activity_b_duplicates_resolved_after_repair():
    from validator_v2 import validate_pack_v2

    pack = minimal_l3_pack_v2()
    duplicate = pack["story"]["sentences"][0]["text_en"]
    for item in pack["activities"][1]["items"]:
        item["original_sentence"] = duplicate

    repaired = _run_full_repair_pipeline(pack, level="L3")
    originals = [item["original_sentence"] for item in repaired["activities"][1]["items"]]
    keys = {orig.lower().rstrip(".!?") for orig in originals}

    assert len(keys) == len(originals)
    ok, errors = validate_pack_v2(repaired, expected_level="L3")
    assert ok, errors
