import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRead2LeadAccountService } from '../functions/lib/read2lead/account-service.mjs';
import { createAccountTransactionRunner } from '../functions/lib/read2lead/account-transactions.mjs';
import { makeStoredBookPack } from './helpers/book-pack-fixture.mjs';

const CODE = 'R2L-SYNTHETIC-MEDIA', OTHER = 'R2L-SYNTHETIC-MEDIA-OTHER', SECRET = 'synthetic-backend-secret';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(t, { media = true, secret = SECRET } = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); let now = Date.now(), reads = [], writes = 0, onRead = null;
  const transaction = fn => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const objects = new Map([['gift/sticker.png', 'synthetic gift bytes'], ['homework/current.png', 'synthetic current homework'], ['homework/other.png', 'synthetic other homework']]);
  const bucket = { async get(key) { assert.equal(this, bucket); reads.push(key); if (onRead) await onRead(); const value = objects.get(key); return value === undefined ? null : {
    body: value, size: new TextEncoder().encode(value).length, httpEtag: '"synthetic-etag"', httpMetadata: { contentType: 'image/png' }, writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png'); },
  }; }, put() { writes++; throw Error('media writes forbidden'); }, delete() { writes++; throw Error('media deletion forbidden'); } };
  const options = { db, transaction, now: () => now, infrastructure: { READ2LEAD_BACKEND_SECRET: secret, ...(media ? { R2L_MEDIA: bucket } : {}) } };
  const service = createRead2LeadAccountService(options), run = createAccountTransactionRunner(options);
  const put = (key, value) => db.prepare('INSERT INTO read2lead_account_kv VALUES(?,?,?,?,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run('codes', key, JSON.stringify(value), null);
  const get = key => { const row = db.prepare("SELECT value FROM read2lead_account_kv WHERE namespace='codes' AND key=?").get(key); return row ? JSON.parse(row.value) : null; };
  put(CODE, { uses_remaining: 5, student_profile: { student_name: 'Synthetic', level: 'L1' }, homework: { tasks: [], photo: { id: 'photo-current', r2_key: 'homework/current.png', content_type: 'image/png' } },
    progress: { current_level: 'L1', packs_created: 0, current_pack: null, review_history: [{ pack_id: 'historic-pack' }] } });
  put(OTHER, { student_profile: { student_name: 'Other' }, homework: { tasks: [], photo: { id: 'photo-other', r2_key: 'homework/other.png' } } });
  put('config:gifts:v1', { schema_version: 1, gifts: [{ id: 'sticker', name_vi: 'Synthetic sticker', active: true, price_diamonds: 1000, image_key: 'gift/sticker.png' }] });
  const request = (pathname, body, { method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) => new Request('https://synthetic.test' + pathname,
    { method, headers: { 'CF-Connecting-IP': '192.0.2.4', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const call = (pathname, body, options) => service(request(pathname, body, options));
  const callback = body => call('/api/task-state', body, { headers: { 'X-Read2Lead-Secret': SECRET } });
  const pending = (taskId, age = 0) => { const account = get(CODE); account.progress.current_pack = { task_id: taskId, status: 'generation_in_progress', level: 'L1', created_at: new Date(Date.now() - age).toISOString() }; put(CODE, account); };
  return { db, service, run, put, get, call, callback, pending, objects, reads, writes: () => writes,
    advance: ms => { now += ms; }, onRead: fn => { onRead = fn; }, snapshot: () => ({ rows: db.prepare('SELECT * FROM read2lead_account_kv ORDER BY namespace,key').all().map(r => ({ ...r })), revision: db.prepare('SELECT revision FROM read2lead_account_revision').get().revision }) };
}

test('task callback preserves original secret validation, invalid-payload refusal and 30-minute expiry', async t => {
  const f = fixture(t), before = f.snapshot();
  for (const secret of ['', 'wrong']) for (const body of [undefined, { task_id: 'job', status: 'pending' }]) {
    assert.equal((await f.call('/api/task-state?task_id=job', body, { headers: { 'X-Read2Lead-Secret': secret } })).status, 401);
  }
  assert.equal((await f.callback({ task_id: 'job', status: 'forged' })).status, 400); assert.deepEqual(f.snapshot(), before);
  assert.equal((await f.callback({ task_id: 'job', status: 'pending', queue_position: 2 })).status, 200);
  const read = () => f.call('/api/task-state?task_id=job', undefined, { headers: { 'X-Read2Lead-Secret': SECRET } });
  assert.equal((await (await read()).json()).queue_position, 2); f.advance(30 * 60 * 1000); assert.equal((await read()).status, 404);
  const unconfigured = fixture(t, { secret: '' }); assert.equal((await unconfigured.callback({ task_id: 'job', status: 'pending' })).status, 401);
});

test('completed task callback and simultaneous original polls produce one readable pack and spend one credit', async t => {
  const f = fixture(t); f.pending('job-done');
  const payload = { task_id: 'job-done', status: 'done', result: { topic: 'Synthetic', story_title: 'Synthetic book', review_context: makeStoredBookPack() } };
  assert.equal((await f.callback(payload)).status, 200);
  const poll = () => f.call(`/api/check-generation-status?access_code=${CODE}&task_id=job-done`);
  const responses = await Promise.all([poll(), poll()]); assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const [first, second] = await Promise.all(responses.map(r => r.json())); assert.equal(first.pack_id, second.pack_id);
  assert.equal(f.get(CODE).uses_remaining, 4); assert.equal(f.get(CODE).progress.packs_created, 1); assert.equal(f.get(CODE).progress.review_history[0].pack_id, 'historic-pack');
  assert.equal((await f.call(`/api/read2lead-lesson?code=${CODE}&pack_id=${first.pack_id}`)).status, 200);
  assert.equal((await f.callback(payload)).status, 200); assert.equal((await poll()).status, 200); assert.equal(f.get(CODE).uses_remaining, 4);
});

for (const outcome of ['error', 'timeout']) test(`terminal generation ${outcome} keeps original error status but clears the pending lesson without charging`, async t => {
  const f = fixture(t); f.pending('failed-job', outcome === 'timeout' ? 301000 : 0);
  if (outcome === 'error') assert.equal((await f.callback({ task_id: 'failed-job', status: 'error', error: 'synthetic_provider_failure' })).status, 200);
  const result = await f.call(`/api/check-generation-status?access_code=${CODE}&task_id=failed-job`);
  assert.equal(result.status, outcome === 'error' ? 500 : 504); assert.equal(f.get(CODE).progress.current_pack, null);
  assert.equal(f.get(CODE).uses_remaining, 5); assert.equal(f.get(CODE).progress.review_history[0].pack_id, 'historic-pack');
});

test('callback and terminal-cleanup SQL failures roll back; ordinary unmarked 5xx cannot commit', async t => {
  const f = fixture(t); f.pending('job'); const before = f.snapshot();
  f.db.exec("CREATE TRIGGER fail_final BEFORE UPDATE ON read2lead_account_revision BEGIN SELECT RAISE(ABORT,'injected_failure'); END");
  assert.equal((await f.callback({ task_id: 'job', status: 'done', result: {} })).status, 503); assert.deepEqual(f.snapshot(), before);
  f.db.exec('DROP TRIGGER fail_final'); await f.callback({ task_id: 'job', status: 'error', error: 'synthetic_failure' }); const failedTask = f.snapshot();
  f.db.exec("CREATE TRIGGER fail_final BEFORE UPDATE ON read2lead_account_revision BEGIN SELECT RAISE(ABORT,'injected_failure'); END");
  assert.equal((await f.call(`/api/check-generation-status?access_code=${CODE}&task_id=job`)).status, 503); assert.deepEqual(f.snapshot(), failedTask);
  f.db.exec('DROP TRIGGER fail_final');
  const response = await f.run(async env => { await env.READ2LEAD_CODES.put('must-not-commit', '{}'); return Response.json({ error: 'synthetic' }, { status: 500 }); });
  assert.equal(response.status, 500); assert.equal(f.get('must-not-commit'), null);
});

test('gift image uses only the configured gift key, preserves bytes/metadata/HEAD, and performs no media writes', async t => {
  const f = fixture(t), before = f.snapshot();
  const response = await f.call('/api/read2lead-gift-image?id=sticker&key=homework/other.png'); assert.equal(response.status, 200); assert.equal(await response.text(), 'synthetic gift bytes');
  assert.equal(response.headers.get('Content-Type'), 'image/png'); assert.match(response.headers.get('Cache-Control'), /public/); assert.equal(response.headers.get('ETag'), '"synthetic-etag"');
  assert.deepEqual(f.reads, ['gift/sticker.png']); assert.equal((await f.call('/api/read2lead-gift-image?id=homework%2Fother.png')).status, 404);
  const head = await f.call('/api/read2lead-gift-image?id=sticker', undefined, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.deepEqual(f.snapshot(), before); assert.equal(f.writes(), 0);
});

test('SpeakUp serves only the account current homework photo, preserves conditional reads and refuses other/history IDs', async t => {
  const f = fixture(t), pathname = `/api/speakup-homework-photo?code=${CODE}&id=photo-current`, before = f.snapshot();
  const response = await f.call(pathname); assert.equal(response.status, 200); assert.equal(await response.text(), 'synthetic current homework'); assert.match(response.headers.get('Cache-Control'), /private/);
  assert.equal((await f.call(pathname, undefined, { headers: { 'If-None-Match': '"synthetic-etag"' } })).status, 304);
  for (const id of ['photo-other', 'photo-historic', 'homework/other.png']) assert.equal((await f.call(`/api/speakup-homework-photo?code=${CODE}&id=${id}`)).status, 404);
  assert.equal((await f.call(`/api/speakup-homework-photo?code=${OTHER}&id=photo-current`)).status, 404);
  assert.deepEqual(f.reads, ['homework/current.png', 'homework/current.png']); assert.deepEqual(f.snapshot(), before); assert.equal(f.writes(), 0);
  assert.equal((await f.call('/api/speakup-homework-photo?id=photo-current')).status, 400);
  assert.equal((await f.call('/api/speakup-homework-photo?code=UNKNOWN&id=photo-current')).status, 404); assert.equal(f.get('rl:192.0.2.4').count, 1);
});

test('missing media binding, missing object and failed object read return errors without altering accounts', async t => {
  const missing = fixture(t, { media: false }); assert.equal((await missing.call('/api/read2lead-gift-image?id=sticker')).status, 500);
  assert.equal((await missing.call(`/api/speakup-homework-photo?code=${CODE}&id=photo-current`)).status, 500);
  const f = fixture(t), before = f.snapshot(); f.objects.clear(); assert.equal((await f.call('/api/read2lead-gift-image?id=sticker')).status, 404);
  assert.equal((await f.call(`/api/speakup-homework-photo?code=${CODE}&id=photo-current`)).status, 404);
  f.onRead(() => { throw Error('synthetic bucket unavailable'); }); assert.equal((await f.call('/api/read2lead-gift-image?id=sticker')).status, 502);
  assert.equal((await f.call(`/api/speakup-homework-photo?code=${CODE}&id=photo-current`)).status, 503); assert.deepEqual(f.snapshot(), before);
});

test('authoritative account change during photo loading refuses stale media response; no bytes leak in conflict response', async t => {
  const f = fixture(t), started = deferred(), resume = deferred(); f.onRead(async () => { started.resolve(); await resume.promise; });
  const loading = f.call(`/api/speakup-homework-photo?code=${CODE}&id=photo-current`); await started.promise;
  const changed = await f.run(async env => { const account = await env.READ2LEAD_CODES.get(CODE, { type: 'json' }); account.homework = null; await env.READ2LEAD_CODES.put(CODE, JSON.stringify(account)); return Response.json({ ok: true }); });
  assert.equal(changed.status, 200); resume.resolve(); const response = await loading; assert.equal(response.status, 409); assert.doesNotMatch(await response.text(), /synthetic current homework/);
  assert.equal((await f.call(`/api/speakup-homework-photo?code=${CODE}&id=photo-current`)).status, 404); assert.equal(f.writes(), 0);
});
