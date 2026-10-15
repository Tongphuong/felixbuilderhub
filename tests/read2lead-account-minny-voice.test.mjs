import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRead2LeadAccountService } from '../functions/lib/read2lead/account-service.mjs';
import { createAccountTransactionRunner } from '../functions/lib/read2lead/account-transactions.mjs';
import { MINNY_PHRASES } from '../functions/api/_minny-phrases.js';
import { ttsCacheKey, AURA2_MODEL, MELOTTS_MODEL } from '../functions/api/_minny-tts.js';

const CODE = 'R2L-SYNTHETIC-VOICE', OTHER = 'R2L-SYNTHETIC-OTHER';
const sentence = 'I like apples.';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(t, { configured = true, legacySpeechCache } = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let now = Date.now(), onSpeech, failedCommit = false, legacyAccess = 0;
  const calls = [];
  const transaction = fn => {
    db.exec('BEGIN');
    try { const result = fn(); if (failedCommit) throw Error('synthetic commit failure'); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const AI = { async run(model, input) {
    calls.push({ model, input });
    if (onSpeech) return onSpeech(model, input);
    return new Response('synthetic speech bytes').body;
  } };
  const legacy = { get() { legacyAccess++; throw Error('old KV must not be used'); }, put() { legacyAccess++; throw Error('old KV must not be used'); } };
  const options = { db, transaction, now: () => now, legacySpeechCache, infrastructure: { READ2LEAD_CODES: legacy, ...(configured ? { AI } : {}) } };
  const service = createRead2LeadAccountService(options), run = createAccountTransactionRunner(options);
  const get = key => { const r = db.prepare("SELECT value FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get(key); return r ? JSON.parse(r.value) : null; };
  const set = async (key, value, ttl) => {
    const response = await run(async env => {
      if (value === null) await env.READ2LEAD_CODES.delete(key);
      else await env.READ2LEAD_CODES.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : {});
      return new Response(null, { status: 204 });
    });
    assert.equal(response.status, 204);
  };
  const request = body => new Request('https://synthetic.test/api/minny-voice', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.127' }, body: JSON.stringify(body),
  });
  const speak = (body = {}) => service(request({ access_code: CODE, text: sentence, ...body }));
  const seed = async () => {
    await set(CODE, { student_profile: { student_name: 'Synthetic', level: 'L1' }, homework: { sentences: [{ text_en: sentence }] }, progress: { marker: 'preserve' } });
    await set(OTHER, { homework: { sentences: [{ text_en: 'Only another learner may hear this.' }] } });
  };
  t.after(() => assert.equal(legacyAccess, 0));
  return { db, service, run, request, speak, set, get, calls, seed, restart: () => createRead2LeadAccountService(options),
    onSpeech(fn) { onSpeech = fn; }, advance(ms) { now += ms; }, failCommit(value) { failedCommit = value; } };
}

test('reading voice remains available after standalone retirement; cached repeat survives fresh service without another synthesis', async t => {
  const f = fixture(t); await f.seed();
  const before = f.get(CODE);
  assert.equal((await f.service(new Request('https://synthetic.test/api/minny-conversation', { method: 'POST' }))).status, 410);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.get(CODE), before);
  const first = await f.speak(); assert.equal(first.status, 200);
  const audio = await first.json(); assert.equal(audio.ok, true); assert.equal(audio.content_type, 'audio/mpeg');
  assert.equal(Buffer.from(audio.audio_b64, 'base64').toString(), 'synthetic speech bytes');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].input.text, sentence);
  const again = await f.restart()(f.request({ access_code: CODE, text: sentence }));
  assert.deepEqual(await again.json(), audio); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.get(CODE), before);
});

test('original phrase, v3 homework word and current coach sentence remain allowed', async t => {
  const f = fixture(t); await f.seed();
  await f.set(CODE, { homework: { schema_version: 3, tasks: [{ type: 'read', items: [{ text_en: sentence }] }] } });
  await f.set('flagged-words:' + CODE, { words: ['banana'], sentences: ['Here is my practice sentence.'] }, 60);
  for (const body of [ { phrase_id: MINNY_PHRASES[0].id, text: '' }, { word: 'apples', text: '' }, { word: 'banana', text: '' }, { text: 'Here is my practice sentence.' } ]) {
    const r = await f.speak(body); assert.equal(r.status, 200, JSON.stringify(await r.json()));
  }
  assert.equal(f.calls.length, 4);
});

test('invalid account, arbitrary text, other learner text, hidden picture answer and invalid methods never synthesize', async t => {
  const f = fixture(t); await f.seed();
  for (const body of [{ access_code: 'MISSING' }, { text: 'Unassigned text.' }, { text: 'Only another learner may hear this.' }, { phrase_id: 'invented' }, { text: '', word: ['apples'] }]) {
    const r = await f.speak(body); assert.ok([400, 403, 404].includes(r.status));
  }
  await f.set(CODE, { homework: { schema_version: 3, tasks: [{ type: 'picture', anchors: ['secret answer'] }] } });
  assert.equal((await f.speak({ text: 'secret answer' })).status, 403);
  assert.equal((await f.service(new Request('https://synthetic.test/api/minny-voice'))).status, 405);
  assert.equal(f.calls.length, 0);
});

test('failed-code rate limiter still commits failures and blocks without provider work', async t => {
  const f = fixture(t); await f.seed();
  const statuses = [];
  for (let i = 0; i < 15; i++) statuses.push((await f.speak({ access_code: 'MISSING' })).status);
  assert.ok(statuses.includes(404)); assert.equal(statuses.at(-1), 429); assert.equal(f.calls.length, 0);
});

test('missing speech configuration and failed initial transaction cause no provider calls', async t => {
  const unconfigured = fixture(t, { configured: false }); await unconfigured.seed();
  assert.equal((await unconfigured.speak()).status, 500); assert.equal(unconfigured.calls.length, 0);
  const f = fixture(t); await f.seed(); f.failCommit(true);
  assert.equal((await f.speak()).status, 503); assert.equal(f.calls.length, 0);
});

test('account progress saves while speech is pending; synthesis cannot overwrite it', async t => {
  const f = fixture(t); await f.seed(); const started = deferred(), release = deferred();
  await f.set(CODE, { ...f.get(CODE), progress: { diamonds: 1234,
    current_pack: { pack_id: 'synthetic-pack', status: 'awaiting_review' } } });
  f.onSpeech(async () => { started.resolve(); await release.promise; return new Response('delayed synthetic speech').body; });
  const response = f.speak(); await started.promise;
  let timer;
  try {
    const saved = await Promise.race([f.service(new Request('https://synthetic.test/api/read2lead-checkpoint-save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: CODE, pack_id: 'synthetic-pack', snapshot: { stage: 'read', page: 2 } }),
    })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('speech held account transaction')), 1000); })]);
    assert.equal(saved.status, 200); assert.equal((await saved.json()).stored, true);
  } finally { clearTimeout(timer); release.resolve(); }
  assert.equal((await response).status, 200);
  assert.equal(f.get(CODE).progress.diamonds, 1234);
  assert.deepEqual(f.get(CODE).progress.current_pack.web_session_checkpoint.snapshot, { stage: 'read', page: 2 });
  assert.equal(f.calls.length, 1);
});

for (const change of ['delete-account', 'change-homework', 'expire-coach']) test(`permission change during synthesis refuses audio: ${change}`, async t => {
  const f = fixture(t); await f.seed(); const started = deferred(), release = deferred();
  if (change === 'expire-coach') {
    await f.set(CODE, { homework: { sentences: [] } });
    await f.set('flagged-words:' + CODE, { sentences: [sentence] }, 1);
  }
  f.onSpeech(async () => { started.resolve(); await release.promise; return new Response('withheld synthetic speech').body; });
  const response = f.speak(); await started.promise;
  if (change === 'delete-account') await f.set(CODE, null);
  if (change === 'change-homework') await f.set(CODE, { homework: { sentences: [] } });
  if (change === 'expire-coach') f.advance(1001);
  release.resolve(); const result = await response;
  assert.equal(result.status, change === 'delete-account' ? 404 : 403);
  assert.equal((await result.json()).audio_b64, undefined); assert.equal(f.calls.length, 1);
});

test('provider fallback behavior remains original and does not cache fallback as primary', async t => {
  const f = fixture(t); await f.seed();
  f.onSpeech(async model => { if (model === AURA2_MODEL) throw Error('synthetic primary unavailable'); assert.equal(model, MELOTTS_MODEL); return { audio: 'c3ludGhldGlj' }; });
  const r = await f.speak(); assert.equal(r.status, 200); assert.equal((await r.json()).audio_b64, 'c3ludGhldGlj');
  assert.equal(f.calls.length, 2); assert.equal(f.get(await ttsCacheKey(sentence)), null);
});

test('cache commit failure returns error without provider retry or lost account state', async t => {
  const f = fixture(t); await f.seed(); const before = f.get(CODE);
  f.onSpeech(async () => { f.failCommit(true); return new Response('synthetic speech').body; });
  assert.equal((await f.speak()).status, 502); assert.equal(f.calls.length, 1);
  assert.equal(f.get(await ttsCacheKey(sentence)), null); assert.deepEqual(f.get(CODE), before);
});

test('a cached recording does not bypass current homework permission', async t => {
  const f = fixture(t); await f.seed(); assert.equal((await f.speak()).status, 200);
  assert.ok(f.get(await ttsCacheKey(sentence)).audio_b64);
  await f.set(CODE, { homework: { sentences: [] } });
  const response = await f.speak(); assert.equal(response.status, 403);
  assert.equal((await response.json()).audio_b64, undefined); assert.equal(f.calls.length, 1);
});

test('retained speech cache is read-only, avoids regeneration and loses priority to current stored audio',async t=>{
 const keys=[];const retained={audio_b64:Buffer.from('retained speech').toString('base64'),content_type:'audio/mpeg'};
 const f=fixture(t,{legacySpeechCache:{async get(key,options){keys.push(key);assert.equal(options.type,'json');return retained;},put(){throw Error('legacy cache is read only');}}});await f.seed();
 const key=await ttsCacheKey(sentence),before=f.get(CODE);
 assert.equal((await f.speak({text:'Unassigned text.'})).status,403);assert.deepEqual(keys,[]);
 const response=await f.speak();assert.equal(response.status,200);assert.equal((await response.json()).audio_b64,retained.audio_b64);assert.deepEqual(keys,[key]);assert.equal(f.calls.length,0);assert.equal(f.get(key),null);assert.deepEqual(f.get(CODE),before);
 await f.set(key,{audio_b64:Buffer.from('current speech').toString('base64'),content_type:'audio/mpeg'});
 assert.equal((await (await f.speak()).json()).audio_b64,Buffer.from('current speech').toString('base64'));assert.deepEqual(keys,[key]);assert.equal(f.calls.length,0);
});

test('failed retained-cache read never triggers paid fallback or changes an account',async t=>{
 const f=fixture(t,{legacySpeechCache:{async get(){throw Error('retained cache unavailable');}}});await f.seed();const before=f.get(CODE);
 const response=await f.speak();assert.ok(response.status>=500);assert.equal(f.calls.length,0);assert.deepEqual(f.get(CODE),before);
});

test('permission is checked again after a delayed retained-cache read',async t=>{
 const started=deferred(),release=deferred();const f=fixture(t,{legacySpeechCache:{async get(){started.resolve();await release.promise;return{audio_b64:Buffer.from('must not leak').toString('base64'),content_type:'audio/mpeg'};}}});await f.seed();
 const request=f.speak();await started.promise;await f.set(CODE,{homework:{sentences:[]}});release.resolve();
 const response=await request;assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/must not leak|bXVzdCBub3QgbGVhaw/);assert.equal(f.calls.length,0);
});
