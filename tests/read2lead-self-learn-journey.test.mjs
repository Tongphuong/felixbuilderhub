import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createJourney, applyJourneyEvent } from '../functions/lib/read2lead/self-learn/journey.mjs';
import { createSession, applyEvent } from '../functions/lib/read2lead/self-learn/session.mjs';
import { validEvent } from '../src/lib/read2lead/self-learn/session-contract.mjs';
import { validJourneyEvent } from '../src/lib/read2lead/self-learn/journey-contract.mjs';
import { sessionView } from '../functions/lib/read2lead/self-learn/views.mjs';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
const lessons = JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/reference-lessons.json', import.meta.url))).lessons;
const lesson = lessons[2], now = '2026-09-18T12:00:00.000Z', actor = { active: true, childId: 'synthetic-an' }, staff = { active: true, role: 'staff', id: 'synthetic-staff' };
const missing = { text: '', capture_status: 'missing', support_used: [] };
const args = (l = lesson) => ({ sessionId: 'journey-session', childId: actor.childId, lesson: l, now });
const ev = (r, event, payload = {}, request_id = 'request-' + (r.session.revision + 1)) => ({ api_version: '1.2', request_id, child_id: r.session.child_id, session_id: r.session.session_id, expected_revision: r.session.revision, event, payload });
const choice = (q, choice_index = q.correct_index) => ({ item_id: q.id, choice_index, text: '', capture_status: 'not_attempted', support_used: [] });
function send(r, name, payload = {}, id) { const result = applyJourneyEvent(r, ev(r, name, payload, id), actor, now); assert.equal(result.response.ok, true, JSON.stringify(result.response)); return result.record; }
function next(r) {
  const s = r.session, l = r.lesson;
  switch (s.stage) {
    case 'pre_read': return ['prediction', { text: '' }];
    case 'input': return ['input_complete', { order: ['read'] }];
    case 'comprehension':
      if (s.question_cursor < 3) { const q = l.questions[s.question_cursor]; return ['answer', { ...choice(q), evidence_sentence_ids: q.evidence_spans.map(e => e.sentence_id) }]; }
      if (s.repair_state === 'available') return ['begin_repair', {}];
      if (s.repair_state === 'shown') return ['repair_answer', choice(l.misconception_repair)];
      return ['save_understand', {}];
    case 'understand_saved': return ['begin_use', {}];
    case 'shadowing': return ['shadow_complete', missing];
    case 'mini_story': return ['minny_turn', { ...missing, turn_id: l.minny.turns[s.dialogue_cursor].id }];
    case 'retell':
      if (!r.retell_received) return ['retell', missing];
      if (s.followup_state === 'ready') return ['followup_answer', choice(l.independent_followup)];
      return ['complete', {}];
  }
  throw Error('already_complete');
}
function to(r, condition) { let count = 0; while (!condition(r)) { if (++count > 40) throw Error('unreachable_test_state'); r = send(r, ...next(r)); } return r; }
async function repairReady() {
  let r = to(await createJourney(args()), r => r.session.stage === 'comprehension');
  for (let i = 0; i < 3; i++) { const q = lesson.questions[i]; r = send(r, 'answer', { ...choice(q, i === 0 ? (q.correct_index + 1) % 3 : q.correct_index), evidence_sentence_ids: q.evidence_spans.map(e => e.sentence_id) }); }
  assert.equal(r.session.repair_state, 'available'); return r;
}
function rejects(r, e, code = 'invalid_transition', principal = actor) { const before = JSON.stringify(r), result = applyJourneyEvent(r, e, principal, now); assert.equal(result.response.code, code); assert.equal(JSON.stringify(result.record), before); assert.equal(JSON.stringify(r), before); return result; }
for (const l of lessons) test(`${l.level}1.2 fresh follow-up completes once, never automatic mastery`, async () => {
  const r = to(await createJourney(args(l)), r => r.session.stage === 'complete'), view = sessionView(r);
  assert.equal(r.session.schema_version, '1.2.0'); assert.equal(r.session.repair_state, 'not_needed'); assert.equal(r.session.followup_state, 'answered');
  assert.equal(r.session.evidence_ids.length, r.attempts.length); assert.equal(new Set(r.session.evidence_ids).size, r.attempts.length);
  assert.equal(view.summary.fresh_probes[0].status, 'provisional'); assert.equal(view.summary.automatic_mastery, false);
  rejects(r, ev(r, 'followup_answer', choice(l.independent_followup)));
});
test('frozen1.1 remains explicit; crossing event versions is refused', async () => {
  const old = await createSession(args()), modern = await createJourney(args()), e = ev(modern, 'prediction', { text: '' });
  assert.equal(validEvent(e), false); assert.equal(validJourneyEvent({ ...e, api_version: '1.1' }), false);
  assert.equal(applyEvent(old, e, actor, now).response.code, 'invalid_request'); rejects(modern, { ...e, api_version: '1.1' }, 'invalid_request');
  const legacy = applyEvent(old, { ...e, api_version: '1.1' }, actor, now); assert.equal(legacy.response.ok, true); assert.equal(legacy.record.session.schema_version, '1.1.0'); assert.equal(Object.hasOwn(legacy.record.session, 'repair_state'), false);
});
test('1.2 text boundary counts Unicode characters consistently while preserving frozen1.1', async () => {
  const r = await createJourney(args());
  for (const character of ['a', 'ế', '🐱']) {
    assert.equal(validJourneyEvent(ev(r, 'prediction', { text: character.repeat(1500) })), true);
    assert.equal(applyJourneyEvent(r, ev(r, 'prediction', { text: character.repeat(1500) }), actor, now).response.ok, true);
    assert.equal(validJourneyEvent(ev(r, 'prediction', { text: character.repeat(1501) })), false);
  }
  assert.equal(validEvent({ ...ev(r, 'prediction', { text: 'a'.repeat(3000) }), api_version: '1.1' }), true);
});
test('repair must be shown before one parallel probe; Understand cannot bypass it', async () => {
  let r = await repairReady(); assert.equal(sessionView(r).learning_steps.repair.prompt, null);
  rejects(r, ev(r, 'save_understand')); rejects(r, ev(r, 'repair_answer', choice(lesson.misconception_repair)));
  r = send(r, 'begin_repair'); assert.equal(sessionView(r).learning_steps.repair.prompt.hint_vi, lesson.misconception_repair.hint_vi); rejects(r, ev(r, 'save_understand'));
  r = send(r, 'repair_answer', choice(lesson.misconception_repair));
  assert.equal(sessionView(r).summary.fresh_probes[0].status, 'practice_only'); assert.equal(sessionView(r).summary.fresh_probes[0].independent_mastery, false);
  rejects(r, ev(r, 'repair_answer', choice(lesson.misconception_repair))); rejects(r, ev(r, 'begin_repair'));
  assert.equal(send(r, 'save_understand').session.stage, 'understand_saved');
});
test('wrong repair answer saves needs-support and permits constructive continuation', async () => {
  let r = send(await repairReady(), 'begin_repair'); r = send(r, 'repair_answer', choice(lesson.misconception_repair, 0));
  assert.equal(sessionView(r).summary.fresh_probes[0].status, 'needs_support'); assert.equal(send(r, 'save_understand').session.stage, 'understand_saved');
});
for (const shown of [false, true]) test(`explicit repair skip after exposure=${shown} persists without a false score`, async () => {
  let r = await repairReady(); if (shown) r = send(r, 'begin_repair'); r = send(r, 'skip_repair');
  assert.equal(r.session.repair_state, 'skipped'); const p = sessionView(r).summary.fresh_probes[0];
  assert.equal(p.status, 'unassessable'); assert.equal(p.score, null); assert.equal(p.support_used.includes('revealing_hint'), shown);
  rejects(r, ev(r, 'begin_repair')); assert.equal(send(r, 'save_understand').session.stage, 'understand_saved');
});
test('repair pause/resume and old receipt replay preserve exposure and latest revision', async () => {
  let r = await repairReady(), event = ev(r, 'begin_repair'); const first = applyJourneyEvent(r, event, actor, now); r = first.record;
  r = send(r, 'pause'); rejects(r, ev(r, 'repair_answer', choice(lesson.misconception_repair))); r = send(r, 'resume');
  const replay = applyJourneyEvent(r, event, actor, now); assert.equal(replay.response.replayed, true); assert.deepEqual(replay.response.session, first.response.session);
  assert.equal(replay.record.session.revision, r.session.revision); assert.equal(r.support.filter(x => x.item_id === lesson.misconception_repair.id).length, 1);
});
test('fresh prompt stays hidden before retell and completion requires answer or explicit skip', async () => {
  let r = to(await createJourney(args()), r => r.session.stage === 'retell');
  assert.equal(sessionView(r).learning_steps.followup.prompt, null); rejects(r, ev(r, 'followup_answer', choice(lesson.independent_followup)));
  r = send(r, 'retell', missing); assert.equal(sessionView(r).learning_steps.followup.prompt.prompt_en, lesson.independent_followup.prompt_en);
  rejects(r, ev(r, 'complete')); r = send(r, 'skip_followup'); assert.equal(sessionView(r).summary.fresh_probes[0].status, 'unassessable');
  assert.equal(send(r, 'complete').session.stage, 'complete');
});
test('fresh question assistance is sticky and never becomes independent mastery', async () => {
  let r = to(await createJourney(args()), r => r.session.followup_state === 'ready');
  r = send(r, 'support', { item_id: lesson.independent_followup.id, kind: 'frame' });
  r = send(r, 'followup_answer', choice(lesson.independent_followup));
  const p = sessionView(r).summary.fresh_probes[0]; assert.equal(p.status, 'assisted'); assert.equal(p.independent_mastery, false); assert.deepEqual(p.support_used, ['frame']);
  rejects(r, ev(r, 'support', { item_id: lesson.independent_followup.id, kind: 'frame' }));
});
test('new event auth, shape, scope, stale revision and replay conflicts preserve state', async () => {
  let r = await repairReady(), e = ev(r, 'begin_repair');
  assert.equal(rejects(r, { bad: true }, 'unauthorized', null).response.current_revision, null);
  rejects(r, { ...e, child_id: 'synthetic-b' }, 'wrong_child'); rejects(r, { ...e, diamonds: 9 }, 'invalid_request');
  r = send(r, 'begin_repair'); rejects(r, { ...e, request_id: 'another' }, 'stale_revision'); rejects(r, { ...e, event: 'skip_repair' }, 'request_conflict');
  rejects(r, ev(r, 'repair_answer', { ...choice(lesson.misconception_repair), score: 2 }), 'invalid_request');
});
test('new question output omits private answer keys and all response meaning remains provisional', async () => {
  let r = send(await repairReady(), 'begin_repair'); let view = sessionView(r);
  assert.equal(JSON.stringify(view).includes('correct_index'), false);
  r = to(r, r => r.session.followup_state === 'ready'); view = sessionView(r);
  for (const key of ['correct_index', 'accepted_meanings', 'expected_meaning']) assert.equal(JSON.stringify(view).includes(key), false);
});
const roots = resolve('.r2l-journey-proofs'); mkdirSync(roots, { recursive: true });
async function stored(t) {
  const root = mkdtempSync(join(roots, 'case-')); writeFileSync(join(root, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' }));
  const store = new SyntheticStore({ root }); let closed = false; const close = () => { if (!closed) { store.close(); closed = true; } }; t.after(close);
  store.registerChild(staff, { child_id: actor.childId, family_id: 'synthetic-family', display_name: 'An sample' });
  await store.start(actor, { ...args(), apiVersion: '1.2' });
  let r = store.record(actor, actor.childId, 'journey-session');
  while (r.session.followup_state !== 'answered') { const [name, payload] = next(r); store.submit(actor, ev(r, name, payload), now); r = store.record(actor, actor.childId, 'journey-session'); }
  return { root, store, close, record: r };
}
async function worker(root, data, crashAt, barrier) {
  const proc = fork(new URL('./fixtures/read2lead-self-learn/data-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); let output, stderr = '';
  proc.stderr.on('data', b => { stderr += b; });
  const done = new Promise((resolve, reject) => { const timer = setTimeout(() => { proc.kill(); reject(Error('worker_timeout')); }, 10000); proc.on('message', m => {
    if (m.type === 'ready') { if (barrier) { barrier.push(proc); if (barrier.length === 2) barrier.forEach(p => p.send({ type: 'run' })); } else proc.send({ type: 'run' }); }
    else if (m.type === 'result') output = m; else if (m.type === 'setup-error') reject(Error(m.code));
  }); proc.on('exit', code => { clearTimeout(timer); resolve({ code, output, stderr }); }); proc.on('error', reject); });
  proc.send({ type: 'prepare', root, now, method: 'submit', principal: actor, data, crashAt }); return done;
}
for (const boundary of ['milestone_posted', 'after_commit']) test(`actual1.2 completion crash at ${boundary} restores once`, async t => {
  const f = await stored(t), event = ev(f.record, 'complete'); assert.equal(f.store.wallet(actor, actor.childId).balance, 5); f.close();
  const result = await worker(f.root, event, boundary); assert.equal(result.code, 86, result.stderr);
  const reopened = new SyntheticStore({ root: f.root }); t.after(() => reopened.close());
  assert.equal(reopened.wallet(actor, actor.childId).balance, boundary === 'after_commit' ? 10 : 5);
  reopened.submit(actor, event, now); reopened.submit(actor, event, now);
  assert.equal(reopened.wallet(actor, actor.childId).balance, 10); assert.equal(reopened.audit(staff).ok, true); assert.equal(reopened.read(actor, actor.childId, event.session_id).followup_state, 'answered');
});
test('actual competing1.2 completion writers commit one credit', async t => {
  const f = await stored(t); f.close(); const barrier = []; const results = await Promise.all(['a', 'b'].map(id => worker(f.root, ev(f.record, 'complete', {}, 'finish-' + id), undefined, barrier)));
  assert.equal(results.filter(x => x.output?.ok).length, 1); assert.equal(results.filter(x => x.output?.code === 'stale_revision').length, 1);
  const reopened = new SyntheticStore({ root: f.root }); t.after(() => reopened.close()); assert.equal(reopened.wallet(actor, actor.childId).balance, 10); assert.equal(reopened.audit(staff).entries, 2);
});
test('unknown persisted version is preserved and refused, never routed through legacy reducer', async t => {
  const f = await stored(t), db = new DatabaseSync(join(f.root, 'read2lead-synthetic.sqlite'));
  const future = structuredClone(f.record); future.session.schema_version = '9.0.0'; future.future_extension = { preserve: true };
  const bytes = JSON.stringify(future); db.prepare('UPDATE sessions SET record_json=? WHERE id=?').run(bytes, future.session.session_id);
  assert.throws(() => f.store.submit(actor, { ...ev(future, 'pause'), api_version: '1.1' }, now), e => e.code === 'unsupported_session');
  assert.equal(db.prepare('SELECT record_json FROM sessions WHERE id=?').get(future.session.session_id).record_json, bytes); db.close();
});
