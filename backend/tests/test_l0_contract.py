"""Offline six-level contract tests; synthetic packs, no generation or publishing."""
from copy import deepcopy
import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from jsonschema import Draft7Validator

import prompt_v2 as prompt
import validator_v2 as validator
from tests.fixtures.sample_pack_v2_l1 import minimal_l1_pack_v2

LEVELS = ('L0', 'L1', 'L2', 'L3', 'L4', 'L5')
# Frozen pre-repair floors: changing these is a separate product decision.
BOUNDS = {
    'L0': (15, 2, 4, 3, 12),
    'L1': (50, 3, 5, 6, 22),
    'L2': (85, 3, 5, 9, 27),
    'L3': (130, 3, 6, 11, 32),
    'L4': (190, 4, 6, 15, 38),
    'L5': (250, 4, 7, 17, 44),
}
MIXES = {
    'L0': ['Find It'] * 2 + ['Think About It'],
    'L1': ['Find It'] * 4 + ['Think About It'],
    'L2': ['Find It'] * 4 + ['Think About It'],
    'L3': ['Find It'] * 3 + ['Think About It'] * 2,
    'L4': ['Find It'] * 2 + ['Think About It'] * 2 + ['Open Question'],
    'L5': ['Find It'] * 2 + ['Think About It'] * 2 + ['Open Question'],
}
VOCAB = ('top 200', 'top 500', 'top 800', 'top 1200', 'top 1500', 'top 2000')


def synthetic_pack(level='L0', l0_sentences=6):
    """Structural regression fixture, not a validated curriculum or model output."""
    pack = minimal_l1_pack_v2()
    pack['level'] = level
    pack['level_label'] = validator.LEVEL_RULES_V2[level]['label']
    if level == 'L0':
        texts = ['Pilot has a red ball.', 'The ball is very red.', 'Mom has a big box.',
                 'The box is big.', 'Pilot sees the box.', 'Mom sees the ball.',
                 'The ball is small.', 'Pilot sees a cat.', 'Mom has a bag.',
                 'The bag is blue.', 'Pilot has a hat.', 'The hat is red.',
                 'Mom sees the cat.'][:l0_sentences]
        paragraph_count = 2
    else:
        count = {'L1': 10, 'L2': 12, 'L3': 16, 'L4': 20, 'L5': 25}[level]
        colors = ('red', 'blue', 'green', 'yellow', 'pink')
        things = ('ball', 'box', 'cup', 'hat', 'bag')
        texts = [f'Pilot puts the {color} {thing} beside the small tree at home.'
                 for color in colors for thing in things][:count]
        paragraph_count = 4 if level in ('L4', 'L5') else 3
    sentences = [{'text_en': text, 'text_vi': 'Câu thử nghiệm.', 'audio_url': '',
                  'paragraph_index': min(i * paragraph_count // len(texts), paragraph_count - 1)}
                 for i, text in enumerate(texts)]
    pack['story'] = {
        'title': 'Pilot and the Ball', 'full_audio_url': '',
        'paragraphs_en': [' '.join(s['text_en'] for s in sentences if s['paragraph_index'] == p)
                          for p in range(paragraph_count)],
        'paragraphs_vi': ['Đoạn thử nghiệm.'] * paragraph_count,
        'sentences': sentences,
    }
    n = 3 if level == 'L0' else 5
    a, b, c, e = pack['activities']
    a['items'] = []
    for i, text in enumerate(texts[:n]):
        chunk = ' '.join(text.split()[-2:])
        a['items'].append({'id': f'a_{i}', 'audio_url': '', 'source_sentence': text,
                           'sentence_with_blank': text.replace(chunk, '________'),
                           'options_en': [chunk, 'a toy', 'a dog'], 'correct_index': 0,
                           'explanation_vi': 'Câu thử nghiệm.'})
    b['items'] = []
    selected = texts[:n] if level == 'L0' else texts[n:n * 2]
    for i, text in enumerate(selected):
        tokens = text.split()
        b['items'].append({'id': f'b_{i}', 'audio_url': '', 'original_sentence': text,
                           'scrambled_tokens': list(reversed(tokens)),
                           'correct_order_indices': list(reversed(range(len(tokens)))),
                           'translation_vi': 'Câu thử nghiệm.'})
    c['questions'] = [{'id': f'c_{i}', 'section': section,
                       'question_en': f'What happens in part {i + 1}?',
                       'options_en': ['Pilot plays', 'Mom sleeps', 'The dog runs'],
                       'correct_index': 0} for i, section in enumerate(MIXES[level])]
    e['items'] = [{'id': f'e_{i}', 'audio_url': '', 'text_en': text,
                   'text_vi': 'Câu thử nghiệm.', 'tip_vi': 'Đọc rõ.'}
                  for i, text in enumerate(texts)]
    pack['guided_listening'] = [
        {'paragraph_index': p, 'questions': [
            {'id': f'gl_p{p}_s{i}_q{q}', 'type': 'choice', 'question_en': 'What happens here?',
             'options_en': ['Pilot plays', 'Mom sleeps', 'The dog runs'],
             'correct_index': 0, 'sentence_index': i}
            for i, s in enumerate(sentences) if s['paragraph_index'] == p for q in (1, 2)]}
        for p in range(paragraph_count)]
    return pack


def schema():
    return json.loads((Path(__file__).resolve().parents[1] / 'schemas/pack.schema.v2.json').read_text())


@pytest.mark.parametrize('level', LEVELS)
def test_full_pack_schema_and_validator(level):
    pack = synthetic_pack(level)
    Draft7Validator.check_schema(schema())
    Draft7Validator(schema()).validate(pack)
    ok, errors = validator.validate_pack_v2(pack, level)
    assert ok, errors


@pytest.mark.parametrize('count', [3, 4, 6, 12])
def test_short_l0_pack(count):
    pack = synthetic_pack(l0_sentences=count)
    ok, errors = validator.validate_pack_v2(pack, 'L0')
    assert ok, errors


@pytest.mark.parametrize('level', LEVELS)
def test_existing_floors_and_activity_rules(level):
    rule = validator.LEVEL_RULES_V2[level]
    assert tuple(rule[k] for k in ('min_words', 'min_paragraphs', 'max_paragraphs',
                                  'min_sentences', 'max_sentences')) == BOUNDS[level]
    n = 3 if level == 'L0' else 5
    assert [rule[k] for k in ('activity_a_items', 'activity_b_items', 'activity_c_questions')] == [n] * 3
    assert rule['activity_c_section_mix'] == MIXES[level]
    assert rule['activity_e_items'] == 'all'


@pytest.mark.parametrize('level', LEVELS)
@pytest.mark.parametrize('boundary', ['words', 'sentences', 'paragraphs'])
def test_below_floor_rejected(level, boundary):
    pack = synthetic_pack(level)
    minimum = BOUNDS[level]
    if boundary == 'words':
        pack['story']['paragraphs_en'] = ['one'] * minimum[1]
        expected = 'below minimum'
    elif boundary == 'sentences':
        pack['story']['sentences'] = pack['story']['sentences'][:minimum[3] - 1]
        expected = 'story.sentences count'
    else:
        pack['story']['paragraphs_en'] = pack['story']['paragraphs_en'][:minimum[1] - 1]
        expected = 'story.paragraphs_en count'
    ok, errors = validator.validate_pack_v2(pack, level)
    assert not ok
    assert any(expected in e for e in errors), errors


@pytest.mark.parametrize('level', LEVELS)
def test_all_prompt_paths_use_requested_contract(level):
    idx = LEVELS.index(level)
    n = 3 if level == 'L0' else 5
    full = prompt.build_user_message_v2('Pilot', 7, level, 'boy')
    story = prompt.build_story_only_user_message('Pilot', 7, level, 'boy')
    activities = prompt.build_activity_from_story_user_message(synthetic_pack(level)['story'], level, 'Pilot')
    assert VOCAB[idx] in full and VOCAB[idx] in story
    for label in ('Activity A', 'Activity B', 'Activity C'):
        for message in (full, activities):
            line = next(line for line in message.splitlines() if label in line)
            assert f'exactly {n}' in line
    assert prompt._ACTIVITY_C_SECTION_MIX[level] in activities
    assert prompt._ACTIVITY_B_TOKEN_RANGE[level] in activities
    story_system = prompt.build_story_system_prompt(level)
    assert prompt._LEVEL_VOICE_HINT[level] in story_system
    if level == 'L0':
        # All three L0 examples are sampled; a correct heading must not hide L2 fallback.
        for phrase in ('I see a cat.', 'The sun is up.', 'Mom has a ball.'):
            assert phrase in story_system
        assert 'top-800' not in story_system
    assert prompt.STORY_ARC_RULES[level] in prompt.build_story_polish_user_message({'story': {}}, level, 'Pilot')


def test_l0_system_constraints_are_meaningful():
    assert 'L0: present tense, top-200 words' in prompt.SYSTEM_PROMPT_V2
    assert 'L0: Find It×2 + Think About It×1' in prompt.SYSTEM_PROMPT_V2
    for system in (prompt.SYSTEM_PROMPT_V2, prompt.ACTIVITY_FROM_STORY_SYSTEM_PROMPT):
        assert 'L0: exactly 3 items; L1-L5: exactly 5 items' in system
        assert '(exactly 5 items)' not in system
    system = prompt.ACTIVITY_FROM_STORY_SYSTEM_PROMPT
    assert 'L0: 3-5' in system
    assert 'L0 pick 3 unique sentences' in system
    assert 'A/B overlap allowed' in system
    assert 'B (5 items)' not in system
    assert '5 DIFFERENT sentences (none used in A)' not in system


@pytest.fixture
def route(monkeypatch):
    # Only synthetic credentials; external access is additionally denied by the runner.
    for key in ('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'READ2LEAD_BACKEND_SECRET',
                'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
                'R2_BUCKET_NAME', 'R2_PUBLIC_URL'):
        monkeypatch.setenv(key, 'offline-l0-test')
    import server
    server.app.config['TESTING'] = True
    publish, executor = Mock(), Mock()
    monkeypatch.setattr(server, '_publish_task_state', publish)
    monkeypatch.setattr(server, '_GENERATION_EXECUTOR', executor)
    monkeypatch.setattr(server, '_mark_generation_queued', Mock(return_value=(0, 1)))
    capacity = Mock(return_value=None)
    monkeypatch.setattr(server, '_check_generation_capacity', capacity)
    with server.app.test_client() as client:
        yield client, server, publish, executor, capacity


def request_pack(client, level, **changes):
    payload = dict(child_name='Pilot', age=7, level=level, child_gender='boy')
    payload.update(changes)
    return client.post('/generate-async-v2', json=payload,
                       headers={'X-Read2Lead-Secret': 'offline-l0-test'})


@pytest.mark.parametrize('level', LEVELS)
def test_real_handler_accepts_and_queues_requested_level(route, level):
    client, server, publish, executor, capacity = route
    response = request_pack(client, level)
    assert response.status_code == 202, response.get_json()
    assert set(response.get_json()) == {'ok', 'task_id', 'status', 'queue_position'}
    assert response.get_json()['queue_position'] == 1
    capacity.assert_called_once_with()
    publish.assert_called_once()
    executor.submit.assert_called_once()
    assert executor.submit.call_args.args[0] is server._run_generation_task_v2
    assert executor.submit.call_args.args[4] == level


@pytest.mark.parametrize('level', ['', 'L6', 'L-1', 'L00', 'beginner'])
def test_real_handler_rejects_unknown_level_before_queue(route, level):
    client, _, publish, executor, capacity = route
    response = request_pack(client, level)
    assert response.status_code == 400
    assert response.get_json() == {'ok': False, 'error': 'Invalid level (L0-L5)'}
    capacity.assert_not_called()
    publish.assert_not_called()
    executor.submit.assert_not_called()


def test_real_handler_preserves_auth_and_capacity(route):
    client, _, publish, executor, capacity = route
    response = client.post('/generate-async-v2', json={'level': 'L0'})
    assert response.status_code == 401
    capacity.assert_not_called()
    capacity.side_effect = lambda: ({'ok': False, 'error': 'at_capacity', 'retry_after': 45}, 429)
    response = request_pack(client, 'L0')
    assert response.status_code == 429
    assert response.get_json() == {'ok': False, 'error': 'at_capacity', 'retry_after': 45}
    publish.assert_not_called()
    executor.submit.assert_not_called()


def test_schema_rejects_unknown_level():
    pack = synthetic_pack()
    pack['level'] = 'L6'
    errors = list(Draft7Validator(schema()).iter_errors(pack))
    assert any(list(e.path) == ['level'] for e in errors)


def test_missing_l0_validator_control(monkeypatch):
    monkeypatch.delitem(validator.LEVEL_RULES_V2, 'L0')
    ok, errors = validator.validate_pack_v2({'story': {}, 'activities': []}, 'L0')
    assert not ok and "unsupported expected_level 'L0'" in errors


def test_missing_l0_schema_control():
    broken = deepcopy(schema())
    broken['properties']['level']['enum'].remove('L0')
    errors = list(Draft7Validator(broken).iter_errors(synthetic_pack()))
    assert any(list(e.path) == ['level'] for e in errors)


def test_schema_lists_all_six_levels():
    assert schema()["properties"]["level"]["enum"] == list(LEVELS)


@pytest.mark.parametrize('activity_index,key', [(0, 'items'), (1, 'items'), (2, 'questions')])
@pytest.mark.parametrize('count', [2, 4, 5])
def test_l0_schema_rejects_wrong_activity_count(activity_index, key, count):
    pack = synthetic_pack()
    items = pack['activities'][activity_index][key]
    pack['activities'][activity_index][key] = (items * 2)[:count]
    errors = list(Draft7Validator(schema()).iter_errors(pack))
    assert any(list(e.path)[:2] == ['activities', activity_index] for e in errors)


@pytest.mark.parametrize('field', ['sentences', 'speech_items'])
@pytest.mark.parametrize('count', [2, 13])
def test_l0_schema_rejects_sentence_counts_outside_bounds(field, count):
    pack = synthetic_pack(l0_sentences=12)
    if field == 'sentences':
        items = pack['story']['sentences']
        pack['story']['sentences'] = (items * 2)[:count]
        path = ['story', 'sentences']
    else:
        items = pack['activities'][3]['items']
        pack['activities'][3]['items'] = (items * 2)[:count]
        path = ['activities', 3]
    errors = list(Draft7Validator(schema()).iter_errors(pack))
    assert any(list(e.path)[:len(path)] == path for e in errors)


@pytest.mark.parametrize('level', ['L1', 'L2', 'L3', 'L4', 'L5', None])
@pytest.mark.parametrize('boundary', ['A', 'B', 'C', 'E', 'story'])
def test_other_levels_and_omitted_level_keep_schema_minimums(level, boundary):
    # Schema-only: validator level-specific floors are exercised separately.
    pack = minimal_l1_pack_v2()
    if level is None:
        pack.pop('level')
    else:
        pack['level'] = level
    check = Draft7Validator(schema())
    assert not list(check.iter_errors(pack))
    if boundary == 'story':
        pack['story']['sentences'] = pack['story']['sentences'][:4]
        path = ['story', 'sentences']
    else:
        idx = 'ABCE'.index(boundary)
        key = 'questions' if boundary == 'C' else 'items'
        pack['activities'][idx][key] = pack['activities'][idx][key][:4]
        path = ['activities', idx]
    errors = list(check.iter_errors(pack))
    assert any(list(e.path)[:len(path)] == path for e in errors)


def test_l0_book_retains_book_contract_instead_of_generated_limits():
    from tests.test_book_pack_schema import book_pack
    pack = book_pack()
    pack['level'] = 'L0'
    assert len(pack['story']['sentences']) > 12
    check = Draft7Validator(schema())
    assert not list(check.iter_errors(pack))
    pack['story']['sentences'] = pack['story']['sentences'][:4]
    assert any(list(e.path) == ['story', 'sentences'] for e in check.iter_errors(pack))


def test_l0_does_not_bypass_required_fields_or_unknown_field_rejection():
    pack = synthetic_pack()
    pack['activities'][0].pop('instructions_vi')
    assert list(Draft7Validator(schema()).iter_errors(pack))
    pack = synthetic_pack()
    pack['unexpected_contract_field'] = True
    assert list(Draft7Validator(schema()).iter_errors(pack))
