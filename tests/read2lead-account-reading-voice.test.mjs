import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRead2LeadAccountService } from '../functions/lib/read2lead/account-service.mjs';
import { createAccountTransactionRunner } from '../functions/lib/read2lead/account-transactions.mjs';

const CODE = 'R2L-SYNTHETIC-READING-VOICE', OTHER = 'R2L-SYNTHETIC-OTHER-VOICE';
const text = 'The bird is singing.', homework = 'My homework sentence.';
const pack = () => ({ pack_id: 'synthetic-pack', status: 'awaiting_review', pack: {
  schema_version: 2, story: { sentences: [{ text_en: text }] }, activities: [],
  guided_listening: [{ questions: [{ question_en: 'What is singing?', options_en: ['A bird.', 'A dog.'] }] }],
} });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, { configured = true } = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let onSpeech, legacyAccess = 0; const calls = [];
  const transaction = fn => { db.exec('BEGIN'); try { const v = fn(); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const AI = { async run(model, input) { calls.push({ model, input }); if (onSpeech) return onSpeech(model, input); return new Response('synthetic reading speech').body; } };
  const options = { db, transaction, infrastructure: { ...(configured ? { AI } : {}), READ2LEAD_CODES: {
    get() { legacyAccess++; throw Error('legacy access refused'); }, put() { legacyAccess++; throw Error('legacy access refused'); },
  } } };
  const service = createRead2LeadAccountService(options), run = createAccountTransactionRunner(options);
  const set = async (key, value) => {
    const response = await run(async env => { if (value === null) await env.READ2LEAD_CODES.delete(key); else await env.READ2LEAD_CODES.put(key, JSON.stringify(value)); return new Response(null, { status: 204 }); });
    assert.equal(response.status, 204);
  };
  const get = key => { const r = db.prepare("SELECT value FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get(key); return r ? JSON.parse(r.value) : null; };
  const request = (path, body) => new Request('https://synthetic.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.128' }, body: JSON.stringify(body) });
  const speak = (value = text, extra = {}) => service(request('/api/read2lead-voice', { access_code: CODE, text: value, ...extra }));
  await set(CODE, { student_profile: { student_name: 'Synthetic', level: 'L1' }, homework: { sentences: [{ text_en: homework }] }, progress: { diamonds: 700, current_pack: pack() } });
  await set(OTHER, { progress: { current_pack: { pack: { schema_version: 2, story: { sentences: [{ text_en: 'Another learner only.' }] }, activities: [] } } } });
  t.after(() => assert.equal(legacyAccess, 0));
  return { service, request, speak, get, set, calls, restart: () => createRead2LeadAccountService(options), onSpeech(fn) { onSpeech = fn; } };
}

test('current reading sentence, word and original guided-listening question/options produce speech', async t => {
  const f = await fixture(t); const before = f.get(CODE);
  for (const value of [text, 'bird', 'What is singing?', 'A dog.']) {
    const response = await f.speak(value); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.content_type, 'audio/mpeg');
    assert.equal(Buffer.from(data.audio_b64, 'base64').toString(), 'synthetic reading speech');
  }
  assert.deepEqual(f.calls.map(c => c.input.text), [text, 'bird', 'What is singing?', 'A dog.']);
  assert.deepEqual(f.get(CODE), before);
});

test('reading and homework routes retain separate current-content permissions; caller cannot choose preparation', async t => {
  const f = await fixture(t);
  for (const value of [homework, 'Another learner only.', 'Arbitrary text.']) {
    assert.equal((await f.speak(value)).status, 403);
    assert.equal((await f.speak(value, { prepare: 'prepareMinnyVoice', pack: pack(), phrase_id: 'anything' })).status, 403);
  }
  assert.equal(f.calls.length, 0);
  const rejected = await f.service(f.request('/api/minny-voice', { access_code: CODE, text }));
  assert.equal(rejected.status, 403);
  const allowed = await f.service(f.request('/api/minny-voice', { access_code: CODE, text: homework }));
  assert.equal(allowed.status, 200); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].input.text, homework);
});

test('cached reading speech survives service reconstruction without provider repeat and never bypasses changed lesson', async t => {
  const f = await fixture(t); const first = await (await f.speak()).json();
  const replay = await f.restart()(f.request('/api/read2lead-voice', { access_code: CODE, text }));
  assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), first); assert.equal(f.calls.length, 1);
  const record = f.get(CODE); record.progress.current_pack = { pack_id: 'different' }; await f.set(CODE, record);
  const rejected = await f.speak(); assert.equal(rejected.status, 403); assert.equal((await rejected.json()).audio_b64, undefined);
  assert.equal(f.calls.length, 1);
});

for (const change of ['replace-pack', 'remove-account']) test(`reading permission revoked during provider wait: ${change}`, async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  f.onSpeech(async () => { started.resolve(); await release.promise; return new Response('withheld synthetic speech').body; });
  const response = f.speak(); await started.promise;
  if (change === 'remove-account') await f.set(CODE, null);
  else { const record = f.get(CODE); record.progress.current_pack = { pack_id: 'replacement' }; await f.set(CODE, record); }
  release.resolve(); const result = await response;
  assert.equal(result.status, change === 'remove-account' ? 404 : 403);
  assert.equal((await result.json()).audio_b64, undefined); assert.equal(f.calls.length, 1);
});

test('reading speech does not block same-service checkpoint save or overwrite it', async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  f.onSpeech(async () => { started.resolve(); await release.promise; return new Response('delayed synthetic speech').body; });
  const response = f.speak(); await started.promise; let timer;
  try {
    const saved = await Promise.race([f.service(f.request('/api/read2lead-checkpoint-save', {
      access_code: CODE, pack_id: 'synthetic-pack', snapshot: { stage: 'read', page: 3 },
    })), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('reading speech held account transaction')), 1000); })]);
    assert.equal(saved.status, 200); assert.equal((await saved.json()).stored, true);
  } finally { clearTimeout(timer); release.resolve(); }
  assert.equal((await response).status, 200); assert.equal(f.calls.length, 1);
  assert.equal(f.get(CODE).progress.diamonds, 700);
  assert.deepEqual(f.get(CODE).progress.current_pack.web_session_checkpoint.snapshot, { stage: 'read', page: 3 });
});

test('missing account/text/voice configuration refuses before synthesis', async t => {
  const f = await fixture(t); assert.equal((await f.speak('', {})).status, 400);
  assert.equal((await f.speak(text, { access_code: 'MISSING' })).status, 404); assert.equal(f.calls.length, 0);
  const noVoice = await fixture(t, { configured: false }); assert.equal((await noVoice.speak()).status, 500); assert.equal(noVoice.calls.length, 0);
});

test('reading provider errors retain original failure response and do not change the account', async t => {
  const f = await fixture(t); const before = f.get(CODE);
  f.onSpeech(async () => { throw Error('synthetic failure'); });
  const response = await f.speak(); assert.equal(response.status, 502); assert.equal((await response.json()).error, 'tts_failed');
  assert.equal(f.calls.length, 2); assert.deepEqual(f.get(CODE), before);
});
