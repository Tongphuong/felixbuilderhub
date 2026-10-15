"""P1 contract integrity, not a pedagogy or speech-accuracy evaluation.

Checks the unpublished original fixtures. Known-bad copies never alter source.
No provider, child record, database, or network is used.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/read2lead-self-learn"
COLLECTION = json.loads((FIXTURES / "reference-lessons.json").read_text())
SCHEMA = json.loads((ROOT / "schemas/read2lead-self-learn/lesson.schema.json").read_text())
CASES = json.loads((FIXTURES / "assessment-cases.json").read_text())
LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5"]
REASONING = ["actor_action_object", "sequence_reference", "cause_feeling", "motive_causal_chain", "comparison_viewpoint", "claim_evidence_uncertainty"]
# These are provisional editorial load checks, not CEFR or mastery thresholds.
WORD_BOUNDS = [(20, 70), (45, 160), (75, 240), (110, 330), (150, 450), (190, 550)]


def semantic_issues(collection):
    issues = []
    ids = set()
    for lesson in collection["lessons"]:
        def issue(code):
            issues.append(f'{lesson["id"]}:{code}')
        if lesson["id"] in ids:
            issue("duplicate_lesson_id")
        ids.add(lesson["id"])
        sentences = lesson["story"]["sentences"]
        source = {s["id"]: s["text_en"] for s in sentences}
        if len(source) != len(sentences):
            issue("duplicate_sentence_id")
        text = " ".join(s["text_en"] for s in sentences)
        digest = hashlib.sha256(text.encode()).hexdigest()
        if lesson["story"]["text_sha256"] != digest:
            issue("story_hash_mismatch")
        if lesson["audio"]["script_en"] != text or lesson["audio"]["script_sha256"] != digest:
            issue("audio_text_mismatch")
        if lesson["audio"]["content_version"] != lesson["version"]:
            issue("audio_version_mismatch")
        level = int(lesson["level"][1])
        lower, upper = WORD_BOUNDS[level]
        if not lower <= len(text.split()) <= upper:
            issue("level_load")
        if lesson["difficulty"]["reasoning"] != REASONING[level]:
            issue("level_reasoning")
        if level == 0 and lesson["shadowing"]["mode"] != "echo_with_pause":
            issue("l0_echo_required")
        for sid in lesson["input"]["break_after_sentence_ids"] + lesson["shadowing"]["sentence_ids"]:
            if sid not in source:
                issue("unknown_sentence_reference")
        spans = lesson["minny"]["facts"] + lesson["retell"]["essential_facts"]
        item_ids = set()
        image_ids = {image["id"] for image in lesson["illustrations"]}
        for question in lesson["questions"]:
            if question["id"] in item_ids:
                issue("duplicate_item_id")
            item_ids.add(question["id"])
            if question["version"] != lesson["version"]:
                issue("item_version_mismatch")
            normalized = [option.strip().casefold() for option in question["options_en"]]
            if len(set(normalized)) != len(normalized):
                issue("ambiguous_duplicate_options")
            distractors = {d["option_index"] for d in question["distractors"]}
            if distractors != set(range(len(normalized))) - {question["correct_index"]}:
                issue("distractor_key_mismatch")
            if question["source"] == "story" and not question["evidence_spans"]:
                issue("missing_story_evidence")
            if question["kind"] == "picture_choice":
                options = question.get("option_illustration_ids", [])
                if len(options) != len(normalized) or not set(options) <= image_ids or len(set(options)) != len(options):
                    issue("missing_picture_choices")
            spans += question["evidence_spans"]
        if {q["dimension"] for q in lesson["questions"]} != {"meaning", "evidence", "transfer"}:
            issue("missing_rubric_dimension")
        for span in spans:
            if source.get(span["sentence_id"]) != span["quote"]:
                issue("invalid_evidence_quote")
        if lesson["minny"]["max_turns"] != len(lesson["minny"]["turns"]):
            issue("turn_budget_mismatch")
        if lesson["independent_followup"]["prompt_en"] in [t["prompt_en"] for t in lesson["minny"]["turns"]]:
            issue("followup_exposed_in_practice")
        for image in lesson["illustrations"]:
            svg = image["svg"]
            try:
                doc = ET.fromstring(svg)
                if not doc.tag.endswith("svg"):
                    issue("invalid_svg")
                for element in doc.iter():
                    if element.tag.split("}")[-1] in {"script", "foreignObject", "iframe", "image", "use"}:
                        issue("unsafe_svg")
                    if any(k.lower().startswith("on") or k.endswith("href") for k in element.attrib):
                        issue("unsafe_svg")
            except ET.ParseError:
                issue("invalid_svg")
        if not lesson["retell"]["missing_speech_preserves_reading"]:
            issue("missing_speech_erases_reading")
    return issues


def test_six_reference_lessons_validate_against_versioned_schema():
    jsonschema.Draft7Validator.check_schema(SCHEMA)
    jsonschema.validate(COLLECTION, SCHEMA)
    assert [lesson["level"] for lesson in COLLECTION["lessons"]] == LEVELS
    assert len({lesson["story"]["text_sha256"] for lesson in COLLECTION["lessons"]}) == 6
    assert semantic_issues(COLLECTION) == []


@pytest.mark.parametrize("mutation,expected", [
    (lambda l: l["questions"][0].update(evidence_spans=[]), "missing_story_evidence"),
    (lambda l: l["questions"][0]["evidence_spans"][0].update(quote="Invented story fact."), "invalid_evidence_quote"),
    (lambda l: l["audio"].update(content_version="2.0.0"), "audio_version_mismatch"),
    (lambda l: l["audio"].update(script_en="Changed narration"), "audio_text_mismatch"),
    (lambda l: l["questions"][0]["options_en"].__setitem__(1, l["questions"][0]["options_en"][0]), "ambiguous_duplicate_options"),
    (lambda l: l["questions"][0]["distractors"][0].update(option_index=l["questions"][0]["correct_index"]), "distractor_key_mismatch"),
    (lambda l: l["shadowing"].update(sentence_ids=["absent"]), "unknown_sentence_reference"),
    (lambda l: l["minny"].update(max_turns=6), "turn_budget_mismatch"),
    (lambda l: l["independent_followup"].update(prompt_en=l["minny"]["turns"][0]["prompt_en"]), "followup_exposed_in_practice"),
    (lambda l: l["questions"][0].update(option_illustration_ids=["absent"]), "missing_picture_choices"),
    (lambda l: l["difficulty"].update(reasoning="claim_evidence_uncertainty"), "level_reasoning"),
    (lambda l: l["illustrations"][0].update(svg='<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "unsafe_svg"),
    (lambda l: l["retell"].update(missing_speech_preserves_reading=False), "missing_speech_erases_reading"),
])
def test_semantic_controls_reject_known_bad_contract(mutation, expected):
    candidate = copy.deepcopy(COLLECTION)
    mutation(candidate["lessons"][0])
    assert any(issue.endswith(":" + expected) for issue in semantic_issues(candidate))


@pytest.mark.parametrize("mutation", [
    lambda l: l.pop("objectives"),
    lambda l: l["questions"][0].update(correct_index=3),
    lambda l: l["policy"].update(automatic_promotion=True),
    lambda l: l["policy"].update(unassessable_is_zero=True),
    lambda l: l["source"].update(publication_rights_review="approved"),
    lambda l: l["minny"].update(allowed_actions=["award_value"]),
])
def test_schema_rejects_missing_or_unauthorized_contract(mutation):
    candidate = copy.deepcopy(COLLECTION)
    mutation(candidate["lessons"][0])
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(candidate, SCHEMA)


def test_assessment_sets_are_frozen_disjoint_and_cover_each_level():
    assert CASES["frozen_before_evaluation"] is True
    assert CASES["evaluation_status"] == "not_run"
    assert CASES["promotion_enabled"] is False
    ids = [case["id"] for case in CASES["cases"]]
    assert len(ids) == len(set(ids)) == 108
    stories = {split: {case["story_id"] for case in CASES["cases"] if case["split"] == split} for split in ["tuning", "held_out"]}
    assert stories["tuning"].isdisjoint(stories["held_out"])
    for level in LEVELS:
        for split in stories:
            cases = {c["scenario"]: c for c in CASES["cases"] if c["level"] == level and c["split"] == split}
            assert len(cases) == 9
            assert cases["paraphrase"]["answer_en"] != cases["independent_correct"]["answer_en"]
            assert cases["independent_correct"]["transfer_prompt_en"] != cases["independent_correct"]["prompt_en"]
            assert cases["fluent_wrong"]["expected"]["meaning"] == 0
            assert cases["fluent_wrong"]["expected"]["language"] == "fluent"
            assert cases["meaning_with_hesitant_speech"]["expected"]["meaning"] == 2
            assert cases["meaning_with_hesitant_speech"]["expected"]["language"] == "needs_support"
            assert cases["contradictory_evidence"]["expected"]["state"] == "needs_support"
            assert cases["memorised"]["expected"]["state"] == "practice"
            for name in ["silence", "uncertain_capture"]:
                assert cases[name]["expected"]["meaning"] is None
                assert cases[name]["expected"]["state"] == "unassessable"
                assert cases[name]["prior_reading_evidence"]["must_be_preserved"] is True


def test_skill_profiles_do_not_collapse_listening_reading_and_speech():
    listening, speaking = CASES["skill_profiles"]
    assert listening["level"] == speaking["level"] == "L2"
    assert [o["meaning"] for o in listening["observations"]] == [0, 2]
    assert [o["meaning"] for o in speaking["observations"]] == [2, 2]
    assert speaking["speech"] == "needs_support"
    assert not any(p["automatic_level_change"] for p in CASES["skill_profiles"])

SESSION_SCHEMA = json.loads((ROOT / 'schemas/read2lead-self-learn/session.schema.json').read_text())
EVIDENCE_SCHEMA = json.loads((ROOT / 'schemas/read2lead-self-learn/evidence.schema.json').read_text())
BOUNDARY = json.loads((FIXTURES / 'session-evidence.json').read_text())


def validate_contract(value, schema):
    jsonschema.Draft7Validator(schema, format_checker=jsonschema.FormatChecker()).validate(value)


def test_session_submission_and_evidence_contracts():
    for schema in [SESSION_SCHEMA, EVIDENCE_SCHEMA]:
        jsonschema.Draft7Validator.check_schema(schema)
    validate_contract(BOUNDARY['session'], SESSION_SCHEMA)
    validate_contract(BOUNDARY['submission'], {**SESSION_SCHEMA, '$ref': '#/definitions/submission'})
    validate_contract({'ok': True, 'request_id': 'synthetic-request', 'session': BOUNDARY['session'], 'replayed': False}, {**SESSION_SCHEMA, '$ref': '#/definitions/response'})
    validate_contract({'ok': False, 'code': 'stale_revision', 'current_revision': 4}, {**SESSION_SCHEMA, '$ref': '#/definitions/response'})
    for key in ['reading_evidence', 'missing_speech_evidence']:
        validate_contract(BOUNDARY[key], EVIDENCE_SCHEMA)
    assert BOUNDARY['reading_evidence']['dimensions']['meaning'] == 2
    assert BOUNDARY['missing_speech_evidence']['dimensions']['meaning'] is None
    assert BOUNDARY['session']['child_id'] == BOUNDARY['reading_evidence']['child_id']


@pytest.mark.parametrize('field,value', [('grade', 100), ('diamonds', 500), ('reward', {'amount': 50}), ('expected_revision', -1)])
def test_submitted_contract_rejects_client_grade_rewards_and_invalid_revision(field, value):
    event = copy.deepcopy(BOUNDARY['submission'])
    event[field] = value
    with pytest.raises(jsonschema.ValidationError):
        validate_contract(event, {**SESSION_SCHEMA, '$ref': '#/definitions/submission'})


@pytest.mark.parametrize('mutation', [
    lambda e: e['dimensions'].update(meaning=0),
    lambda e: e.update(state='needs_support'),
    lambda e: e.update(automatic_mastery=True),
    lambda e: e.update(level_change='L3'),
])
def test_missing_capture_is_never_a_zero_or_promotion(mutation):
    evidence = copy.deepcopy(BOUNDARY['missing_speech_evidence'])
    mutation(evidence)
    with pytest.raises(jsonschema.ValidationError):
        validate_contract(evidence, EVIDENCE_SCHEMA)


def test_revealing_support_cannot_be_independent_and_completion_is_consistent():
    evidence = copy.deepcopy(BOUNDARY['reading_evidence'])
    evidence.update(state='independent_evidence_not_mastery', support_used=['revealing_hint'])
    with pytest.raises(jsonschema.ValidationError):
        validate_contract(evidence, EVIDENCE_SCHEMA)
    session = copy.deepcopy(BOUNDARY['session'])
    session['stage'] = 'complete'
    with pytest.raises(jsonschema.ValidationError):
        validate_contract(session, SESSION_SCHEMA)
