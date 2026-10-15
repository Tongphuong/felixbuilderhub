import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAccountTransactionRunner } from '../functions/lib/read2lead/account-transactions.mjs';
import { createAccountStoryStore } from '../functions/lib/read2lead/account-story-store.mjs';
import { StorySqlStore } from '../functions/lib/read2lead/story-store.mjs';
import { connectStoryProfileRewards } from '../functions/lib/read2lead/story-profile.mjs';
import { storyRubric } from '../functions/lib/read2lead/story-rubric.mjs';
import { onRequestPost as buy } from '../functions/api/read2lead-shop-buy.js';
import { STORY_RECALL_DELAY_MS } from '../src/lib/read2lead-story-mission.mjs';
import pkg from './fixtures/read2lead-self-learn/publisher-package.json' with { type: 'json' };

const CODE = 'R2L-SYNTHETIC-STORY', OTHER = 'R2L-SYNTHETIC-OTHER', PART = 'png-default-detail-blue-horn-small';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tables = ['read2lead_account_kv', 'read2lead_account_revision', 'story_sessions', 'story_events', 'story_test_wallets', 'story_assessed_progress', 'story_recall_assessments', 'story_speech_turns'];
function fixture(t, { progressInCodes = false } = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const transaction = fn => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  let now = Date.parse('2026-09-28T08:00:00Z');
  const options = { db, transaction, now: () => now, progressInCodes };
  const run = createAccountTransactionRunner(options);
  let store = createAccountStoryStore(options);
  const ns = key => key.startsWith('progress:') && !progressInCodes ? 'progress' : 'codes';
  const put = (key, value) => db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(ns(key), key, JSON.stringify(value));
  const get = key => { const row = db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(ns(key), key); return row ? JSON.parse(row.value) : null; };
  // This is a fabricated accepted assignment for storage tests, not evidence
  // that the fixture publisher package or a real learner lesson is accepted.
  const pack = { pack_id: 'synthetic-story-pack', schema_version: 'story-mission-v1', private_draft: false, level: 'L1', story_title: pkg.lesson.title_en,
    story_reference: { id: pkg.lesson.id, version: pkg.lesson.version, source_id: pkg.lesson.source.source_id } };
  put(CODE, { is_test: false, uses_remaining: 9, custom: 'keep', student_profile: { student_name: 'Synthetic', level: 'L1' },
    progress: { current_pack: pack, review_history: [{ pack_id: 'old-pack' }] } });
  put('progress:' + CODE, { schema_version: 2, level_reset_version: 20260606, initial_level: 'L1', current_level: 'L1', diamonds: 2000, total_xp: 0, unlocked_parts: [] });
  put(OTHER, { ...get(CODE), progress: { current_pack: null, review_history: [] } });
  put('progress:' + OTHER, { ...get('progress:' + CODE), diamonds: 321 });
  let state = store.open(CODE, pkg.lesson);
  const event = event => { state = store.get(CODE, state.sessionId); return state = store.event(CODE, pkg.lesson, { sessionId: state.sessionId, revision: state.revision, requestId: 'step-' + state.revision, event }).state; };
  event({ type: 'read_complete' });
  for (const q of pkg.lesson.questions) event({ type: 'answer', taskId: q.id, optionIndex: q.correct_index });
  const { manifest } = storyRubric(pkg.lesson);
  // Synthetic server evidence exercises accounting only; no provider calls.
  const attempt = { storyId: manifest.storyId, contentVersion: manifest.contentVersion, readComplete: true,
    answers: manifest.tasks.map(task => ({ taskId: task.id, responseId: 'response-' + task.id, modality: 'spoken', reliability: 'confirmed', support: 'none', matchedCriteria: task.criteria })) };
  const commit = () => store.commitTrustedAssessment(CODE, state.sessionId, manifest, attempt, now);
  const purchase = () => run(env => buy({ env, request: new Request('https://synthetic.test/api/read2lead-shop-buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: CODE, part_id: PART }) }) }));
  const recall = () => {
    event({ type: 'start_recall' });
    state = store.get(CODE, state.sessionId);
    const input = { sessionId: state.sessionId, requestId: 'recall-voice', revision: state.revision };
    store.beginVoice(CODE, pkg.lesson, input, 'synthetic-fingerprint');
    store.finishVoice(CODE, pkg.lesson, input, { transcript: 'Synthetic confirmed recall', reply: 'Synthetic response', assessment: 'server_validated',
      judgment: { reliability: 'confirmed', matchedCriteria: manifest.recallTask.criteria, replySupport: 'none' } });
    return event({ type: 'continue_voice' });
  };
  return { db, run, get, put, event, commit, purchase, recall, manifest, attempt, options,
    get store() { return store; }, get state() { return store.get(CODE, state.sessionId); },
    wallet: () => get('progress:' + CODE), revision: () => db.prepare('SELECT revision FROM read2lead_account_revision').get().revision,
    snapshot: () => Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }))])),
    advance: () => { now += STORY_RECALL_DELAY_MS + 1; }, restart: () => { store = createAccountStoryStore(options); },
  };
}

for (const progressInCodes of [false, true]) test(`completion, shop, replay and reopened story preserve one reward (shared namespace=${progressInCodes})`, async t => {
  const f = fixture(t, { progressInCodes }), other = f.get('progress:' + OTHER);
  const result = f.commit(); assert.deepEqual(result.award, { diamonds: 1000, xp: 20 });
  assert.deepEqual(result.profileBalance, { diamonds: 3000, xp: 20 });
  assert.equal((await f.purchase()).status, 200); assert.equal(f.wallet().diamonds, 3000);
  (assert.ok(f.wallet().avatar.monster.detail === PART)); assert.equal(f.get(CODE).custom, 'keep');
  assert.equal(f.get(CODE).progress.review_history.length, 2); assert.equal(f.get(CODE).progress.review_history[1].pack_id, 'old-pack');
  assert.equal(f.get(CODE).progress.current_pack.story_complete, true);
  const before = f.snapshot(); f.restart(); assert.deepEqual(f.snapshot(), before);
  assert.equal(f.commit().duplicate, true); assert.equal(f.wallet().diamonds, 3000); assert.equal(f.wallet().total_xp, 20);
  assert.equal(f.get(CODE).progress.review_history.length, 2); assert.deepEqual(f.get('progress:' + OTHER), other);
});

for (const point of ['wallet', 'account', 'revision', 'receipt', 'assessment']) test(`completion failure at ${point} restores all rows; retry commits once`, t => {
  const f = fixture(t), before = f.snapshot();
  const trigger = {
    wallet: `BEFORE INSERT ON read2lead_account_kv WHEN NEW.key='progress:${CODE}'`,
    account: `BEFORE INSERT ON read2lead_account_kv WHEN NEW.key='${CODE}'`,
    revision: 'BEFORE UPDATE ON read2lead_account_revision',
    receipt: 'BEFORE INSERT ON story_test_wallets',
    assessment: 'BEFORE INSERT ON story_assessed_progress',
  }[point];
  f.db.exec(`CREATE TRIGGER injected_failure ${trigger} BEGIN SELECT RAISE(ABORT,'injected_failure'); END`);
  assert.throws(f.commit, /injected_failure/); assert.deepEqual(f.snapshot(), before);
  f.db.exec('DROP TRIGGER injected_failure'); assert.equal(f.commit().profileBalance.diamonds, 3000);
  assert.equal(f.commit().duplicate, true); assert.equal(f.wallet().diamonds, 3000);
});

test('concurrent original shop cannot overwrite a newer story receipt; retry preserves both', async t => {
  const f = fixture(t), started = deferred(), resume = deferred();
  const purchase = f.run(async env => {
    const response = await buy({ env, request: new Request('https://synthetic.test/api/read2lead-shop-buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: CODE, part_id: PART }) }) });
    started.resolve(); await resume.promise; return response;
  });
  await started.promise; f.commit(); resume.resolve();
  const stale = await purchase; assert.equal(stale.status, 409); assert.equal((await stale.json()).error, 'account_changed_retry');
  assert.equal(f.wallet().diamonds, 3000); assert.equal(f.wallet().avatar.monster.detail === PART, false);
  assert.equal((await f.purchase()).status, 200); assert.equal(f.wallet().diamonds, 3000); assert.equal(f.wallet().total_xp, 20);
  assert.equal(f.get(CODE).progress.review_history.length, 2);
});

test('concurrent profile edit cannot erase a story session update', async t => {
  const f = fixture(t), started = deferred(), resume = deferred();
  const editing = f.run(async env => {
    const account = await env.READ2LEAD_CODES.get(CODE, { type: 'json' });
    account.student_profile.student_name = 'Updated synthetic name';
    await env.READ2LEAD_CODES.put(CODE, JSON.stringify(account)); started.resolve(); await resume.promise; return Response.json({ ok: true });
  });
  await started.promise; f.event({ type: 'retell_unassessed' }); resume.resolve();
  assert.equal((await editing).status, 409);
  assert.equal(f.get(CODE).progress.current_pack.story_session.revision, f.state.revision);
  const retry = await f.run(async env => {
    const account = await env.READ2LEAD_CODES.get(CODE, { type: 'json' }); account.student_profile.student_name = 'Updated synthetic name';
    await env.READ2LEAD_CODES.put(CODE, JSON.stringify(account)); return Response.json({ ok: true });
  });
  assert.equal(retry.status, 200); assert.equal(f.get(CODE).student_profile.student_name, 'Updated synthetic name');
  assert.equal(f.get(CODE).progress.current_pack.story_session.revision, f.state.revision);
});

test('delayed recall saves session, receipt and +200/no XP once, with full rollback on final revision failure', t => {
  const f = fixture(t);
  const input = { sessionId: f.state.sessionId, requestId: 'completion-voice', revision: f.state.revision };
  const task = f.store.beginVoice(CODE, pkg.lesson, input, 'synthetic-completion').task;
  f.store.finishVoice(CODE, pkg.lesson, input, { transcript: 'Synthetic retelling', reply: 'Synthetic feedback', assessment: 'server_validated',
    judgment: { reliability: 'confirmed', matchedCriteria: task.criteria.map(c => c.id), replySupport: 'none' } });
  assert.equal(f.event({ type: 'continue_voice' }).missionResult.assessment.status, 'complete');
  f.advance();
  // Capture the final event inputs so its exact request can be retried/replayed.
  let finalInput;
  const originalEvent = f.store.event.bind(f.store);
  f.store.event = (owner, lesson, input) => {
    if (input.event.type === 'continue_voice') {
      finalInput = input;
      f.db.exec("CREATE TRIGGER injected_failure BEFORE UPDATE ON read2lead_account_revision BEGIN SELECT RAISE(ABORT,'injected_failure'); END");
      const before = f.snapshot(); assert.throws(() => originalEvent(owner, lesson, input), /injected_failure/); assert.deepEqual(f.snapshot(), before);
      f.db.exec('DROP TRIGGER injected_failure');
    }
    return originalEvent(owner, lesson, input);
  };
  assert.equal(f.recall().recallResult.status, 'complete'); assert.equal(f.wallet().diamonds, 3200); assert.equal(f.wallet().total_xp, 20);
  f.restart(); assert.equal(f.store.event(CODE, pkg.lesson, finalInput).replayed, true);
  assert.equal(f.wallet().diamonds, 3200); assert.equal(f.wallet().total_xp, 20);
  assert.equal(JSON.parse(f.db.prepare('SELECT ledger FROM story_test_wallets').get().ledger).receipts.length, 2);
});

test('missing/expired account, wrong owner/source/version and non-test drafts cannot change account or story rows', t => {
  const f = fixture(t);
  let before = f.snapshot(); assert.throws(() => f.store.open(OTHER, pkg.lesson), /assignment_mismatch/); assert.deepEqual(f.snapshot(), before);
  for (const field of ['source_id', 'version']) {
    const account = f.get(CODE); const original = structuredClone(account);
    account.progress.current_pack.story_reference[field] = 'different'; account.story_pack_history = {};
    f.put(CODE, account); before = f.snapshot(); assert.throws(f.commit, /assignment_mismatch/); assert.deepEqual(f.snapshot(), before); f.put(CODE, original);
  }
  const account = f.get(CODE); account.progress.current_pack.private_draft = true; account.story_pack_history = {};
  f.put(CODE, account); before = f.snapshot(); assert.throws(f.commit, /assignment_unavailable/); assert.deepEqual(f.snapshot(), before);
  account.is_test = true; f.put(CODE, account); assert.equal(f.commit().profileBalance.diamonds, 3000);
  f.db.prepare('UPDATE read2lead_account_kv SET expires=1 WHERE key=?').run(CODE);
  before = f.snapshot(); assert.throws(() => f.store.open(CODE, pkg.lesson), /story_account_required/); assert.deepEqual(f.snapshot(), before);
  f.db.prepare('DELETE FROM read2lead_account_kv WHERE key=?').run(CODE);
  before = f.snapshot(); assert.throws(() => f.store.open(CODE, pkg.lesson), /story_account_required/); assert.deepEqual(f.snapshot(), before);
});

test('uncertain evidence leaves normal profile/revision unchanged and callbacks cannot write outside the transaction', t => {
  const f = fixture(t), wallet = f.wallet(), account = f.get(CODE), revision = f.revision();
  f.attempt.answers[0].reliability = 'uncertain'; f.attempt.answers[0].matchedCriteria = [];
  assert.equal(f.commit().assessment.status, 'retry_technical'); assert.deepEqual(f.wallet(), wallet); assert.deepEqual(f.get(CODE), account); assert.equal(f.revision(), revision);
  assert.throws(() => f.store.profileStateSink({ owner: CODE, state: f.state }), /transaction_required/);
});

test('shared revision overflow rolls back rewards and account expiry/metadata are retained', t => {
  const f = fixture(t);
  f.db.prepare('UPDATE read2lead_account_kv SET expires=?,metadata=? WHERE key=?').run(Date.parse('2027-01-01'), JSON.stringify({ migrated: true }), CODE);
  f.db.prepare('UPDATE read2lead_account_revision SET revision=?').run(Number.MAX_SAFE_INTEGER);
  const before = f.snapshot(); assert.throws(f.commit, /account_revision_limit/); assert.deepEqual(f.snapshot(), before);
  f.db.prepare('UPDATE read2lead_account_revision SET revision=100').run(); f.commit();
  const row = f.db.prepare('SELECT expires,metadata FROM read2lead_account_kv WHERE key=?').get(CODE);
  assert.equal(row.expires, Date.parse('2027-01-01')); assert.deepEqual(JSON.parse(row.metadata), { migrated: true });
});

test('default private storage still refuses a normal account after adding trusted host injection', t => {
  const f = fixture(t), privateStore = new StorySqlStore(f.db, f.options);
  f.db.exec('CREATE TABLE private_site_kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER)');
  f.db.prepare('INSERT INTO private_site_kv VALUES(?,?,NULL)').run(CODE, JSON.stringify(f.get(CODE)));
  connectStoryProfileRewards(privateStore);
  const before = f.snapshot(); assert.throws(() => privateStore.open(CODE, pkg.lesson), /private_story_profile_required/); assert.deepEqual(f.snapshot(), before);
});
