"""Tests for _rotate_v2_mcq_answers server-side MCQ answer shuffler."""
from __future__ import annotations

from copy import deepcopy

import pytest

from server import _rotate_v2_mcq_answers
from validator_v2 import validate_pack_v2
from tests.fixtures.sample_pack_v2_l1 import minimal_l1_pack_v2


def _force_all_correct_index_zero(pack: dict) -> dict:
    """Set every Activity A and C correct_index to 0 (simulating LLM bias)."""
    for activity in pack.get("activities") or []:
        atype = activity.get("type")
        if atype == "listening_fill_blank":
            for item in activity.get("items") or []:
                item["correct_index"] = 0
        elif atype == "reading_comprehension":
            for q in activity.get("questions") or []:
                q["correct_index"] = 0
    return pack


def test_rotate_moves_correct_answers_off_first_position():
    pack = _force_all_correct_index_zero(minimal_l1_pack_v2())
    pack = _rotate_v2_mcq_answers(pack)

    a_indices = [
        item["correct_index"]
        for item in pack["activities"][0]["items"]
    ]
    c_indices = [
        q["correct_index"]
        for q in pack["activities"][2]["questions"]
    ]
    assert any(i != 0 for i in a_indices), (
        f"Activity A correct_index all stayed at 0 after rotation: {a_indices}"
    )
    assert any(i != 0 for i in c_indices), (
        f"Activity C correct_index all stayed at 0 after rotation: {c_indices}"
    )


def test_rotate_preserves_correct_answer_text():
    pack = minimal_l1_pack_v2()
    original_a_answers = []
    for item in pack["activities"][0]["items"]:
        original_a_answers.append(item["options_en"][item["correct_index"]])
    original_c_answers = []
    for q in pack["activities"][2]["questions"]:
        original_c_answers.append(q["options_en"][q["correct_index"]])

    pack = _rotate_v2_mcq_answers(pack)

    for idx, item in enumerate(pack["activities"][0]["items"]):
        new_ci = item["correct_index"]
        assert item["options_en"][new_ci] == original_a_answers[idx], (
            f"Activity A item {idx}: correct text mismatch after rotation"
        )
    for idx, q in enumerate(pack["activities"][2]["questions"]):
        new_ci = q["correct_index"]
        assert q["options_en"][new_ci] == original_c_answers[idx], (
            f"Activity C question {idx}: correct text mismatch after rotation"
        )


def test_rotate_keeps_vi_options_aligned():
    pack = minimal_l1_pack_v2()
    original_pairs = []
    for q in pack["activities"][2]["questions"]:
        ci = q["correct_index"]
        original_pairs.append((q["options_en"][ci], q["options_vi"][ci]))

    pack = _rotate_v2_mcq_answers(pack)

    for idx, q in enumerate(pack["activities"][2]["questions"]):
        new_ci = q["correct_index"]
        en = q["options_en"][new_ci]
        vi = q["options_vi"][new_ci]
        assert (en, vi) == original_pairs[idx], (
            f"Activity C question {idx}: EN/VI pair misaligned after rotation. "
            f"Expected {original_pairs[idx]}, got ({en}, {vi})"
        )


def test_rotated_pack_still_validates():
    pack = _force_all_correct_index_zero(minimal_l1_pack_v2())
    pack = _rotate_v2_mcq_answers(pack)
    ok, errors = validate_pack_v2(pack, expected_level="L1")
    assert ok, f"Rotated pack failed validation: {errors}"
