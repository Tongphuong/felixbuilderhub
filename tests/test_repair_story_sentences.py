"""Tests for server-side story sentence repair."""
from __future__ import annotations

import os

import pytest

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


def test_repair_story_sentences_rebuilds_from_paragraphs():
    from server import _repair_story_sentences

    pack = minimal_l1_pack_v2()
    story = pack["story"]
    story["sentences"] = [
        {"text_en": "Pilot is in the kitchen", "paragraph_index": 0},  # missing period
    ]

    repaired = _repair_story_sentences(pack)
    texts = [s["text_en"] for s in repaired["story"]["sentences"]]

    assert "Pilot is in the kitchen." in texts
    assert len(texts) >= 10


def test_repair_story_sentences_snaps_activity_refs():
    from server import _repair_story_sentences

    pack = minimal_l1_pack_v2()
    pack["activities"][0]["items"][0]["source_sentence"] = "Pilot is in the kitchen"
    pack["activities"][1]["items"][0]["original_sentence"] = "Pilot is in the kitchen"
    pack["activities"][3]["items"][0]["text_en"] = "Pilot is in the kitchen"

    repaired = _repair_story_sentences(pack)
    canonical = "Pilot is in the kitchen."

    assert repaired["activities"][0]["items"][0]["source_sentence"] == canonical
    assert repaired["activities"][1]["items"][0]["original_sentence"] == canonical
    assert repaired["activities"][3]["items"][0]["text_en"] == canonical


def test_repair_story_sentences_passes_validator():
    from server import _repair_story_sentences
    from validator_v2 import validate_pack_v2

    pack = minimal_l1_pack_v2()
    pack["story"]["sentences"] = [
        {"text_en": "Pilot is in the kitchen", "paragraph_index": 0},
    ]

    repaired = _repair_story_sentences(pack)
    is_valid, errors = validate_pack_v2(repaired, expected_level="L1")

    assert is_valid, errors
