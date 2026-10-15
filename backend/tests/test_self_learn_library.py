"""Original candidate-library integrity; not independent or human content review."""
import copy
import hashlib
import json
from collections import Counter
import jsonschema
import pytest
from tests.test_self_learn_content import ROOT, FIXTURES, semantic_issues

BASE = json.loads((FIXTURES / 'level-lessons.json').read_text())
ADDED = json.loads((FIXTURES / 'library-lessons.json').read_text())
COLLECTION = {'contract_version': '1.1.0', 'lessons': BASE['lessons'] + ADDED['lessons']}
SCHEMA = json.loads((ROOT / 'schemas/read2lead-self-learn/lesson.v1.1.schema.json').read_text())

def library_issues(collection):
    issues = semantic_issues(collection)
    lessons = collection['lessons']
    if len(lessons) != 30 or Counter(l['level'] for l in lessons) != {f'L{i}': 5 for i in range(6)}:
        issues.append('catalogue_count')
    if len({l['story']['text_sha256'] for l in lessons}) != len(lessons):
        issues.append('duplicate_story')
    ids = []
    for l in lessons:
        ids += [l['id'], *[q['id'] for q in l['questions']], l['misconception_repair']['id'], l['independent_followup']['id'], *[t['id'] for t in l['minny']['turns']], *[i['id'] for i in l['illustrations']]]
        for q in [l['misconception_repair'], l['independent_followup']]:
            if len({o.strip().casefold() for o in q['options_en']}) != 3:
                issues.append('ambiguous_extra_options')
            if type(q['correct_index']) is not int or not 0 <= q['correct_index'] < len(q['options_en']):
                issues.append('invalid_extra_key')
        if l['independent_followup']['version'] != l['version']:
            issues.append('followup_version')
        if int(l['level'][1]) <= 1:
            image_ids = {i['id'] for i in l['illustrations']}
            if not {l['id'] + '-retell-' + str(i) for i in [1, 2, 3]} <= image_ids:
                issues.append('retell_picture_missing')
    if len(ids) != len(set(ids)):
        issues.append('duplicate_public_id')
    return issues

def test_original_library_has_thirty_distinct_complete_packets_and_five_per_level():
    assert len(BASE['lessons']) == 6 and len(ADDED['lessons']) == 24
    jsonschema.validate(COLLECTION, SCHEMA)
    assert library_issues(COLLECTION) == []
    for l in ADDED['lessons']:
        assert l['title_en'] not in {old['title_en'] for old in BASE['lessons']}
        assert l['audio']['asset_status'] == 'not_recorded'
        assert l['review']['publication'] == 'not_authorized'

@pytest.mark.parametrize('mutation,expected', [
    (lambda c: c['lessons'].pop(), 'catalogue_count'),
    (lambda c: c['lessons'][6]['story'].update(text_sha256=c['lessons'][0]['story']['text_sha256']), 'duplicate_story'),
    (lambda c: c['lessons'][6]['questions'][0]['evidence_spans'][0].update(quote='Invented fact.'), 'invalid_evidence_quote'),
    (lambda c: c['lessons'][6]['questions'][0].update(correct_index=2), 'distractor_key_mismatch'),
    (lambda c: c['lessons'][6]['misconception_repair'].update(options_en=['A', 'A', 'B']), 'ambiguous_extra_options'),
    (lambda c: c['lessons'][6]['independent_followup'].update(correct_index=7), 'invalid_extra_key'),
    (lambda c: c['lessons'][6]['independent_followup'].update(version='1.0.0'), 'followup_version'),
    (lambda c: c['lessons'][6]['illustrations'].pop(2), 'retell_picture_missing'),
    (lambda c: c['lessons'][6]['minny']['turns'][0].update(id=c['lessons'][0]['minny']['turns'][0]['id']), 'duplicate_public_id'),
    (lambda c: c['lessons'][6]['audio'].update(script_en='Unmatched narration.'), 'audio_text_mismatch'),
    (lambda c: c['lessons'][6]['illustrations'][0].update(svg='<svg><image href="https://example.invalid/a"/></svg>'), 'unsafe_svg'),
])
def test_library_editorial_controls_reject_known_bad_copies(mutation, expected):
    c = copy.deepcopy(COLLECTION)
    mutation(c)
    assert any(issue.endswith(expected) for issue in library_issues(c))

def test_review_records_bind_exact_content_and_preserve_pending_human_boundaries():
    review = json.loads((FIXTURES / 'library-review.json').read_text())
    assert review['format'] == 1
    assert review['environment'] == 'synthetic-local'
    assert len(review['reviews']) == 30
    records = {r['lesson_id']: r for r in review['reviews']}
    assert len(records) == 30
    for l in COLLECTION['lessons']:
        r = records[l['id']]
        digest = hashlib.sha256(json.dumps(l, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        assert r['content_sha256'] == digest
        assert r['version'] == l['version']
        assert r['reviewer'] == 'Codex' and r['verification'] == 'solo'
        assert r['independent_review'] is False and r['human_review'] is False
        assert r['status'] == 'local_candidate_pending_human_review'
        assert r['publication'] == 'not_authorized'
        assert r['narration'] == 'not_recorded'
        assert r['focus'] == l['objectives']
