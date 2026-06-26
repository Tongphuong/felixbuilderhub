"""Smoke test for V2 audio pipeline mutation logic.

Mocks the TTS + R2 upload; verifies the pipeline correctly fills
audio_url fields across story, sentences, and activity items.
"""
from __future__ import annotations

import os
from unittest.mock import patch

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


@patch("server._generate_one_audio_mp3")
def test_pipeline_fills_all_audio_urls(mock_gen):
    # Each call returns a fake R2 URL derived from the text.
    mock_gen.side_effect = lambda text, tmp, prefix, kind, speed: (text, f"https://r2.fake/{kind}.mp3")

    from server import _generate_v2_full_story_audio, _generate_v2_pack_audio

    pack = minimal_l1_pack_v2()
    pack["slug"] = "test_pack"

    mutated = _generate_v2_pack_audio(pack, "L1", defer_full_story=True)
    story_url = _generate_v2_full_story_audio(mutated, "L1")
    mutated["story"]["full_audio_url"] = story_url or ""

    assert mutated["story"]["full_audio_url"] == "https://r2.fake/story.mp3"
    for sent in mutated["story"]["sentences"]:
        assert sent["audio_url"].startswith("https://r2.fake/")
    for item in mutated["activities"][0]["items"]:
        assert item["audio_url"].startswith("https://r2.fake/")
    for item in mutated["activities"][1]["items"]:
        assert item["audio_url"].startswith("https://r2.fake/")
    for item in mutated["activities"][3]["items"]:
        assert item["audio_url"].startswith("https://r2.fake/")


@patch("server._generate_one_audio_mp3")
def test_pipeline_dedupes_identical_sentence_text(mock_gen):
    call_texts: list[str] = []

    def _record(text, tmp, prefix, kind, speed):
        call_texts.append(text.strip())
        return text, f"https://r2.fake/{kind}.mp3"

    mock_gen.side_effect = _record

    from server import _generate_v2_pack_audio

    pack = minimal_l1_pack_v2()
    pack["slug"] = "dedupe_pack"
    duplicate = pack["story"]["sentences"][0]["text_en"]
    pack["activities"][0]["items"][0]["source_sentence"] = duplicate
    pack["activities"][1]["items"][0]["original_sentence"] = duplicate

    _generate_v2_pack_audio(pack, "L1", defer_full_story=True)

    assert call_texts.count(duplicate) == 1


@patch("server._generate_one_audio_mp3")
def test_pipeline_raises_when_required_sentence_audio_fails(mock_gen):
    mock_gen.return_value = ("text", None)

    from server import _generate_v2_pack_audio

    pack = minimal_l1_pack_v2()

    with pytest.raises(RuntimeError, match="Sentence TTS missing"):
        _generate_v2_pack_audio(pack, "L1", defer_full_story=True)


def test_hydrate_v2_pack_defaults_restores_server_fields_for_lean_llm_shape():
    from server import _hydrate_v2_pack_defaults

    pack = minimal_l1_pack_v2()
    for field in (
        "schema_version",
        "student_name",
        "level",
        "level_label",
        "topic",
        "slug",
        "audio_filename",
        "rewards",
        "parent_note_vi",
        "next_suggestion_vi",
    ):
        pack.pop(field, None)

    pack["story"].pop("paragraphs_vi", None)
    pack["story"].pop("full_audio_url", None)
    for sentence in pack["story"]["sentences"]:
        sentence.pop("text_vi", None)
        sentence.pop("audio_url", None)
    for activity in pack["activities"]:
        for item in activity.get("items") or []:
            item.pop("audio_url", None)

    hydrated = _hydrate_v2_pack_defaults(
        pack,
        child_name="Pilot",
        level="L1",
        topic="food_cooking",
    )

    assert hydrated["schema_version"] == 2
    assert hydrated["student_name"] == "Pilot"
    assert hydrated["level"] == "L1"
    assert hydrated["level_label"] == "L1 Beginner / A1"
    assert hydrated["topic"] == "Food Cooking"
    assert hydrated["slug"]
    assert hydrated["audio_filename"].endswith(".mp3")
    assert hydrated["rewards"]["xp_on_complete"] == 20
    assert hydrated["story"]["full_audio_url"] == ""
    assert all("audio_url" in sent for sent in hydrated["story"]["sentences"])
    assert all("audio_url" in item for item in hydrated["activities"][0]["items"])
    assert all("audio_url" in item for item in hydrated["activities"][1]["items"])
    assert all("audio_url" in item for item in hydrated["activities"][3]["items"])
