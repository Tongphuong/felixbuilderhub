import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRead2LeadAccountService } from '../functions/lib/read2lead/account-service.mjs';
import { createAccountTransactionRunner } from '../functions/lib/read2lead/account-transactions.mjs';
import { createSpeakingMetadataStore } from '../functions/lib/read2lead/account-speaking-check.mjs';

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw Error('external network forbidden in synthetic speaking tests'); }; });
after(() => { globalThis.fetch = originalFetch; });

const CODE = 'R2L-SYNTHETIC-SPEECH', expected = 'The happy cat eats apples.';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, { coach = false, background = true, configured = true } = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let provider, legacy = 0, failCommit = false; const calls = [], jobs = [];
  const transaction = fn => { db.exec('BEGIN'); try { const r = fn(); if (failCommit) throw Error('synthetic commit failure'); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const AI = { async run(model, input) { calls.push({ model, input }); return provider ? provider(model, input) : { text: 'The cat eats apples.' }; } };
  const options = { db, transaction, infrastructure: { ...(configured ? { AI } : {}), ...(coach ? { OPENROUTER_API_KEY: 'synthetic-key' } : {}), READ2LEAD_CODES: {
    get() { legacy++; throw Error('old KV forbidden'); }, put() { legacy++; throw Error('old KV forbidden'); },
  } }, ...(background ? { scheduleBackground(p) { jobs.push(p); } } : {}) };
  const service = createRead2LeadAccountService(options), run = createAccountTransactionRunner(options);
  const set = async (key, value) => {
    const r = await run(async env => { if (value === null) await env.READ2LEAD_CODES.delete(key); else await env.READ2LEAD_CODES.put(key, JSON.stringify(value)); return new Response(null, { status: 204 }); });
    assert.equal(r.status, 204);
  };
  const get = key => { const r = db.prepare("SELECT value FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get(key); return r ? JSON.parse(r.value) : null; };
  const request = (overrides = {}) => {
    const fields = { access_code: CODE, pack_id: 'synthetic-pack', expected_text: expected, check_mode: 'read', ...overrides };
    const form = new FormData(); for (const [k,v] of Object.entries(fields)) form.set(k, v);
    if (!fields.report_silent) form.set('audio', new Blob(['synthetic non-audio bytes'], { type: 'audio/webm' }), 'synthetic.webm');
    return new Request('https://synthetic.test/api/read2lead-speaking-check', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.129' }, body: form });
  };
  await set(CODE, { student_profile: { student_name: 'Synthetic' }, homework: { sentences: [{ text_en: expected }] }, progress: {
    diamonds: 700, current_pack: { pack_id: 'synthetic-pack', status: 'awaiting_review', pack: { text: expected } }, review_history: [{ pack_id: 'historic-pack' }],
  } });
  t.after(() => assert.equal(legacy, 0));
  return { db, service, run, get, set, request, calls, jobs, speak: fields => service(request(fields)),
    provider(fn) { provider = fn; }, failCommit(value) { failCommit = value; } };
}

test('original speaking result and expiring practice words persist without changing account/reward', async t => {
  const f = await fixture(t), before = f.get(CODE), response = await f.speak();
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.transcript, 'The cat eats apples.');
  assert.ok(result.words_missed.includes('happy')); assert.ok(f.get('flagged-words:' + CODE).words.includes('happy'));
  const expiry = f.db.prepare("SELECT expires FROM read2lead_account_kv WHERE key=?").get('flagged-words:' + CODE).expires;
  assert.ok(expiry > Date.now() + 3500000 && expiry <= Date.now() + 3601000);
  assert.deepEqual(f.get(CODE), before); assert.equal(f.calls.length, 1);
});

test('original archive/general practice permission remains distinct from current lesson checks', async t => {
  const f = await fixture(t);
  for (const pack_id of ['historic-pack', 'general']) {
    assert.equal((await f.speak({ pack_id })).status, 404);
    assert.equal((await f.speak({ pack_id, practice_mode: '1' })).status, 200);
  }
  assert.equal((await f.speak({ pack_id: 'unknown', practice_mode: '1' })).status, 404); assert.equal(f.calls.length, 2);
});

test('invalid account/pack, shadow throttle and failed preflight never call provider', async t => {
  const f = await fixture(t);
  assert.equal((await f.speak({ access_code: 'MISSING' })).status, 404);
  assert.equal((await f.speak({ pack_id: 'other-account-pack' })).status, 404);
  await f.set('shd-rl:' + CODE, { first_at: Math.floor(Date.now()/1000), count: 20 });
  assert.equal((await f.speak({ practice_mode: '1', shadow_practice: '1' })).status, 429);
  f.failCommit(true); assert.equal((await f.speak()).status, 503); assert.equal(f.calls.length, 0);
});

test('silent report retains original diagnostic behavior without provider work', async t => {
  const f = await fixture(t); const r = await f.speak({ report_silent: '1' });
  assert.equal(r.status, 200); assert.equal((await r.json()).recorded, true);
  assert.equal(f.get('debug:speaking-errors')[0].code, 'silent_capture'); assert.equal(f.calls.length, 0);
});

test('speaking wait permits original same-service checkpoint save and preserves it', async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  f.provider(async () => { started.resolve(); await release.promise; return { text: 'The cat eats apples.' }; });
  const pending = f.speak(); await started.promise; let timer;
  try {
    const saved = await Promise.race([f.service(new Request('https://synthetic.test/api/read2lead-checkpoint-save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_code: CODE, pack_id: 'synthetic-pack', snapshot: { page: 4 } }),
    })), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('speaking held account transaction')), 1000); })]);
    assert.equal(saved.status, 200); assert.equal((await saved.json()).stored, true);
  } finally { clearTimeout(timer); release.resolve(); }
  assert.equal((await pending).status, 200); assert.equal(f.get(CODE).progress.diamonds, 700);
  assert.deepEqual(f.get(CODE).progress.current_pack.web_session_checkpoint.snapshot, { page: 4 });
});

test('slow recording upload does not hold the shared account queue', async t => {
  const f = await fixture(t), ready = deferred(), release = deferred(), original = f.request();
  const bytes = new Uint8Array(await original.arrayBuffer());
  const body = new ReadableStream({ async start(controller) {
    controller.enqueue(bytes.slice(0, 10)); ready.resolve(); await release.promise;
    controller.enqueue(bytes.slice(10)); controller.close();
  } });
  const uploading = f.service(new Request(original.url, { method: 'POST', headers: original.headers, body, duplex: 'half' }));
  await ready.promise; let timer;
  try {
    const saved = await Promise.race([f.service(new Request('https://synthetic.test/api/read2lead-checkpoint-save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_code: CODE, pack_id: 'synthetic-pack', snapshot: { page: 5 } }),
    })), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('upload held account queue')), 1000); })]);
    assert.equal(saved.status, 200); assert.equal((await saved.json()).stored, true);
    assert.equal(f.calls.length, 0);
  } finally { clearTimeout(timer); release.resolve(); }
  assert.equal((await uploading).status, 200);
  assert.deepEqual(f.get(CODE).progress.current_pack.web_session_checkpoint.snapshot, { page: 5 });
});

for (const change of ['delete', 'new-pack', 'same-id-content', 'homework']) test(`stale speaking result/feedback refused after ${change}`, async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  f.provider(async () => { started.resolve(); await release.promise; return { text: 'The cat eats apples.' }; });
  const pending = f.speak(); await started.promise; const record = f.get(CODE);
  if (change === 'delete') await f.set(CODE, null);
  else {
    if (change === 'new-pack') record.progress.current_pack.pack_id = 'replacement';
    if (change === 'same-id-content') record.progress.current_pack.pack.text = 'Changed content.';
    if (change === 'homework') record.homework = { sentences: [{ text_en: 'Changed homework.' }] };
    await f.set(CODE, record);
  }
  release.resolve(); const r = await pending; assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'speaking_permission_changed'); assert.equal(f.get('flagged-words:' + CODE), null); assert.equal(f.calls.length, 1);
});

test('coach requires explicit background host and missing voice configuration stays refused', async t => {
  const f = await fixture(t, { coach: true, background: false });
  const r = await f.speak(); assert.equal(r.status, 503); assert.equal((await r.json()).error, 'speaking_background_host_required'); assert.equal(f.calls.length, 0);
  const noAI = await fixture(t, { configured: false }); assert.equal((await noAI.speak()).status, 500); assert.equal(noAI.calls.length, 0);
});

test('restricted metadata merges concurrent usage increments but cannot overwrite accounts or newer feedback', async t => {
  const f = await fixture(t), options = { run: f.run, accessCode: CODE, authorize: async () => true };
  const a = createSpeakingMetadataStore(options), b = createSpeakingMetadataStore(options), key = 'azure-pa-secs:2026-10';
  await a.get(key, { type: 'json' }); await b.get(key, { type: 'json' });
  await a.put(key, '30', { expirationTtl: 3600 }); await b.put(key, '30', { expirationTtl: 3600 }); assert.equal(f.get(key), 60);
  await assert.rejects(a.put(CODE, '{}'), /key_refused/); await assert.rejects(a.get('flagged-words:ANOTHER', { type: 'json' }), /key_refused/);
  const flagged = 'flagged-words:' + CODE;
  await f.set(flagged, { words: ['happy'], sentences: ['Old sentence.'] }); await a.get(flagged, { type: 'json' });
  await f.set(flagged, { words: ['new'], sentences: ['New sentence.'] });
  await assert.rejects(a.put(flagged, JSON.stringify({ words: ['happy'], sentences: [] })), /unavailable/);
  assert.deepEqual(f.get(flagged), { words: ['new'], sentences: ['New sentence.'] });
});

test('detached coach safety survives response and retracts only its sentence', async t => {
  const f = await fixture(t, { coach: true }), guard = deferred();
  const feedback = { praise_vi: 'Con đã cố gắng.', focus_word: 'happy', model_sentence_en: 'The cat is happy.', tiny_challenge_vi: 'Con thử lại từ happy nhé.' };
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async url => { assert.match(String(url), /openrouter\.ai/); fetches++; return Response.json({ choices: [{ message: { content: JSON.stringify(feedback) } }] }); });
  f.provider(async model => model.includes('llama-guard') ? guard.promise : { text: 'The cat eats apples.' });
  let timer, response;
  try {
    response = await Promise.race([f.speak(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('background safety blocked response')), 2000); })]);
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).coach, feedback);
    assert.equal(f.jobs.length, 1); assert.equal(fetches, 1);
    assert.ok(f.get('flagged-words:' + CODE).sentences.includes(feedback.model_sentence_en));
    const current = f.get('flagged-words:' + CODE);
    await f.set('flagged-words:' + CODE, { ...current, words: [...current.words, 'fresh'],
      sentences: [...current.sentences, 'Another approved sentence.'] });
  } finally { clearTimeout(timer); guard.resolve({ response: 'unsafe\nS1' }); }
  await Promise.all(f.jobs);
  assert.deepEqual(f.get('flagged-words:' + CODE).sentences, ['Another approved sentence.']);
  assert.ok(f.get('flagged-words:' + CODE).words.includes('happy'));
  assert.ok(f.get('flagged-words:' + CODE).words.includes('fresh'));
});
