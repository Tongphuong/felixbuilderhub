"""Tests for activity schema normalization inside hydrate (Render log regression)."""
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


def _corrupt_like_render_log(pack: dict) -> dict:
    """Mirror gpt-5-mini drift from Render validation failure."""
    activities = pack["activities"]
    for activity in activities:
        activity.pop("instructions_vi", None)

    rc = activities[2]
    rc["items"] = rc.pop("questions")
    for question in rc["items"]:
        question.pop("section", None)
        question.pop("question_vi", None)
        question.pop("explanation_vi", None)

    for item in activities[1]["items"]:
        item.pop("translation_vi", None)

    speak = activities[3]
    speak.pop("scoring_mode", None)
    for item in speak["items"]:
        item["scoring_mode"] = "self_rate"
    return pack


def test_hydrate_normalizes_render_log_schema_drift():
    from server import _hydrate_v2_pack_defaults
    from validator_v2 import validate_pack_v2

    pack = _corrupt_like_render_log(minimal_l1_pack_v2())

    before_ok, before_errors = validate_pack_v2(pack, expected_level="L1")
    assert not before_ok
    assert any(e.startswith("schema:") for e in before_errors)

    repaired = _hydrate_v2_pack_defaults(
        pack,
        child_name=pack["student_name"],
        level="L1",
        topic="animals_pets",
    )
    after_ok, after_errors = validate_pack_v2(repaired, expected_level="L1")

    assert after_ok, after_errors
    assert all(a.get("instructions_vi") for a in repaired["activities"])
    assert "questions" in repaired["activities"][2]
    assert "scoring_mode" in repaired["activities"][3]
    assert all("scoring_mode" not in item for item in repaired["activities"][3]["items"])


def test_hydrate_backfills_missing_listen_and_speak_ids():
    """Render 2026-06-10: gpt-5-mini dropped id on listen_and_speak items."""
    from server import _hydrate_v2_pack_defaults
    from validator_v2 import validate_pack_v2

    pack = minimal_l1_pack_v2()
    for item in pack["activities"][3]["items"]:
        item.pop("id", None)

    before_ok, _ = validate_pack_v2(pack, expected_level="L1")
    assert not before_ok

    repaired = _hydrate_v2_pack_defaults(
        pack,
        child_name=pack["student_name"],
        level="L1",
        topic="animals_pets",
    )
    ok, errors = validate_pack_v2(repaired, expected_level="L1")
    assert ok, errors
    assert [i["id"] for i in repaired["activities"][3]["items"]] == [
        f"ls_{n}" for n in range(1, len(repaired["activities"][3]["items"]) + 1)
    ]


