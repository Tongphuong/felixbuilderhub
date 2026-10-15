import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { SyntheticFamilyStore } from '../scripts/lib/read2lead-self-learn-family.mjs';
import { SyntheticLibraryStore } from '../scripts/lib/read2lead-self-learn-library.mjs';
import { SyntheticEditorStore } from '../scripts/lib/read2lead-self-learn-editor.mjs';
import { createEditorHandlers } from '../functions/lib/read2lead/self-learn/editor-handlers.mjs';
import { createLocalHandlers } from '../functions/lib/read2lead/self-learn/handlers.mjs';
const read = name => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + name + '.json', import.meta.url)));
const catalogue = read('level-lessons'), interests = read('library-interests'), lesson = catalogue.lessons[2], account = read('editor-access').accounts[0];
const origin = 'http://127.0.0.1:8777', prefix = '/api/read2lead/editor/', now = '2026-09-19T05:00:00.000Z', staff = { active: true, role: 'staff', id: 'synthetic-api' };
const roots = resolve('.r2l-editor-api-proofs'); mkdirSync(roots, { recursive: true });
async function fixture(t, options = {}) {
  const root = mkdtempSync(join(roots, 'case-')); writeFileSync(join(root, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' }));
  const core = new SyntheticStore({ root }), family = new SyntheticFamilyStore({ mode: 'synthetic-local', root });
  for (const a of read('family-access').accounts) family.seed(staff, a, now);
  const library = await SyntheticLibraryStore.open({ mode: 'synthetic-local', root, catalogue, interests });
  let action = () => {}, time = Date.parse(now);
  const editor = new SyntheticEditorStore({ mode: 'synthetic-local', root, fault: name => action(name) }); editor.seed(staff, account, now);
  t.after(() => { editor.close(); library.close(); family.close(); core.close(); });
  const config = { mode: 'synthetic-local', origin, store: editor, now: () => time, ...options };
  return { root, core, family, library, editor, config, api: createEditorHandlers(config), advance(ms) { time += ms; }, setFault(fn) { action = fn; }, principal() { return editor.authenticate(account.editor_id, account.access_secret); } };
}
function req(path, { auth, data, raw, headers = {}, method = 'GET', signal } = {}) {
  if (data !== undefined || raw !== undefined) method = 'POST';
  return new Request(origin + prefix + path, { method, signal, headers: { origin, ...(auth ? { cookie: auth.cookie, 'x-r2l-editor-csrf': auth.csrf } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(method === 'POST' ? { body: raw ?? JSON.stringify(data), ...(raw instanceof ReadableStream ? { duplex: 'half' } : {}) } : {}) });
}
async function call(f, path, options) { const response = await f.api.handle(req(path, options)); return { response, status: response.status, value: await response.json() }; }
async function login(f, options = {}) { const r = await call(f, 'login', { data: { editor_id: account.editor_id, access_secret: account.access_secret }, ...options }); assert.equal(r.status, 200, JSON.stringify(r.value)); return { cookie: r.response.headers.get('set-cookie').split(';')[0], csrf: r.value.csrf, info: r.value, header: r.response.headers.get('set-cookie') }; }
const draft = (more = {}) => ({ request_id: 'draft', expected_revision: 0, lesson: structuredClone(lesson), ...more });
const steps = [
  ['draft', draft()],
  ['request-review', { request_id: 'request-review', lesson_id: lesson.id, expected_revision: 1 }],
  ['review', { request_id: 'review', lesson_id: lesson.id, expected_revision: 2, decision: 'qa_ready', note: 'Synthetic review.' }],
  ['publish-qa', { request_id: 'publish', lesson_id: lesson.id, expected_revision: 3 }],
  ['quarantine', { request_id: 'quarantine', lesson_id: lesson.id, content_revision: 1, expected_revision: 4, blocked: true, reason: 'Synthetic quarantine.' }],
  ['quarantine', { request_id: 'release', lesson_id: lesson.id, content_revision: 1, expected_revision: 5, blocked: false, reason: 'Synthetic release.' }],
];
function delayed(f, path, auth, data, extra = {}) {
  let finish, ready; const begun = new Promise(r => { ready = r; });
  const raw = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); finish = () => { c.enqueue(new TextEncoder().encode(JSON.stringify(data).slice(1))); c.close(); }; }, pull() { ready(); } });
  return { pending: call(f, path, { auth, raw, ...extra }), begun, finish: () => finish() };
}
test('editor API requires explicit loopback mode and bounded session configuration', async t => {
  const f = await fixture(t);
  for (const bad of [{ mode: 'production' }, { origin: 'https://example.com' }, { origin: 'http://127.0.0.1:80' }, { origin: 'http://127.0.0.1:99999' }, { origin: origin + '/' }, { ttlMs: 0 }, { ttlMs: 900001 }, { store: null }, { now: 3 }]) assert.throws(() => createEditorHandlers({ ...f.config, ...bad }), /unsafe_editor_api_config/);
});
test('login returns separate purpose-bound HttpOnly cookie and excludes hashes, credentials and child data', async t => {
  const f = await fixture(t), a = await login(f); assert.equal(a.info.role, 'editor'); assert.equal(a.info.publication_scope, 'synthetic_qa_only'); assert.equal(a.info.human_review, false);
  assert.match(a.header, /^r2l_synthetic_editor=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/api\/read2lead\/editor\/; Max-Age=900$/);
  assert.doesNotMatch(JSON.stringify(a.info), /access_secret|access_hash|access_salt|credentialVersion|DEMO-|family|child/);
  const familyAPI = createLocalHandlers({ mode: 'synthetic-local', origin, access: read('access'), lessons: catalogue.lessons, store: f.core, familyStore: f.family });
  const familyLogin = await familyAPI.handle(new Request(origin + '/api/read2lead/self-learn/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ access_code: 'DEMO-FAMILY-A' }) }));
  assert.equal(familyLogin.status, 200); const familyCookie = familyLogin.headers.get('set-cookie').split(';')[0];
  for (const cookie of [familyCookie, familyCookie.replace('r2l_synthetic_session=', 'r2l_synthetic_editor='), a.cookie + ';' + a.cookie, 'r2l_synthetic_editor=bad', 'x'.repeat(8193)]) assert.equal((await call(f, 'documents', { headers: { cookie } })).status, 401);
  const childResponse = await familyAPI.handle(new Request(origin + '/api/read2lead/self-learn/me', { headers: { cookie: a.cookie.replace('r2l_synthetic_editor=', 'r2l_synthetic_session=') } })); assert.equal(childResponse.status, 401);
  assert.equal((await call(f, 'login', { data: { editor_id: account.editor_id, access_secret: 'DEMO-PARENT-A-ONLY' } })).status, 401);
});
test('private authentication and CSRF precede parsing and content lookup', async t => {
  const f = await fixture(t), a = await login(f);
  for (const path of ['draft', 'review', 'quarantine', 'unknown']) assert.equal((await call(f, path, { raw: '{' })).status, 401);
  for (const path of ['draft', 'review', 'quarantine']) assert.equal((await call(f, path, { auth: { ...a, csrf: 'wrong' }, raw: '{' })).value.code, 'csrf_failed');
  assert.equal((await call(f, 'document?lesson_id=unknown')).status, 401);
  assert.equal((await call(f, 'document?lesson_id=unknown', { auth: a })).value.code, 'editor_document_not_found');
  for (const headers of [{ origin: 'https://evil.example' }, { host: 'evil.example' }, { 'sec-fetch-site': 'cross-site' }, { origin: '' }]) assert.equal((await call(f, 'draft', { auth: a, data: draft(), headers })).value.code, 'origin_refused');
  assert.equal((await call(f, 'documents', { auth: a, method: 'DELETE' })).status, 405);
  assert.equal((await call(f, 'draft', { auth: a })).status, 405);
});
test('strict body limits, UTF-8 and import rules reject malformed input without editor writes', async t => {
  const f = await fixture(t), a = await login(f);
  for (const [options, code] of [[{ raw: '{' }, 'invalid_json'], [{ raw: 'null' }, 'invalid_request'], [{ data: draft(), headers: { 'content-type': 'text/plain' } }, 'unsupported_media_type'], [{ data: draft(), headers: { 'content-length': '999999' } }, 'body_too_large'], [{ raw: 'x'.repeat(270337) }, 'body_too_large'], [{ raw: new Uint8Array([0xff]) }, 'invalid_json'], [{ data: draft({ balance: 10 }) }, 'invalid_request']]) assert.equal((await call(f, 'draft', { auth: a, ...options })).value.code, code);
  const bad = structuredClone(lesson); bad.extra = true; const invalid = await call(f, 'draft', { auth: a, data: draft({ lesson: bad }) }); assert.equal(invalid.status, 400); assert.equal(invalid.value.code, 'invalid_editor_draft'); assert.ok(invalid.value.issues.length);
  assert.deepEqual(f.editor.list(f.principal()), []);
});
test('workflow returns immutable receipts separately from current document and never grants human approval', async t => {
  const f = await fixture(t), a = await login(f);
  for (let i = 0; i < steps.length; i++) {
    const [path, data] = steps[i], r = await call(f, path, { auth: a, data }); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.equal(r.value.document.revision, i + 1); assert.equal(r.value.current_view.document.revision, i + 1);
    assert.equal(r.response.headers.get('cache-control'), 'no-store'); assert.equal(r.response.headers.get('x-content-type-options'), 'nosniff');
    if (i === 4) assert.deepEqual((await call(f, 'catalogue', { auth: a })).value.lessons, []);
  }
  const replay = await call(f, 'draft', { auth: a, data: draft() }); assert.equal(replay.value.replayed, true); assert.equal(replay.value.document.revision, 1); assert.equal(replay.value.current_view.document.revision, 6);
  assert.equal(replay.value.current_view.reviews.length, 2); assert.ok(replay.value.current_view.reviews.every(r => r.review_json.human_review === false && r.review_json.independent_review === false));
  assert.equal((await call(f, 'draft', { auth: a, data: draft({ expected_revision: 1 }) })).value.code, 'request_conflict');
  assert.equal((await call(f, 'draft', { auth: a, data: draft({ request_id: 'stale' }) })).value.code, 'stale_revision');
  assert.deepEqual((await call(f, 'catalogue', { auth: a })).value.lessons, [lesson]);
  assert.equal((await call(f, 'documents', { auth: a })).value.documents.length, 1);
  const audit = (await call(f, 'audit?lesson_id=' + lesson.id, { auth: a })).value.events; assert.equal(audit.length, 6);
  assert.equal((await call(f, 'audit', { auth: a })).value.events.length, 7);
  assert.equal((await call(f, 'document?lesson_id=' + lesson.id, { auth: a })).value.current_view.document.revision, 6);
  for (const path of ['document', 'document?lesson_id=' + lesson.id + '&lesson_id=' + lesson.id, 'document?other=x', 'audit?other=x']) assert.equal((await call(f, path, { auth: a })).status, 400);
});
for (const action of ['logout', 'expiry', 'revocation', 'abort']) test('delayed request body rechecks ' + action + ' before saving', async t => {
  const f = await fixture(t), a = await login(f), controller = new AbortController(), d = delayed(f, 'draft', a, draft(), { signal: controller.signal }); await d.begun;
  if (action === 'logout') assert.equal((await call(f, 'logout', { auth: a, data: {} })).status, 200);
  if (action === 'expiry') f.advance(900001);
  if (action === 'revocation') f.editor.setAccessEnabled(staff, { request_id: 'disable', editor_id: account.editor_id, expected_credential_version: 1, enabled: false }, now);
  if (action === 'abort') controller.abort();
  d.finish(); const r = await d.pending; assert.equal(r.value.code, { logout: 'unauthorized', expiry: 'access_expired', revocation: 'editor_access_revoked', abort: 'request_aborted' }[action]);
  if (action !== 'revocation') assert.deepEqual(f.editor.list(f.principal()), []);
});
for (const path of ['draft', 'request-review', 'review', 'publish-qa', 'quarantine']) test(path + ' checks expiry inside its write transaction', async t => {
  const f = await fixture(t), a = await login(f), index = steps.findIndex(s => s[0] === path);
  for (const [route, data] of steps.slice(0, index)) assert.equal((await call(f, route, { auth: a, data })).status, 200);
  f.setFault(name => { if (name === 'editor_before_write_lock') f.advance(900001); });
  const r = await call(f, path, { auth: a, data: steps[index][1] }); assert.equal(r.value.code, 'access_expired');
  const rows = f.editor.list(f.principal()); assert.equal(rows[0]?.revision ?? 0, index);
});
for (const op of ['draft', 'review', 'release']) test(op + ' cannot commit after logout while validation is pending', async t => {
  const f = await fixture(t); let ready, finish; const begun = new Promise(r => { ready = r; }), proceed = new Promise(r => { finish = r; });
  const method = { draft: 'saveDraft', review: 'review', release: 'setQuarantine' }[op]; let intercept = false;
  const store = new Proxy(f.editor, { get(target, key) { const value = target[key]; if (key === method) return async (...args) => { if (intercept) { ready(); await proceed; } return value.apply(target, args); }; return typeof value === 'function' ? value.bind(target) : value; } });
  f.api = createEditorHandlers({ ...f.config, store }); const a = await login(f), index = { draft: 0, review: 2, release: 5 }[op];
  for (const [path, data] of steps.slice(0, index)) assert.equal((await call(f, path, { auth: a, data })).status, 200);
  intercept = true; const pending = call(f, steps[index][0], { auth: a, data: steps[index][1] }); await begun;
  assert.equal((await call(f, 'logout', { auth: a, data: {} })).status, 200); finish(); assert.equal((await pending).value.code, 'unauthorized'); assert.equal(f.editor.list(f.principal())[0]?.revision ?? 0, index);
});
test('expiry after commit hides private response but retry after login recovers the original receipt', async t => {
  const f = await fixture(t), a = await login(f); let once = true;
  f.setFault(name => { if (name === 'editor_after_commit' && once) { once = false; f.advance(900001); } });
  assert.equal((await call(f, 'draft', { auth: a, data: draft() })).value.code, 'access_expired');
  const current = await login(f), r = await call(f, 'draft', { auth: current, data: draft() }); assert.equal(r.status, 200); assert.equal(r.value.replayed, true); assert.equal(r.value.current_view.document.revision, 1);
});
test('login rotation, logout, revocation and restart invalidate editor sessions without affecting stored revisions', async t => {
  const f = await fixture(t), a = await login(f), b = await login(f, { auth: a }); assert.notEqual(a.csrf, b.csrf); assert.equal((await call(f, 'me', { auth: a })).status, 401);
  assert.equal((await call(f, 'draft', { auth: b, data: draft() })).status, 200);
  const out = await call(f, 'logout', { auth: b, data: {} }); assert.match(out.response.headers.get('set-cookie'), /Max-Age=0/); assert.equal((await call(f, 'me', { auth: b })).status, 401);
  const c = await login(f); f.api = createEditorHandlers(f.config); assert.equal((await call(f, 'me', { auth: c })).status, 401); const d = await login(f);
  f.editor.setAccessEnabled(staff, { request_id: 'off', editor_id: account.editor_id, expected_credential_version: 1, enabled: false }, now);
  assert.equal((await call(f, 'documents', { auth: d })).value.code, 'editor_access_revoked'); assert.equal(f.api.diagnostics().active_sessions, 0);
});
test('login, write and read budgets are bounded and reset after the time window', async t => {
  const f = await fixture(t), a = await login(f);
  for (let i = 0; i < 19; i++) assert.equal((await call(f, 'login', { data: { editor_id: account.editor_id, access_secret: 'wrong-editor-secret' } })).status, 401);
  assert.equal((await call(f, 'login', { data: { editor_id: account.editor_id, access_secret: account.access_secret } })).status, 429);
  for (let i = 0; i < 60; i++) assert.equal((await call(f, 'draft', { auth: a, raw: 'null' })).status, 400);
  assert.equal((await call(f, 'draft', { auth: a, data: draft() })).status, 429);
  for (let i = 0; i < 240; i++) assert.equal((await call(f, 'documents', { auth: a })).status, 200);
  assert.equal((await call(f, 'documents', { auth: a })).status, 429); f.advance(60000); assert.equal((await call(f, 'draft', { auth: a, data: draft() })).status, 200);
});
test('session capacity is bounded and expired sessions are reclaimed', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 50; i++) { if (i && i % 20 === 0) f.advance(60000); await login(f); }
  assert.equal(f.api.diagnostics().active_sessions, 50);
  assert.equal((await call(f, 'login', { data: { editor_id: account.editor_id, access_secret: account.access_secret } })).value.code, 'session_limit');
  f.advance(900001); await login(f); assert.equal(f.api.diagnostics().active_sessions, 1);
});
test('unexpected storage failures do not expose paths, SQL or internal messages', async t => {
  const f = await fixture(t), store = new Proxy(f.editor, { get(target, key) { if (key === 'list') return () => { throw Error('PRIVATE_DB_PATH_SQL_SECRET'); }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
  f.api = createEditorHandlers({ ...f.config, store }); const a = await login(f), r = await call(f, 'documents', { auth: a }); assert.equal(r.status, 500); assert.deepEqual(r.value, { ok: false, code: 'internal_error' });
});

test('templates require current editor authority and return validated immutable copies without publishing', async t => {
  const input = [structuredClone(lesson)], f = await fixture(t, { templates: input }); input[0].title_en = 'Caller changed after configuration';
  assert.equal((await call(f, 'templates')).status, 401); const a = await login(f);
  let r = await call(f, 'templates', { auth: a }); assert.equal(r.status, 200); assert.deepEqual(r.value.templates, [lesson]); assert.equal(r.value.human_review, false);
  r.value.templates[0].title_en = 'Consumer changed'; assert.equal((await call(f, 'templates', { auth: a })).value.templates[0].title_en, lesson.title_en);
  assert.equal((await call(f, 'templates?lesson_id=' + lesson.id, { auth: a })).status, 404);
  assert.equal((await call(f, 'templates', { auth: a, data: {} })).status, 404); assert.deepEqual(f.editor.list(f.principal()), []);
  await call(f, 'logout', { auth: a, data: {} }); assert.equal((await call(f, 'templates', { auth: a })).status, 401);
});
test('templates cannot bypass strict content and private-field validation', async t => {
  const poisoned = structuredClone(lesson); poisoned.private_secret = 'PRIVATE_TEMPLATE';
  const f = await fixture(t, { templates: [poisoned] }), a = await login(f), r = await call(f, 'templates', { auth: a });
  assert.equal(r.status, 400); assert.equal(r.value.code, 'invalid_editor_draft'); assert.doesNotMatch(JSON.stringify(r.value), /PRIVATE_TEMPLATE/);
  assert.deepEqual(f.editor.list(f.principal()), []);
});
test('template configuration is bounded and duplicate IDs are refused', async t => {
  const f = await fixture(t);
  for (const templates of [null, {}, [lesson, lesson], [{ id: 'bad/id' }], [{ ...lesson, title_en: 'x'.repeat(2097153) }]]) assert.throws(() => createEditorHandlers({ ...f.config, templates }), /unsafe_editor_api_config/);
});
test('template validation rechecks expiry after asynchronous hashing', async t => {
  const f = await fixture(t, { templates: [lesson], ttlMs: 1000 }), a = await login(f);
  const pending = call(f, 'templates', { auth: a }); f.advance(1001);
  assert.equal((await pending).status, 401); assert.deepEqual(f.editor.list(f.principal()), []);
});
