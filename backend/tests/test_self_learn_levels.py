"""Versioned presentation assets; no human curriculum or acoustic validation claim."""
import copy
import json
from pathlib import Path
import jsonschema
import pytest
from tests.test_self_learn_content import semantic_issues, SCHEMA

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'tests/fixtures/read2lead-self-learn'
OLD = json.loads((FIXTURES / 'reference-lessons.json').read_text())
NEW = json.loads((FIXTURES / 'level-lessons.json').read_text())
LEVEL_SCHEMA = json.loads((ROOT / 'schemas/read2lead-self-learn/lesson.v1.1.schema.json').read_text())


def test_versioned_level_lessons_pass_schema_and_editorial_integrity():
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(NEW, SCHEMA)
    jsonschema.validate(NEW, LEVEL_SCHEMA)
    assert semantic_issues(NEW) == []
    assert [l['level'] for l in NEW['lessons']] == [f'L{i}' for i in range(6)]


def test_upgrade_preserves_original_story_keys_and_references_exactly():
    for old, new in zip(OLD['lessons'], NEW['lessons']):
        assert old['version'] == '1.0.0' and new['version'] == '1.1.0'
        restored = copy.deepcopy(new)
        restored['version'] = restored['audio']['content_version'] = '1.0.0'
        for q in restored['questions']:
            q['version'] = '1.0.0'
        restored['independent_followup']['version'] = '1.0.0'
        # Only the new draft's learner-facing directions were simplified; rubric facts/keys stay pinned.
        assert 'logged' not in restored['retell']['prompt_en']
        restored['retell']['prompt_en'] = old['retell']['prompt_en']
        additions = restored['illustrations'][len(old['illustrations']):]
        restored['illustrations'] = restored['illustrations'][:len(old['illustrations'])]
        assert restored == old
        assert len(additions) == (3 if old['level'] in ['L0', 'L1'] else 0)
        assert all(a['alt_en'] in [s['text_en'] for s in old['story']['sentences']] or a['alt_en'] in ['Linh puts the cup on the table.', 'Linh fills the cup with water.', 'Linh waters the plant.'] for a in additions)


def test_level_and_integrity_failures_accumulate_without_lower_level_fallback():
    candidate = copy.deepcopy(NEW)
    l5 = candidate['lessons'][-1]
    l5['level'] = 'L4'
    l5['story']['sentences'][0]['text_en'] += ' Synthetic typo: teh. Synthetic unsafe advice inserted for rejection.'
    issues = semantic_issues(candidate)
    assert any(i.endswith(':level_reasoning') for i in issues)
    assert any(i.endswith(':story_hash_mismatch') for i in issues)
    assert any(i.endswith(':audio_text_mismatch') for i in issues)
    # This proves simultaneous integrity rejection, not a general medical-content classifier.


def test_picture_corruption_and_audio_version_are_rejected():
    candidate = copy.deepcopy(NEW)
    candidate['lessons'][0]['questions'][0]['option_illustration_ids'][0] = 'missing-image'
    candidate['lessons'][0]['audio']['content_version'] = '1.0.0'
    issues = semantic_issues(candidate)
    assert any(i.endswith(':missing_picture_choices') for i in issues)
    assert any(i.endswith(':audio_version_mismatch') for i in issues)
