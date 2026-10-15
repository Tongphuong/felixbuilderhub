/** Synthetic accounts, publication proofs and provider evidence only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRead2LeadAccountService } from '../functions/lib/read2lead/account-service.mjs';
import { fixturePackage } from './fixtures/read2lead-self-learn/publisher-test-tools.mjs';
import { privateVoiceConfiguration } from '../functions/lib/read2lead/private-voice.mjs';
import { publisherDigest } from '../functions/lib/read2lead/self-learn/publisher-contract.mjs';
import { createAccountStoryApi } from '../functions/lib/read2lead/account-story-api.mjs';

const CODE = 'R2L-SYNTHETIC-STORY-HTTP', OTHER = 'R2L-SYNTHETIC-OTHER-HTTP', origin = 'https://synthetic.test';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('trusted existing-host storage requires a same-database store, account reader and access check', () => {
  const db={};
  for(const hostStorage of [{}, {store:{db}}, {readAccount:()=>null}, {store:{db:{}},readAccount:()=>null,authorize:()=>true}, {store:{db},readAccount:()=>null}]) {
    assert.throws(()=>createAccountStoryApi({db,origin,hostStorage}),/account_host_storage_required/);
  }
});
async function fixture(t, { isTest = false, draft = false, enabled = true } = {}) {
  const assets = ['image', 'audio'].map((kind, i) => ({ id: 'synthetic-' + kind, kind, sha256: String(i + 1).repeat(64), bytes: 100,
    mime: kind === 'image' ? 'image/png' : 'audio/wav', object_key: String(i + 1).repeat(64) + (kind === 'image' ? '.png' : '.wav'),
    width: kind === 'image' ? 16 : 0, height: kind === 'image' ? 16 : 0, duration_seconds: kind === 'audio' ? 8 : 0,
    provenance: 'synthetic_fixture', reference_hashes: [], character_ids: [], alt_en: 'Synthetic accounting test reference' }));
  const pkg = await fixturePackage(assets), record = { status: draft ? 'private-draft' : 'accepted', package: pkg,
    assetProofs: assets.map(a => ({ id: a.id, sha256: a.sha256, bytes: a.bytes, mime: a.mime, decoded: true })) };
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const transaction = fn => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  let providerCalls = 0, claims = 0, blocked = false, lookupHook = null;
  const provider = { transcribe: async () => { providerCalls++; return pkg.lesson.retell.essential_facts.map(f => f.quote).join(' '); },
    respond: async () => ({ reply: 'You found a story detail. What happens next?', sentenceIds: ['s1'] }), validateSafety: async () => true,
    assess: async ({ task, transcript }) => ({ reliability: 'confirmed', replySupport: 'none', criteria: task.criteria.map(c => ({ id: c.id, met: true, quote: transcript.slice(0, 60) })) }),
    synthesize: async () => ({ audio_b64: 'YXVkaW8=', content_type: 'audio/mpeg' }) };
  const voiceConfig = { activation: { externalProcessingApproved: true, spendingApproved: true, providerVerified: true, assessorValidated: true }, provider,
    budget: { claim() { if (blocked) throw Error('voice_budget_exhausted'); claims++; }, finish() {} } };
  const infrastructure = { R2L_CONTENT_SOURCE: 'combined', R2L_PRIVATE_QA: 'adult-isolated', R2L_STORY_CATALOGUE: { async get(key) {
    if (lookupHook) await lookupHook(key);
    if (key === 'index:L1') return [{ id: pkg.lesson.id, version: pkg.lesson.version }];
    if (key === `package:${pkg.lesson.id}@${pkg.lesson.version}`) return structuredClone(record);
    return null;
  } } };
  const options = { db, transaction, now: () => Date.parse('2026-09-28T08:00:00Z'), infrastructure,
    story: enabled ? { origin, voiceConfig } : null };
  let service = createRead2LeadAccountService(options);
  const ns = key => key.startsWith('progress:') ? 'progress' : 'codes';
  const put = (key, value) => db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,NULL,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(ns(key), key, JSON.stringify(value));
  const get = key => { const row = db.prepare('SELECT value FROM read2lead_account_kv WHERE namespace=? AND key=?').get(ns(key), key); return row ? JSON.parse(row.value) : null; };
  for (const code of [CODE, OTHER]) {
    put(code, { is_test: isTest, uses_remaining: 9, student_profile: { student_name: 'Synthetic Reader', level: 'L1', age: 10, child_gender: 'boy' }, completed_books: [],
      progress: { current_level: 'L1', current_pack: null, review_history: [{ pack_id: 'old-pack' }] } });
    put('progress:' + code, { schema_version: 2, level_reset_version: 20260606, current_level: 'L1', initial_level: 'L1', diamonds: 2000, total_xp: 0, unlocked_parts: [] });
  }
  const call = async (pathname, body, { code = CODE, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) => {
    const response = await service(new Request(origin + pathname, { method, headers: { 'X-Read2Lead-Code': code, 'CF-Connecting-IP': '192.0.2.5', Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    return { status: response.status, body: method === 'HEAD' ? await response.text() : await response.json() };
  };
  const assign = () => call('/api/generate-read2lead-pack', { access_code: CODE, collection: 'one-story-a-day' });
  let view;
  const open = async () => { const assigned = await assign(); assert.equal(assigned.status, 200, JSON.stringify(assigned));
    const result = await call('/api/read2lead-story-session', { action: 'open_assigned', packId: assigned.body.pack_id }); assert.equal(result.status, 200, JSON.stringify(result)); view = result.body; return result; };
  const event = async type => { const result = await call('/api/read2lead-story-session', { action: 'event', sessionId: view.session.id, revision: view.session.revision, requestId: 'event-' + view.session.revision, event: { type } }); if (result.status === 200) view = result.body; return result; };
  const voiceRequest = (id = 'voice-' + view.session.revision) => {
    const form = new FormData(); form.set('sessionId', view.session.id); form.set('requestId', id); form.set('revision', String(view.session.revision)); form.set('audio', new Blob(['synthetic'], { type: 'audio/webm' }), 'voice.webm');
    return new Request(origin + '/api/read2lead-story-turn', { method: 'POST', headers: { Origin: origin, 'X-Read2Lead-Code': CODE }, body: form });
  };
  const voice = async (request = voiceRequest()) => { const response = await service(request), body = await response.json(); if (response.status === 200) view = body.view; return { status: response.status, body }; };
  const throughRetell = async () => { await open(); assert.equal((await event('read_complete')).status, 200);
    for (const q of pkg.lesson.questions) { assert.equal(view.lesson.question.id, q.id); assert.equal((await voice()).status, 200); assert.equal((await event('continue_voice')).status, 200); }
    assert.equal(view.session.stage, 'retell'); };
  const snapshot = () => Object.fromEntries(['read2lead_account_kv', 'read2lead_account_revision', 'story_sessions', 'story_events', 'story_test_wallets', 'story_assessed_progress', 'story_speech_turns']
    .filter(name => db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(name)).map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map(row => ({ ...row }))]));
  return { db, pkg, record, provider, voiceConfig, options, put, get, call, open, assign, event, voice, voiceRequest, throughRetell, snapshot,
    view: () => view, providerCalls: () => providerCalls, claims: () => claims, block: () => { blocked = true; }, lookup: hook => { lookupHook = hook; },
    restart: () => { service = createRead2LeadAccountService(options); } };
}

/** Exercise the real exact-package resolver; provider execution stays synthetic. */
async function scopedVoice(f, { approved = true, rootAssessed = false } = {}) {
  const packageSha256 = await publisherDigest(f.pkg), budget = f.voiceConfig.budget;
  const raw = { format: 'read2lead-private-voice-v1', mode: 'assessed', packageSha256,
    processingApproved: true, spendingApproved: true, adultTrialApproved: true,
    pricingEvidenceSha256: 'b'.repeat(64), assessorModel: 'gpt-oss-120b',
    budget: { scope: 'batch', batchId: 'synthetic-account-scope', expiresAt: '2026-10-01T00:00:00.000Z', approvedVoiceMicroUsd: 1000, worstCaseTurnMicroUsd: 100, maxTurns: 8 },
    verification: { provider: true, assessor: true, evidenceSha256: 'c'.repeat(64),
      lessons: [{ id: f.pkg.lesson.id, version: f.pkg.lesson.version, packageSha256: approved ? packageSha256 : 'd'.repeat(64) }] } };
  let nativeCalls = 0;
  const deny = () => { nativeCalls++; throw Error('unexpected_native_provider_call'); };
  const configured = privateVoiceConfiguration({ store: { db: f.db }, packageSha256,
    env: { AI: { run: deny }, OPENROUTER_API_KEY: 'synthetic-not-a-key', R2L_PRIVATE_VOICE_CONFIG: JSON.stringify(raw) },
    now: () => new Date('2026-09-28T08:00:00Z'), fetchFn: deny });
  assert.equal(configured.status.enabled, true, configured.status.reason);
  const resolve = configured.config.forPackage;
  Object.assign(f.voiceConfig, configured.config, { provider: f.provider, budget,
    async forPackage(pkg) { return { ...await resolve(pkg), provider: f.provider, budget }; } });
  if (rootAssessed) {
    f.voiceConfig.practiceTrial = false;
    f.voiceConfig.activation = { ...f.voiceConfig.activation, providerVerified: true, assessorValidated: true };
  }
  return { nativeCalls: () => nativeCalls };
}

test('normal assignment -> scoped spoken questions/retell -> shared reward -> original progress/shop/reload once', async t => {
  const f = await fixture(t), scoped = await scopedVoice(f); await f.throughRetell(); const request = f.voiceRequest(), replay = request.clone();
  assert.equal((await f.voice(request)).status, 200); assert.equal((await f.event('continue_voice')).status, 200);
  assert.equal(f.view().session.complete, true); assert.equal(f.view().policy.testProgressOnly, false); assert.equal(f.view().policy.privateDraft, false);
  assert.equal(f.view().policy.contentComplete, false, 'synthetic fixtures never count as real source lessons'); assert.equal(f.view().policy.rewardState, 'award_recorded');
  assert.equal(f.get('progress:' + CODE).diamonds, 3000); assert.equal(f.get('progress:' + CODE).total_xp, 20);
  const progress = await f.call('/api/read2lead-progress?code=' + CODE); assert.equal(progress.status, 200); assert.equal(progress.body.read2lead_state.diamonds, 3000);
  assert.equal((await f.call('/api/read2lead-shop-buy', { code: CODE, part_id: 'png-default-detail-blue-horn-small' })).status, 200);
  assert.equal(f.get('progress:' + CODE).diamonds, 3000); assert.equal(f.get(CODE).progress.review_history.length, 2); assert.equal(f.get('progress:' + OTHER).diamonds, 2000);
  f.restart(); const before = f.providerCalls(); assert.equal((await f.voice(replay)).body.replayed, true); assert.equal(f.providerCalls(), before);
  const saved = await f.call('/api/read2lead-story-session?sessionId=' + f.view().session.id); assert.equal(saved.status, 200); assert.equal(saved.body.session.complete, true);
  assert.equal(f.get('progress:' + CODE).diamonds, 3000); assert.equal(f.claims(), f.pkg.lesson.questions.length + 1);
  assert.doesNotMatch(JSON.stringify(saved.body), /correct_index|matchedCriteria|evidence_ref/);
  assert.equal(saved.body.policy.providerEnabled, true); assert.equal(scoped.nativeCalls(), 0);
});

for (const rootAssessed of [false, true]) test(`unverified resolved package denies normal learner prompts and speech (root assessed: ${rootAssessed})`, async t => {
  const f = await fixture(t), scoped = await scopedVoice(f, { approved: false, rootAssessed });
  await f.open(); await f.event('read_complete'); assert.equal(f.view().policy.providerEnabled, false);
  const before = f.snapshot();
  const prompt = await f.call('/api/read2lead-story-turn', { action: 'prompt', sessionId: f.view().session.id, revision: f.view().session.revision, requestId: 'unverified-prompt' });
  assert.equal(prompt.status, 503); assert.equal((await f.voice()).status, 503);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.providerCalls(), 0); assert.equal(f.claims(), 0); assert.equal(scoped.nativeCalls(), 0);
});

test('adult test account retains ungraded practice when exact package grading is not approved', async t => {
  const f = await fixture(t, { isTest: true }), scoped = await scopedVoice(f, { approved: false });
  await f.open(); await f.event('read_complete'); assert.equal(f.view().policy.providerEnabled, true);
  const spoken = await f.voice(); assert.equal(spoken.status, 200); assert.equal(spoken.body.view.session.lastVoice.assessed, false);
  assert.equal((await f.event('continue_voice')).status, 200); assert.equal(f.view().session.answered, 0);
  assert.equal(f.get('progress:' + CODE).diamonds, 2000); assert.equal(f.get('progress:' + CODE).total_xp, 0);
  assert.equal(f.providerCalls(), 1); assert.equal(scoped.nativeCalls(), 0);
});

for (const change of ['remove-assignment', 'revoke-adult-practice']) test(`async voice scope refuses ${change} before opening a session`, async t => {
  const f = await fixture(t, { isTest: true }), scoped = await scopedVoice(f, { approved: change !== 'revoke-adult-practice' });
  const assigned = await f.assign(); assert.equal(assigned.status, 200);
  const started = deferred(), resume = deferred(), resolve = f.voiceConfig.forPackage;
  f.voiceConfig.forPackage = async pkg => { started.resolve(); await resume.promise; return resolve(pkg); };
  const opening = f.call('/api/read2lead-story-session', { action: 'open_assigned', packId: assigned.body.pack_id });
  const reached = await Promise.race([started.promise.then(() => true), opening.then(() => false)]);
  assert.equal(reached, true, 'resolve the exact story voice scope before admitting the session');
  const account = f.get(CODE);
  if (change === 'remove-assignment') { account.progress.current_pack = null; account.story_pack_history = {}; }
  else account.is_test = false;
  f.put(CODE, account); resume.resolve();
  const result = await opening; assert.ok(result.status >= 400, JSON.stringify(result));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM story_sessions').get().n, 0); assert.equal(f.providerCalls(), 0); assert.equal(f.claims(), 0); assert.equal(scoped.nativeCalls(), 0);
});

test('adult draft stays test-only; ordinary accounts cannot use or promote that draft', async t => {
  const adult = await fixture(t, { isTest: true, draft: true }); await adult.open(); assert.equal(adult.view().policy.privateDraft, true); assert.equal(adult.view().policy.testProgressOnly, true);
  const account = adult.get(CODE); account.is_test = false; adult.put(CODE, account);
  assert.equal((await adult.call('/api/read2lead-story-session?sessionId=' + adult.view().session.id)).status, 404);
  const ordinary = await fixture(t, { draft: true }); assert.equal((await ordinary.assign()).status, 409); assert.equal(ordinary.providerCalls(), 0);
});

test('wrong owner, missing code, foreign origin, unassigned story, method and forged evidence are refused', async t => {
  const f = await fixture(t); await f.open(); const before = f.snapshot(), session = f.view().session;
  assert.equal((await f.call('/api/read2lead-story-session?sessionId=' + session.id, undefined, { code: OTHER })).status, 404);
  assert.equal((await f.call('/api/read2lead-story-session', undefined, { code: '' })).status, 401);
  assert.equal((await f.call('/api/read2lead-story-session', { action: 'open', storyId: 'unassigned', contentVersion: '1.0.0' })).status, 409);
  assert.equal((await f.call('/api/read2lead-story-session', { action: 'event', sessionId: session.id, requestId: 'forged', revision: session.revision, event: { type: 'read_complete', reward: 99999 } })).status, 400);
  assert.equal((await f.call('/api/read2lead-story-session', {}, { headers: { Origin: 'https://foreign.test' } })).status, 403);
  assert.equal((await f.call('/api/read2lead-story-session', undefined, { method: 'DELETE' })).status, 405);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.providerCalls(), 0);
  assert.equal((await f.call('/api/read2lead-story-session?sessionId=' + session.id, undefined, { method: 'HEAD' })).body, '');
});

test('original failed-code limiter persists failures and blocks enumeration before content/provider work', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 8; i++) assert.equal((await f.call('/api/read2lead-story-session', undefined, { code: 'UNKNOWN-' + i })).status, 401);
  assert.equal((await f.call('/api/read2lead-story-session')).status, 429); assert.equal(f.get('rl:192.0.2.5').count, 8); assert.equal(f.providerCalls(), 0);
});

test('unset host, disabled activation and exhausted budget make no provider calls', async t => {
  const absent = await fixture(t, { enabled: false }); assert.equal((await absent.call('/api/read2lead-story-session')).status, 503);
  const f = await fixture(t); await f.open(); await f.event('read_complete');
  f.voiceConfig.activation.spendingApproved = false; assert.equal((await f.voice()).status, 503); assert.equal(f.providerCalls(), 0); assert.equal(f.claims(), 0);
  f.voiceConfig.activation.spendingApproved = true; f.block(); const result = await f.voice(); assert.equal(result.status, 503); assert.equal(result.body.code, 'voice_budget_exhausted'); assert.equal(f.providerCalls(), 0);
});

test('adult practice configuration never processes normal learner audio', async t => {
  const f = await fixture(t); f.voiceConfig.practiceTrial = true; f.voiceConfig.activation.adultTrialApproved = true;
  await f.open(); await f.event('read_complete'); assert.equal(f.view().policy.providerEnabled, false); assert.equal((await f.voice()).status, 503); assert.equal(f.providerCalls(), 0);
});

for (const change of ['delete-account', 'remove-assignment', 'change-pin', 'withdraw-content']) test(`audio in flight cannot save after ${change}`, async t => {
  const f = await fixture(t); await f.open(); await f.event('read_complete');
  const started = deferred(), resume = deferred(), original = f.provider.transcribe;
  f.provider.transcribe = async audio => { started.resolve(); await resume.promise; return original(audio); };
  const speaking = f.voice(); await started.promise;
  if (change === 'delete-account') f.db.prepare('DELETE FROM read2lead_account_kv WHERE key=?').run(CODE);
  else if (change === 'withdraw-content') f.record.status = 'withdrawn';
  else { const account = f.get(CODE); account.story_pack_history = {}; if (change === 'remove-assignment') account.progress.current_pack = null; else account.progress.current_pack.story_reference.sha256 = '0'.repeat(64); f.put(CODE, account); }
  const before = f.db.prepare('SELECT state FROM story_sessions').get().state; resume.resolve();
  const result = await speaking; assert.ok(result.status >= 400); assert.equal(f.db.prepare('SELECT state FROM story_sessions').get().state, before);
  assert.equal(f.db.prepare('SELECT status FROM story_speech_turns').get().status, 'failed'); assert.equal(f.get('progress:' + CODE).diamonds, 2000);
});

test('assignment changes during package loading are refused before opening a session', async t => {
  const f = await fixture(t); const assigned = await f.assign(); assert.equal(assigned.status, 200);
  const started = deferred(), resume = deferred(); f.lookup(async key => { if (key.startsWith('package:')) { started.resolve(); await resume.promise; } });
  const opening = f.call('/api/read2lead-story-session', { action: 'open_assigned', packId: assigned.body.pack_id }); await started.promise;
  const account = f.get(CODE); account.story_pack_history = {}; account.progress.current_pack = null; f.put(CODE, account); resume.resolve();
  assert.equal((await opening).status, 404); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM story_sessions').get().n, 0);
});

test('final HTTP completion failure leaves session, receipt and profile unchanged; exact request retry/replay once', async t => {
  const f = await fixture(t); await f.throughRetell(); assert.equal((await f.voice()).status, 200);
  const input = { action: 'event', sessionId: f.view().session.id, revision: f.view().session.revision, requestId: 'final-reward', event: { type: 'continue_voice' } };
  const before = f.snapshot(); f.db.exec("CREATE TRIGGER final_failure BEFORE UPDATE ON read2lead_account_revision BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.equal((await f.call('/api/read2lead-story-session', input)).status, 409); assert.deepEqual(f.snapshot(), before);
  f.db.exec('DROP TRIGGER final_failure'); assert.equal((await f.call('/api/read2lead-story-session', input)).body.session.complete, true);
  assert.equal((await f.call('/api/read2lead-story-session', input)).body.replayed, true); assert.equal(f.get('progress:' + CODE).diamonds, 3000);
});

for (const change of ['changed-bytes', 'missing-media-proof', 'wrong-source']) test(`assigned content refuses ${change} before creating a session`, async t => {
  const f = await fixture(t), assigned = await f.assign(); assert.equal(assigned.status, 200);
  if (change === 'changed-bytes') f.record.package.lesson.title_en += ' altered';
  if (change === 'missing-media-proof') f.record.assetProofs = [];
  if (change === 'wrong-source') { const account = f.get(CODE); account.progress.current_pack.story_reference.source_id = 'different-source'; f.put(CODE, account); }
  const before = f.snapshot();
  const result = await f.call('/api/read2lead-story-session', { action: 'open_assigned', packId: assigned.body.pack_id });
  assert.ok([404, 409].includes(result.status), JSON.stringify(result)); assert.deepEqual(f.snapshot(), before); assert.equal(f.providerCalls(), 0);
});

test('simultaneous HTTP story completion and shop retain both results after any stale-request retry', async t => {
  const f = await fixture(t); await f.throughRetell(); assert.equal((await f.voice()).status, 200);
  const input = { action: 'event', sessionId: f.view().session.id, revision: f.view().session.revision, requestId: 'concurrent-reward', event: { type: 'continue_voice' } };
  const actions = [() => f.call('/api/read2lead-story-session', input), () => f.call('/api/read2lead-shop-buy', { code: CODE, part_id: 'png-default-detail-blue-horn-small' })];
  const replies = await Promise.all(actions.map(action => action()));
  for (let i = 0; i < replies.length; i++) {
    assert.ok([200, 409].includes(replies[i].status), JSON.stringify(replies[i]));
    if (replies[i].status === 409) assert.equal((await actions[i]()).status, 200);
  }
  const wallet = f.get('progress:' + CODE); assert.equal(wallet.diamonds, 3000); assert.equal(wallet.total_xp, 20); (assert.ok(wallet.avatar.monster.detail === 'png-default-detail-blue-horn-small'));
  assert.equal(f.get(CODE).progress.review_history.length, 2); assert.equal((await actions[0]()).body.replayed, true);
  assert.equal(f.get('progress:' + CODE).diamonds, 3000);
});
