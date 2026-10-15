import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, SessionClient } from '../src/lib/read2lead/self-learn/api-client.mjs';
import { escapeHTML, renderPlayer } from '../src/lib/read2lead/self-learn/player-views.mjs';
import { readFileSync } from 'node:fs';
import { createJourney } from '../functions/lib/read2lead/self-learn/journey.mjs';
import { sessionView } from '../functions/lib/read2lead/self-learn/views.mjs';
const snapshot = (revision = 0, ids = []) => ({ schema_version: '1.2.0', session_id: 'client-session', child_id: 'synthetic-an', revision, acknowledged_request_ids: ids });
function cacheFixture() {
  let row = null;
  return {
    async accept(scope, s) { if (!row || s.revision >= row.acknowledged.revision) { const pending = row?.pending && !s.acknowledged_request_ids.includes(row.pending.request_id) ? row.pending : null; row = { acknowledged: structuredClone(s), pending, state: pending ? (pending.expected_revision < s.revision ? 'conflict' : 'pending') : 'acknowledged' }; } return structuredClone(row); },
    async enqueue(scope, event) { if (row.pending) throw new ApiError('pending_exists'); row.pending = structuredClone(event); row.state = 'pending'; return structuredClone(row); },
    async acknowledge(scope, r) { assert.ok(r.session.acknowledged_request_ids.includes(r.request_id)); return this.accept(scope, r.session); },
    async read() { return structuredClone(row); },
    async discardPending(scope, id, request) { assert.equal(request, row.pending.request_id); row.pending = null; row.state = 'acknowledged'; return structuredClone(row); },
  };
}
async function make(api) { const c = new SessionClient({ api, cache: cacheFixture(), scope: { child_id: 'synthetic-an', epoch: 1 }, view: { session: snapshot() } }); await c.accept(c.view, { balance: 0 }); return c; }
test('client transport is same-origin, sends CSRF and rejects non-JSON/auth responses', async () => {
  const seen = []; const api = new ApiClient({ fetcher: async (url, options) => { seen.push({ url, options }); return Response.json({ ok: true }); } }); api.csrf = 'test-csrf';
  await api.request('event', { a: 1 }); assert.equal(seen[0].options.credentials, 'same-origin'); assert.equal(seen[0].options.mode, 'cors'); assert.equal(seen[0].options.redirect, 'error'); assert.equal(seen[0].options.headers['X-R2L-CSRF'], 'test-csrf');
  assert.equal(seen[0].url, '/api/read2lead/self-learn/event');
  for (const route of ['https://elsewhere.test', '//elsewhere.test', '../editor/login', 'login#fragment', 'event?role=staff']) await assert.rejects(api.request(route), /invalid_route/);
  assert.equal(seen.length, 1);
  api.fetcher = async () => new Response('<html>'); await assert.rejects(api.request('me'), /invalid_response/);
  api.fetcher = async () => Response.json({ ok: false, code: 'access_expired' }, { status: 401 }); await assert.rejects(api.request('me'), e => e.code === 'access_expired' && e.status === 401);
  api.fetcher = async () => new Response('{bad', { headers: { 'content-type': 'application/json' } }); await assert.rejects(api.request('me'), /invalid_response/);
});
test('timeout aborts transport and is distinguishable from an offline failure', async () => {
  const api = new ApiClient({ timeoutMs: 10, fetcher: (u, o) => new Promise((done, fail) => o.signal.addEventListener('abort', () => fail(new Error('aborted')))) });
  await assert.rejects(api.request('me'), /request_timeout/);
  api.fetcher = async () => { throw Error('network'); }; await assert.rejects(api.request('me'), /connection_lost/);
});
test('pending event survives a lost response, retries same id/body and acknowledges current view', async () => {
  const seen = []; let lose = true;
  const c = await make({ async request(route, event) { seen.push(structuredClone(event)); if (lose) { lose = false; throw new ApiError('connection_lost'); } const s = snapshot(1, [event.request_id]); return { ok: true, request_id: event.request_id, session: s, current_view: { session: s }, wallet: { balance: 5 } }; } });
  await assert.rejects(c.submit('prediction', { text: 'Synthetic' }), /connection_lost/); assert.equal(c.row.state, 'pending'); assert.equal(c.view.session.revision, 0);
  await c.retry(); assert.deepEqual(seen[0], seen[1]); assert.equal(c.row.pending, null); assert.equal(c.view.session.revision, 1); assert.equal(c.wallet.balance, 5);
});
test('late replay cannot rewind progress or wallet and cross-child/session views are refused', async () => {
  const c = await make({}); await c.accept({ session: snapshot(7) }, { balance: 10 }); await c.accept({ session: snapshot(1) }, { balance: 0 });
  assert.equal(c.view.session.revision, 7); assert.equal(c.wallet.balance, 10);
  await assert.rejects(c.accept({ session: { ...snapshot(8), child_id: 'synthetic-binh' } }), /wrong_scope/);
  await assert.rejects(c.accept({ session: { ...snapshot(8), session_id: 'other-session' } }), /wrong_scope/);
});
test('deactivated client ignores a late server success and cannot send again', async () => {
  let resolve; const wait = new Promise(done => { resolve = done; }); let event;
  const c = await make({ async request(route, data) { event = data; await wait; const s = snapshot(1, [data.request_id]); return { ok: true, request_id: data.request_id, session: s, current_view: { session: s } }; } });
  const send = c.submit('prediction', { text: '' }); while (!event) await new Promise(done => setImmediate(done));
  c.deactivate(); resolve(); assert.equal(await send, false); assert.equal(c.view.session.revision, 0);
  assert.equal((await c.cache.read()).acknowledged.revision, 0);
  await assert.rejects(c.submit('prediction', { text: '' }), /operation_busy/);
});
test('stale submit refreshes authoritative view while keeping conflict for explicit discard', async () => {
  const c = await make({ async request(route) { if (route === 'event') throw new ApiError('stale_revision', 409); return { view: { session: snapshot(2, ['other']) }, wallet: { balance: 0 } }; } });
  await assert.rejects(c.submit('prediction', { text: 'Keep this draft' }), /stale_revision/);
  assert.equal(c.row.state, 'conflict'); assert.equal(c.row.pending.payload.text, 'Keep this draft'); assert.equal(c.view.session.revision, 2);
  await c.discard(); assert.equal(c.row.pending, null); assert.equal(c.view.session.revision, 2);
});
test('duplicate click cannot create a second in-flight event', async () => {
  let done, entered; const waiting = new Promise(resolve => { done = resolve; });
  const c = await make({ async request(route, event) { entered = event; await waiting; throw new ApiError('connection_lost'); } });
  const send = c.submit('prediction', { text: 'One' }); while (!entered) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(c.submit('prediction', { text: 'Two' }), /operation_busy/); done(); await assert.rejects(send, /connection_lost/); assert.equal(c.row.pending.payload.text, 'One');
});
test('retry adopts a second tab acknowledgement instead of leaving an old question visible', async () => {
  let latest = snapshot(0);
  const c = await make({ async request(route) { assert.match(route, /^session\?/); return { view: { session: latest }, wallet: { balance: 5 } }; } });
  latest = snapshot(3, ['other-tab']); await c.cache.accept(c.scope, latest);
  await c.retry(); assert.equal(c.view.session.revision, 3); assert.equal(c.row.pending, null); assert.equal(c.wallet.balance, 5);
});
test('another tab pending event is recovered after enqueue refuses a second one', async () => {
  const c = await make({ async request(route) { assert.match(route, /^session\?/); return { view: { session: snapshot() }, wallet: { balance: 0 } }; } });
  await c.cache.enqueue(c.scope, { request_id: 'other-tab', expected_revision: 0, payload: { text: 'Keep other tab draft' } });
  await assert.rejects(c.submit('prediction', { text: 'Second draft' }), /pending_exists/);
  assert.equal(c.row.pending.request_id, 'other-tab'); assert.equal(c.row.pending.payload.text, 'Keep other tab draft');
});
test('rendering escapes untrusted content and labels synthetic access, no false save or score', () => {
  assert.equal(escapeHTML('<img src=x onerror="bad">'), '&lt;img src=x onerror=&quot;bad&quot;&gt;');
  const html = renderPlayer({ access: null, loading: false, message: '<script>bad</script>' });
  assert.doesNotMatch(html, /<script>|onerror=/); assert.match(html, /&lt;script&gt;/); assert.match(html, /DEMO-FAMILY-A/); assert.match(html, /Coach Felix/); assert.match(html, /Không đăng ký tài khoản thật/);
});
test('rendered pending answer cannot claim an acknowledged save or lose its recovery text', async () => {
  const lesson = JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/reference-lessons.json', import.meta.url), 'utf8')).lessons[2];
  const view = sessionView(await createJourney({ sessionId: 'render-pending', childId: 'synthetic-an', lesson, now: '2026-09-18T00:00:00Z' }));
  const html = renderPlayer({ access: { active_child_id: 'synthetic-an', children: [{ id: 'synthetic-an', label_vi: 'An mẫu', level: 'L2' }] }, client: { view, row: { pending: { payload: { text: '<script>draft</script>' } }, state: 'pending' } } });
  assert.match(html, /Chưa xác nhận lưu/); assert.doesNotMatch(html, /Đã lưu trên máy chủ cục bộ/);
  assert.match(html, /&lt;script&gt;draft&lt;\/script&gt;/); assert.doesNotMatch(html, /correct_index|accepted_meanings/);
});
