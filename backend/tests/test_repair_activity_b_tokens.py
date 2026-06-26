"""Tests for server-side Activity B token repair."""
from __future__ import annotations

import os

from tests.fixtures.sample_pack_v2_l1 import minimal_l1_pack_v2

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


def test_repair_activity_b_tokens_reconstructs_sentence():
    from server import _repair_activity_b_tokens

    pack = minimal_l1_pack_v2()
    item = pack["activities"][1]["items"][0]
    item["scrambled_tokens"] = ["wrong", "tokens"]
    item["correct_order_indices"] = [1, 0]

    repaired = _repair_activity_b_tokens(pack)
    fixed = repaired["activities"][1]["items"][0]
    original = fixed["original_sentence"]
    reconstructed = " ".join(
        fixed["scrambled_tokens"][i] for i in fixed["correct_order_indices"]
    )

    assert reconstructed == original
    assert len(fixed["scrambled_tokens"]) <= 16


def test_repair_activity_b_tokens_swaps_overlong_sentence():
    from server import _repair_activity_b_tokens
    from validator_v2 import validate_pack_v2

    pack = minimal_l1_pack_v2()
    long_sentence = " ".join(f"word{i}" for i in range(22)) + "."
    pack["activities"][1]["items"][0]["original_sentence"] = long_sentence

    repaired = _repair_activity_b_tokens(pack)
    fixed = repaired["activities"][1]["items"][0]

    assert fixed["original_sentence"] != long_sentence
    assert len(fixed["scrambled_tokens"]) <= 16
    assert len(fixed["correct_order_indices"]) == len(fixed["scrambled_tokens"])

    is_valid, errors = validate_pack_v2(repaired, expected_level="L1")
    assert is_valid, errors


def test_repair_activity_b_tokens_swaps_combined_story_sentences():
    from server import _repair_activity_b_tokens, _repair_story_sentences

    pack = minimal_l1_pack_v2()
    combined = (
        'The fox said, "Follow me and keep your hands close to your pockets." '
        "Pilot walked carefully and listened to the river song."
    )
    pack["activities"][1]["items"][1]["original_sentence"] = combined

    repaired = _repair_activity_b_tokens(_repair_story_sentences(pack))
    fixed = repaired["activities"][1]["items"][1]

    assert len(fixed["original_sentence"].split()) <= 16
    reconstructed = " ".join(
        fixed["scrambled_tokens"][i] for i in fixed["correct_order_indices"]
    )
    assert reconstructed == fixed["original_sentence"]
