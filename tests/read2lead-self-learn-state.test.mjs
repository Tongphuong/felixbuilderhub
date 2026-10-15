import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEvent, createSession, publicSession, validEvent, STAGES } from '../functions/lib/read2lead/self-learn/session.mjs';
const lessons = JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/reference-lessons.json', import.meta.url))).lessons;
const now = '2026-09-18T10:00:00.000Z', principal = { active: true, childId: 'synthetic-a' };
const speech = { text: '', capture_status: 'missing', support_used: [] };
const seed = (lesson = lessons[2]) => createSession({ sessionId: 'session-1', childId: principal.childId, lesson, now });
function event(r, name, payload = {}, requestId = 'request-' + (r.session.revision + 1)) { return { api_version: '1.1', request_id: requestId, child_id: r.session.child_id, session_id: r.session.session_id, expected_revision: r.session.revision, event: name, payload }; }
function send(r, name, payload = {}) { const result = applyEvent(r, event(r, name, payload), principal, now); assert.equal(result.response.ok, true, JSON.stringify(result.response)); return result.record; }
function answer(r) { return { item_id: r.lesson.questions[r.session.question_cursor].id, choice_index: 0, text: '', evidence_sentence_ids: ['s1'], support_used: [], capture_status: 'valid' }; }
function nextEvent(r) {
  switch (r.session.stage) {
    case 'pre_read': return ['prediction', { text: '' }];
    case 'input': return ['input_complete', { order: ['read'] }];
    case 'comprehension': return r.session.question_cursor < 3 ? ['answer', answer(r)] : ['save_understand'];
    case 'understand_saved': return ['begin_use'];
    case 'shadowing': return ['shadow_complete', speech];
    case 'mini_story': return ['minny_turn', { ...speech, turn_id: r.lesson.minny.turns[r.session.dialogue_cursor].id }];
    case 'retell': return r.retell_received ? ['complete'] : ['retell', speech];
    default: throw Error('unexpected_stage');
  }
}
for (const lesson of lessons) test(`${lesson.level}: all stages, missing speech, pause/JSON restart, idempotent receipts`, async () => {
  let r = await seed(lesson); const seen = new Set();
  while (r.session.stage !== 'complete') {
    seen.add(r.session.stage);
    r = send(r, 'pause'); const paused = structuredClone(r);
    assert.equal(applyEvent(r, event(r, 'prediction', { text: '' }), principal, now).response.code, 'invalid_transition');
    r = JSON.parse(JSON.stringify(r)); assert.deepEqual(r, paused); r = send(r, 'resume');
    const [name, p = {}] = nextEvent(r), e = event(r, name, p), old = structuredClone(r);
    const result = applyEvent(r, e, principal, now); assert.equal(result.response.ok, true); assert.deepEqual(r, old);
    r = result.record; const replay = applyEvent(r, e, principal, now);
    assert.equal(replay.record, r); assert.deepEqual(replay.response, { ...result.response, replayed: true });
  }
  seen.add('complete'); assert.deepEqual([...seen], STAGES); assert.equal(r.session.status, 'complete');
  assert.equal(r.attempts.filter(a => a.event === 'answer').length, 3);
  assert.ok(r.attempts.filter(a => a.event !== 'answer').every(a => a.assessment_state === 'unassessable' && a.score === null));
  assert.equal(r.session.evidence_ids.length, 0); assert.equal(Object.hasOwn(r.session, 'diamonds'), false);
});
test('auth precedence prevents malformed request and wrong-child revision disclosure', async () => {
  const r = await seed();
  assert.deepEqual(applyEvent(r, null, null, now).response, { ok: false, code: 'unauthorized', current_revision: null });
  assert.equal(applyEvent(r, null, { active: true, childId: 'other-child' }, now).response.code, 'wrong_child');
  assert.equal(applyEvent(r, event(r, 'pause'), { ...principal, active: false }, now).response.code, 'unauthorized');
  for (const field of ['child_id', 'session_id']) { const e = event(r, 'pause'); e[field] = 'other'; assert.equal(applyEvent(r, e, principal, now).response.code, 'wrong_child'); }
});
test('client score/award/price/prototype fields and malformed payloads are rejected without mutation', async () => {
  const r = await seed(), before = structuredClone(r);
  for (const field of ['score', 'diamonds', 'level', 'price', '__proto__']) {
    const e = JSON.parse(JSON.stringify(event(r, 'prediction', { text: '' }))); Object.defineProperty(e.payload, field, { value: 999, enumerable: true });
    assert.equal(applyEvent(r, e, principal, now).response.code, 'invalid_request', field);
  }
  for (const payload of [null, [], { text: 'x'.repeat(3001) }, { text: 5 }, { text: '' , command: 'complete' }]) assert.equal(applyEvent(r, event(r, 'prediction', payload), principal, now).response.code, 'invalid_request');
  const e = event(r, 'pause'); e.expected_revision = -1; assert.equal(validEvent(e), false);
  assert.deepEqual(r, before);
});
test('cannot jump from any stage to completion or skip questions/dialogue', async () => {
  let r = await seed();
  while (!r.retell_received) {
    assert.equal(applyEvent(r, event(r, 'complete'), principal, now).response.code, 'invalid_transition');
    if (r.session.stage === 'comprehension' && r.session.question_cursor < 3) assert.equal(applyEvent(r, event(r, 'save_understand'), principal, now).response.code, 'invalid_transition');
    r = send(r, ...nextEvent(r));
  }
  r = send(r, 'complete'); assert.equal(applyEvent(r, event(r, 'pause'), principal, now).response.code, 'invalid_transition');
});
test('identical request returns original receipt after later progress; changed body conflicts', async () => {
  const initial = await seed(), e = event(initial, 'prediction', { text: 'A map' });
  const first = applyEvent(initial, e, principal, now); let r = send(first.record, 'input_complete', { order: ['read'] });
  const replay = applyEvent(r, e, principal, now); assert.equal(replay.response.session.revision, 1); assert.equal(replay.record.session.revision, 2);
  const conflict = applyEvent(r, { ...e, payload: { text: 'A dog' } }, principal, now); assert.equal(conflict.response.code, 'request_conflict'); assert.equal(conflict.record, r);
});
test('stale second-tab checkpoint cannot replace acknowledged state', async () => {
  const r = await seed(), old = event(r, 'pause', {}, 'second-tab'); const newer = send(r, 'prediction', { text: '' });
  const result = applyEvent(newer, old, principal, now); assert.equal(result.response.code, 'stale_revision'); assert.equal(result.response.current_revision, 1); assert.equal(result.record, newer);
});
test('content is pinned by copy and checksum; public response omits keys and lesson', async () => {
  const l = structuredClone(lessons[2]), r = await seed(l); l.title_en = 'Changed'; l.questions[0].correct_index = 99;
  assert.equal(r.lesson.title_en, lessons[2].title_en); assert.notEqual((await seed(l)).session.content_sha256, r.session.content_sha256);
  const serialized = JSON.stringify(publicSession(r)); for (const key of ['correct_index', 'expected_meaning', 'accepted_meanings', 'story', 'lesson"']) assert.equal(serialized.includes(key), false);
});
test('missing narration cannot be claimed listened; available audio records order distinctly', async () => {
  const initial = send(await seed(), 'prediction', { text: '' });
  assert.equal(applyEvent(initial, event(initial, 'input_complete', { order: ['listen'] }), principal, now).response.code, 'content_unavailable');
  for (const order of [['read'], ['listen'], ['read', 'listen'], ['listen', 'read']]) {
    const r = structuredClone(initial); r.lesson.audio.asset_status = 'ready';
    const next = send(r, 'input_complete', { order }); assert.deepEqual(next.session.input_order, order);
    assert.equal(next.session.input_mode, order.length === 2 ? 'audio_assisted_reading' : order[0] === 'read' ? 'independent_reading' : 'listening_only');
  }
  assert.equal(validEvent(event(initial, 'input_complete', { order: ['read', 'read'] })), false);
});
test('answers must use current item and real evidence references', async () => {
  const r = send(send(await seed(), 'prediction', { text: '' }), 'input_complete', { order: ['read'] });
  assert.equal(applyEvent(r, event(r, 'answer', { ...answer(r), item_id: r.lesson.questions[1].id }), principal, now).response.code, 'invalid_transition');
  assert.equal(applyEvent(r, event(r, 'answer', { ...answer(r), evidence_sentence_ids: ['invented'] }), principal, now).response.code, 'invalid_request');
  const next = send(r, 'answer', answer(r)); assert.equal(applyEvent(next, event(next, 'answer', answer(r)), principal, now).response.code, 'invalid_transition');
});
test('revealing support remains recorded when client omits it from later answer', async () => {
  let r = send(send(await seed(), 'prediction', { text: '' }), 'input_complete', { order: ['read'] });
  r = send(r, 'support', { item_id: r.lesson.questions[0].id, kind: 'revealing_hint' });
  r = send(r, 'answer', answer(r)); assert.deepEqual(r.attempts[0].payload.support_used, ['revealing_hint']); assert.equal(r.attempts[0].score, null);
});
test('bounded dialogue cursor and valid-empty speech rejected', async () => {
  let r = await seed(); while (r.session.stage !== 'mini_story') r = send(r, ...nextEvent(r));
  assert.equal(applyEvent(r, event(r, 'minny_turn', { ...speech, turn_id: 'invented' }), principal, now).response.code, 'invalid_transition');
  assert.equal(validEvent(event(r, 'minny_turn', { ...speech, turn_id: r.lesson.minny.turns[0].id, capture_status: 'valid' })), false);
});
test('unsafe count/duplicate seed fails and no unlimited event loop', async () => {
  const l = structuredClone(lessons[2]);l.minny.turns = Array(7).fill(l.minny.turns[0]);await assert.rejects(seed(l),/invalid_session_seed/);
  let r = await seed(); for (let i = 0; i < 128; i++) r = send(r, i % 2 ? 'resume' : 'pause');
  assert.equal(applyEvent(r, event(r, 'pause'), principal, now).response.code, 'session_limit');
});
