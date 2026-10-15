import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { createLocalHandlers } from '../functions/lib/read2lead/self-learn/handlers.mjs';
const access = JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/access.json', import.meta.url)));
const lessons = JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/reference-lessons.json', import.meta.url))).lessons;
const lesson = lessons[2], origin = 'http://127.0.0.1:18770', prefix = '/api/read2lead/self-learn/';
const roots = resolve('.r2l-api-proofs'); mkdirSync(roots, { recursive: true });
const principal = { active: true, childId: 'synthetic-an' }, staff = { active: true, role: 'staff', id: 'synthetic-audit' };
function fixture(t, options = {}) {
  const root = mkdtempSync(join(roots, 'case-'));
  writeFileSync(join(root, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' }));
  const store = new SyntheticStore({ root }); let closed = false;
  const close = () => { if (!closed) { store.close(); closed = true; } }; t.after(close);
  let clock = Date.parse('2026-09-18T12:00:00.000Z');
  const config = { mode: 'synthetic-local', origin, access, lessons, store, now: () => clock, ...options };
  return { root, store, config, close, api: createLocalHandlers(config), advance(ms) { clock += ms; } };
}
async function request(f, path, { auth, method = 'GET', data, raw, headers = {}, originValue = origin } = {}) {
  const h = { ...(originValue ? { origin: originValue } : {}), ...(auth ? { cookie: auth.cookie, 'x-r2l-csrf': auth.csrf } : {}), ...headers };
  if (data !== undefined || raw !== undefined) { h['content-type'] ??= 'application/json'; method = 'POST'; }
  const req = new Request(origin + prefix + path, { method, headers: h, ...(data !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(data) } : {}) });
  const response = await f.api.handle(req), value = await response.json();
  return { response, status: response.status, value };
}
async function login(f, code = 'DEMO-FAMILY-A') {
  const r = await request(f, 'login', { data: { access_code: code } }); assert.equal(r.status, 200, JSON.stringify(r.value));
  return { cookie: r.response.headers.get('set-cookie').split(';')[0], csrf: r.value.csrf, child: r.value.active_child_id, info: r.value };
}
async function start(f, auth, request_id = 'start-one', lesson_id = lesson.id) {
  const r = await request(f, 'start', { auth, data: { request_id, child_id: auth.child, lesson_id } }); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value;
}
const event = (s, name, payload = {}, request_id = 'event-' + (s.revision + 1)) => ({ api_version: s.schema_version.slice(0, 3), request_id, child_id: s.child_id, session_id: s.session_id, expected_revision: s.revision, event: name, payload });
async function send(f, auth, s, name, payload = {}, id) {
  const r = await request(f, 'event', { auth, data: event(s, name, payload, id) }); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value;
}
const answer = (q, change = {}) => ({ item_id: q.id, choice_index: q.correct_index, text: '', evidence_sentence_ids: q.evidence_spans.map(e => e.sentence_id), support_used: [], capture_status: 'not_attempted', ...change });
const missing = { text: '', capture_status: 'missing', support_used: [] };
async function through(f, auth, target = 'complete') {
  let result = await start(f, auth);
  const steps = [['prediction', { text: '' }], ['input_complete', { order: ['read'] }],
    ...lesson.questions.map(q => ['answer', answer(q)]), ['save_understand', {}], ['begin_use', {}],
    ['shadow_complete', missing], ...lesson.minny.turns.map(x => ['minny_turn', { ...missing, turn_id: x.id }]), ['retell', missing],
    ['followup_answer', { item_id: lesson.independent_followup.id, choice_index: lesson.independent_followup.correct_index, text: '', capture_status: 'not_attempted', support_used: [] }], ['complete', {}]];
  for (const [name, data] of steps) { if (name === 'retell' && target === 'before-retell') break; result = await send(f, auth, result.session, name, data); if (name === target) break; }
  return result;
}
test('local handler configuration refuses remote origins, real identities and duplicate child ownership before registration', t => {
  const f = fixture(t), configs = [{ mode: 'production' }, { origin: 'https://example.com' }, { origin: 'http://localhost:18770' }, { origin: 'http://127.0.0.1:99999' }, { origin: 'http://127.0.0.1:80' }];
  const real = structuredClone(access); real.families[0].children[0].id = 'real-child'; configs.push({ access: real });
  const duplicate = structuredClone(access); duplicate.families[1].children.push(duplicate.families[0].children[0]); configs.push({ access: duplicate });
  for (const change of configs) assert.throws(() => createLocalHandlers({ ...f.config, ...change }), /unsafe_local_api_config/);
  assert.equal(f.store.audit(staff).entries, 0);
});
test('opaque demo access uses HttpOnly same-site cookie, expiry and own-family projection', async t => {
  const f = fixture(t), r = await request(f, 'login', { data: { access_code: 'DEMO-FAMILY-A' } });
  assert.equal(r.status, 200); const cookie = r.response.headers.get('set-cookie');
  assert.match(cookie, /^r2l_synthetic_session=[a-f0-9]{64};/); assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.deepEqual(r.value.children.map(c => c.id), ['synthetic-an', 'synthetic-binh']);
  assert.equal(JSON.stringify(r.value).includes('DEMO-FAMILY'), false); assert.equal(r.value.environment, 'synthetic');
  assert.equal(r.response.headers.get('cache-control'), 'no-store'); assert.equal(r.response.headers.has('access-control-allow-origin'), false);
});
test('origin, host and cross-site guards refuse requests without writes', async t => {
  const f = fixture(t), auth = await login(f);
  for (const change of [{ originValue: null }, { originValue: 'https://evil.invalid' }, { headers: { host: 'evil.invalid' } }, { headers: { 'sec-fetch-site': 'cross-site' } }]) {
    const r = await request(f, 'start', { auth, data: { request_id: 'blocked', child_id: auth.child, lesson_id: lesson.id }, ...change });
    assert.equal(r.status, 403); assert.equal(r.value.code, 'origin_refused');
  }
  assert.equal(f.store.history(principal, auth.child).length, 0);
});
test('auth and expiry precede malformed private payload parsing', async t => {
  const f = fixture(t, { ttlMs: 1000 });
  assert.equal((await request(f, 'event', { raw: '{bad' })).value.code, 'unauthorized');
  const auth = await login(f); f.advance(1000);
  const r = await request(f, 'event', { auth, raw: '{bad' }); assert.equal(r.status, 401); assert.equal(r.value.code, 'access_expired');
});
test('CSRF token is required before private mutation and body authority cannot replace it', async t => {
  const f = fixture(t), auth = await login(f);
  const r = await request(f, 'start', { auth, headers: { 'x-r2l-csrf': 'forged' }, data: { csrf: auth.csrf, request_id: 'x', child_id: auth.child, lesson_id: lesson.id } });
  assert.equal(r.value.code, 'csrf_failed'); assert.equal(f.store.history(principal, auth.child).length, 0);
});
test('child selection and each session/event enforce own family and current sibling', async t => {
  const f = fixture(t), a = await login(f), b = await login(f, 'DEMO-FAMILY-B'), opened = await start(f, a);
  assert.equal((await request(f, 'child', { auth: a, data: { child_id: b.child } })).value.code, 'wrong_child');
  assert.equal((await request(f, 'session?session_id=' + opened.session.session_id, { auth: b })).value.code, 'wrong_child');
  assert.equal((await request(f, 'child', { auth: a, data: { child_id: 'synthetic-binh' } })).status, 200);
  assert.equal((await request(f, 'event', { auth: a, data: event(opened.session, 'prediction', { text: '' }) })).value.code, 'wrong_child');
  assert.equal(f.store.read(principal, a.child, opened.session.session_id).revision, 0);
});
test('malformed, media, length and duplicate-cookie inputs are refused precisely', async t => {
  const f = fixture(t), auth = await login(f);
  assert.equal((await request(f, 'start', { auth, raw: '{bad' })).value.code, 'invalid_json');
  assert.equal((await request(f, 'start', { auth, raw: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(f, 'start', { auth, raw: ' '.repeat(32769) })).status, 413);
  assert.equal((await request(f, 'start', { auth, raw: '{}', headers: { 'content-length': '50000' } })).status, 413);
  assert.equal((await request(f, 'me', { auth, headers: { cookie: auth.cookie + '; ' + auth.cookie } })).value.code, 'unauthorized');
});
test('start is idempotent under concurrency and changed lesson conflicts', async t => {
  const f = fixture(t), auth = await login(f), results = await Promise.all([start(f, auth), start(f, auth)]);
  assert.equal(results[0].session.session_id, results[1].session.session_id); assert.equal(results.filter(x => x.replayed).length, 1);
  assert.equal(f.store.history(principal, auth.child).length, 1);
  const r = await request(f, 'start', { auth, data: { request_id: 'start-one', child_id: auth.child, lesson_id: lessons[0].id } });
  assert.equal(r.value.code, 'request_conflict');
});
test('actual handler/store L2 Understand and Use credit two participation milestones only', async t => {
  const f = fixture(t), auth = await login(f), result = await through(f, auth);
  assert.equal(result.session.stage, 'complete'); assert.equal(result.wallet.balance, 10); assert.equal(result.wallet.ledger.length, 2);
  assert.equal(result.current_view.summary.reading.length, 3); assert.ok(result.current_view.summary.reading.every(x => x.status === 'provisional'));
  assert.ok(result.current_view.summary.speech.every(x => x.oral_language_state === 'unassessable'));
  assert.equal(result.current_view.summary.automatic_mastery, false); assert.equal(f.store.audit(staff).ok, true);
  const list = await request(f, 'lessons?level=L2', { auth }); assert.equal(list.value.lessons.length, 1); assert.equal(list.value.sessions[0].stage, 'complete');
});
test('lost response replay preserves original receipt and explicitly labels latest view', async t => {
  const f = fixture(t), auth = await login(f), opened = await start(f, auth), body = event(opened.session, 'prediction', { text: '' });
  const first = await request(f, 'event', { auth, data: body });
  await send(f, auth, first.value.session, 'input_complete', { order: ['read'] });
  const replay = await request(f, 'event', { auth, data: body });
  assert.equal(replay.value.replayed, true); assert.equal(replay.value.session.revision, 1); assert.equal(replay.value.current_view.session.revision, 2);
  assert.deepEqual(replay.value.session, first.value.session); assert.equal(replay.value.wallet.balance, 0);
});
test('stale revision, changed request body and injected grade cannot mutate stored state', async t => {
  const f = fixture(t), auth = await login(f), opened = await start(f, auth), body = event(opened.session, 'prediction', { text: '' });
  await request(f, 'event', { auth, data: body });
  for (const [data, code] of [[{ ...body, request_id: 'second' }, 'stale_revision'], [{ ...body, payload: { text: 'changed' } }, 'request_conflict'], [{ ...body, grade: 100, diamonds: 999 }, 'invalid_request']]) {
    const r = await request(f, 'event', { auth, data }); assert.equal(r.value.code, code);
  }
  assert.equal(f.store.read(principal, auth.child, opened.session.session_id).revision, 1); assert.equal(f.store.audit(staff).entries, 0);
});
test('catalogue version changes preserve existing pinned session and same start replay', async t => {
  const f = fixture(t), auth = await login(f), opened = await start(f, auth);
  const newer = structuredClone(lessons); newer[2].version = '2.0.0'; newer[2].title_en = 'New draft title';
  f.api = createLocalHandlers({ ...f.config, lessons: newer }); const after = await login(f);
  const replay = await start(f, after); assert.equal(replay.session.content_sha256, opened.session.content_sha256); assert.equal(replay.view.lesson.version, '1.0.0');
  const fresh = await start(f, after, 'fresh'); assert.equal(fresh.view.lesson.version, '2.0.0'); assert.notEqual(fresh.session.content_sha256, opened.session.content_sha256);
});
test('real database reopen keeps acknowledged progress while server auth requires fresh login', async t => {
  const f = fixture(t), auth = await login(f), result = await through(f, auth, 'save_understand');
  f.close(); // Actual close/reopen, not a second simultaneously open connection.
  const store = new SyntheticStore({ root: f.root }); t.after(() => store.close());
  f.api = createLocalHandlers({ ...f.config, store });
  assert.equal((await request(f, 'me', { auth })).value.code, 'unauthorized');
  const next = await login(f), restored = await request(f, 'session?session_id=' + result.session.session_id, { auth: next });
  assert.equal(restored.value.view.session.stage, 'understand_saved'); assert.equal(restored.value.wallet.balance, 5);
});
test('private key injection never enters child lesson, checkpoint, history or summary DTO', async t => {
  const source = structuredClone(lessons); source[2].secret = 'PRIVATE_SENTINEL'; source[2].questions[0].auth_token = 'PRIVATE_SENTINEL';
  const f = fixture(t, { lessons: source }), auth = await login(f), opened = await start(f, auth);
  const db = new DatabaseSync(join(f.root, 'read2lead-synthetic.sqlite'));
  const record = f.store.record(principal, auth.child, opened.session.session_id); record.session.private_token = 'PRIVATE_SENTINEL'; record.private_audio = 'PRIVATE_SENTINEL';
  db.prepare('UPDATE sessions SET record_json=? WHERE id=?').run(JSON.stringify(record), opened.session.session_id); db.close();
  for (const path of ['session?session_id=' + opened.session.session_id, 'lessons']) {
    const r = await request(f, path, { auth }), wire = JSON.stringify(r.value);
    assert.equal(wire.includes('PRIVATE_SENTINEL'), false); for (const key of ['correct_index', 'accepted_meanings', 'expected_meaning', 'essential_facts\": [', 'distractors', 'receipts']) assert.equal(wire.includes(key), false, key);
  }
});
test('known paraphrase and fluent wrong choice text are distinguished without grading unknown paraphrases', async t => {
  const f = fixture(t), auth = await login(f); let result = await through(f, auth, 'input_complete');
  result = await send(f, auth, result.session, 'answer', answer(lesson.questions[0], { text: lesson.questions[0].accepted_meanings[1] }));
  assert.equal(result.current_view.summary.reading[0].explanation_result, 'known_supported');
  result = await send(f, auth, result.session, 'answer', answer(lesson.questions[1], { text: lesson.questions[1].options_en[1] }));
  assert.equal(result.current_view.summary.reading[1].status, 'needs_support');
  result = await send(f, auth, result.session, 'answer', answer(lesson.questions[2], { text: 'A cover will protect it from the drops.' }));
  assert.equal(result.current_view.summary.reading[2].status, 'pending'); assert.equal(result.current_view.summary.reading[2].score, null);
});
test('correct choice with incompatible evidence remains needs-support, never mastery', async t => {
  const f = fixture(t), auth = await login(f), result = await through(f, auth, 'input_complete');
  const next = await send(f, auth, result.session, 'answer', answer(lesson.questions[0], { evidence_sentence_ids: ['s1'] }));
  assert.equal(next.current_view.summary.reading[0].status, 'needs_support'); assert.equal(next.current_view.summary.reading[0].independent_mastery, false);
});
test('hint is persisted before it is revealed and later answer cannot remove assistance', async t => {
  const f = fixture(t), auth = await login(f); let result = await through(f, auth, 'input_complete');
  assert.deepEqual(result.current_view.support, []);
  result = await send(f, auth, result.session, 'support', { item_id: lesson.questions[0].id, kind: 'revealing_hint' });
  assert.equal(result.current_view.support[0].sentences[0].id, 's6');
  result = await send(f, auth, result.session, 'answer', answer(lesson.questions[0]));
  assert.equal(result.current_view.summary.reading[0].status, 'assisted'); assert.deepEqual(result.current_view.summary.reading[0].support_used, ['revealing_hint']);
});
test('missing model audio refuses listen completion but reading and saved milestone remain usable', async t => {
  const f = fixture(t), auth = await login(f), result = await through(f, auth, 'prediction');
  const r = await request(f, 'event', { auth, data: event(result.session, 'input_complete', { order: ['listen'] }) });
  assert.equal(r.value.code, 'content_unavailable');
  const next = await send(f, auth, result.session, 'input_complete', { order: ['read'] }); assert.equal(next.session.input_mode, 'independent_reading');
});
test('dialogue uses pinned prepared current turn and no provider/grade authority', async t => {
  const f = fixture(t), auth = await login(f), result = await through(f, auth, 'shadow_complete');
  const r = await request(f, 'dialogue?session_id=' + result.session.session_id, { auth });
  assert.equal(r.value.dialogue.reason, 'disabled'); assert.equal(r.value.dialogue.reply_en, lesson.minny.turns[0].prompt_en);
  assert.match(r.value.dialogue.identity_vi, /AI/); assert.equal(r.value.dialogue.score, null); assert.equal(f.store.wallet(principal, auth.child).balance, 5);
});
test('typed retell content and absent oral evidence remain separate, with no invented scores', async t => {
  const f = fixture(t), auth = await login(f); let result = await through(f, auth, 'before-retell');
  result = await send(f, auth, result.session, 'retell', { text: 'Mai put map in box because rain. Paper dry.', capture_status: 'not_attempted', support_used: [] });
  const evidence = result.current_view.summary.speech.find(x => x.activity === 'retell');
  assert.equal(evidence.content_state, 'pending'); assert.equal(evidence.oral_language_state, 'unassessable'); assert.equal(evidence.language_intelligibility, null); assert.equal(evidence.essential_facts, null);
});
test('logout revokes server access and expires cookie', async t => {
  const f = fixture(t), auth = await login(f), r = await request(f, 'logout', { auth, data: {} });
  assert.equal(r.status, 200); assert.match(r.response.headers.get('set-cookie'), /Max-Age=0/); assert.equal((await request(f, 'me', { auth })).status, 401);
});
test('login attempts are bounded and diagnostics omit credentials and transcript text', async t => {
  const f = fixture(t);
  for (let i = 0; i < 20; i++) assert.equal((await request(f, 'login', { data: { access_code: 'not-valid' } })).value.code, 'invalid_access');
  assert.equal((await request(f, 'login', { data: { access_code: 'DEMO-FAMILY-A' } })).value.code, 'rate_limited');
  f.advance(60000); await login(f);
  const report = f.api.diagnostics(); assert.equal(report.login_failures, 20); assert.equal(report.provider_enabled, false); assert.deepEqual(Object.keys(report).sort(), ['active_sessions', 'errors', 'login_failures', 'provider_enabled', 'requests', 'scope']);
});
test('unexpected storage failures return generic recovery without exposing raw error details', async t => {
  const f = fixture(t), auth = await login(f);
  const original = f.store.history; f.store.history = () => { throw new Error('SECRET_INTERNAL_DETAIL'); };
  const r = await request(f, 'lessons', { auth }); f.store.history = original;
  assert.equal(r.status, 503); assert.deepEqual(r.value, { ok: false, code: 'temporarily_unavailable' });
});
for (const change of ['logout', 'expire', 'sibling']) test(`pending request rechecks ${change} before mutation`, async t => {
  const f = fixture(t, { ttlMs: 1000 }), auth = await login(f), opened = await start(f, auth);
  let release, pulled;
  const waiting = new Promise(resolve => { pulled = resolve; });
  const stream = new ReadableStream({ pull(controller) { pulled(); return new Promise(resolve => { release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(event(opened.session, 'prediction', { text: '' })))); controller.close(); resolve(); }; }); } });
  const req = new Request(origin + prefix + 'event', { method: 'POST', headers: { origin, cookie: auth.cookie, 'x-r2l-csrf': auth.csrf, 'content-type': 'application/json' }, body: stream, duplex: 'half' });
  const pending = f.api.handle(req); await waiting;
  if (change === 'expire') f.advance(1000);
  else if (change === 'logout') await request(f, 'logout', { auth, data: {} });
  else await request(f, 'child', { auth, data: { child_id: 'synthetic-binh' } });
  release(); const result = await pending, data = await result.json();
  assert.equal(data.code, change === 'logout' ? 'unauthorized' : change === 'expire' ? 'access_expired' : 'wrong_child');
  assert.equal(f.store.read(principal, auth.child, opened.session.session_id).revision, 0);
});
test('start rechecks live authorization inside transaction after asynchronous hashing', async t => {
  const f = fixture(t), auth = await login(f); let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const original = f.store.start.bind(f.store);
  f.store.start = async (...args) => { enter(); await gate; return original(...args); };
  const pending = request(f, 'start', { auth, data: { request_id: 'delayed', child_id: auth.child, lesson_id: lesson.id } });
  await entered; await request(f, 'logout', { auth, data: {} }); release();
  assert.equal((await pending).value.code, 'unauthorized'); assert.equal(f.store.history(principal, auth.child).length, 0);
});
test('live login session count is capped and expired entries are reclaimed without data deletion', async t => {
  const f = fixture(t);
  for (let i = 0; i < 64; i++) { if (i % 20 === 0) f.advance(60000); await login(f); }
  assert.equal(f.api.diagnostics().active_sessions, 64);
  assert.equal((await request(f, 'login', { data: { access_code: 'DEMO-FAMILY-A' } })).value.code, 'rate_limited');
  f.advance(3600000); await login(f); assert.equal(f.api.diagnostics().active_sessions, 1); assert.equal(f.store.audit(staff).ok, true);
});
