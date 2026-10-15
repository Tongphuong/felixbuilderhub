import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { SyntheticFamilyStore } from '../scripts/lib/read2lead-self-learn-family.mjs';
import { createLocalHandlers } from '../functions/lib/read2lead/self-learn/handlers.mjs';
const json = name => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + name, import.meta.url)));
const access = json('access.json'), seed = json('family-access.json'), lessons = json('level-lessons.json').lessons, lesson = lessons[2];
const origin = 'http://127.0.0.1:18772', prefix = '/api/read2lead/self-learn/';
const roots = resolve('.r2l-family-api-proofs'); mkdirSync(roots, { recursive: true });
const staff = { active: true, role: 'staff', id: 'synthetic-family-api' };
const now = '2026-09-18T12:00:00.000Z';
function fixture(t, options = {}) {
  const root = mkdtempSync(join(roots, 'case-'));
  writeFileSync(join(root, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' }));
  const store = new SyntheticStore({ root }), familyStore = new SyntheticFamilyStore({ mode: 'synthetic-local', root });
  for (const a of seed.accounts) familyStore.seed(staff, a, now);
  let time = Date.parse(now), closed = false;
  const config = { mode: 'synthetic-local', origin, access, lessons, store, familyStore, now: () => time, ...options };
  const close = () => { if (!closed) { familyStore.close(); store.close(); closed = true; } }; t.after(close);
  return { root, store, familyStore, config, api: createLocalHandlers(config), close, advance(ms) { time += ms; } };
}
function req(path, { auth, data, raw, headers = {}, method = 'GET' } = {}) {
  if (data !== undefined || raw !== undefined) method = 'POST';
  return new Request(origin + prefix + path, { method,
    headers: { origin, ...(auth ? { cookie: auth.cookie, 'x-r2l-csrf': auth.csrf } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(method === 'POST' ? { body: raw ?? JSON.stringify(data), ...(raw instanceof ReadableStream ? { duplex: 'half' } : {}) } : {}) });
}
async function call(f, path, options) { const response = await f.api.handle(req(path, options)); return { response, status: response.status, value: await response.json() }; }
function auth(r) { assert.equal(r.status, 200, JSON.stringify(r.value)); return { cookie: r.response.headers.get('set-cookie').split(';')[0], csrf: r.value.csrf, info: r.value }; }
async function login(f, code = 'DEMO-FAMILY-A') { return auth(await call(f, 'login', { data: { access_code: code } })); }
async function parent(f, a, secret = 'DEMO-PARENT-A-ONLY') { return auth(await call(f, 'parent/enter', { auth: a, data: { parent_secret: secret } })); }
const recovery = (over = {}) => ({ family_id: 'synthetic-family-a', request_id: 'recovery-1', recovery_code: 'DEMO-RECOVERY-FAMILY-A-2026', new_access_code: 'RECOVERED-FAMILY-A', new_parent_secret: 'RECOVERED-PARENT-A', new_recovery_code: 'RECOVERED-FAMILY-A-TOKEN-2026', ...over });
const update = (over = {}) => ({ request_id: 'update-1', child_id: 'synthetic-an', expected_revision: 0, display_name: 'An renamed', archived: false, learning_enabled: true, recording_allowed: false, ...over });
async function start(f, a, id = 'family-start') { const r = await call(f, 'start', { auth: a, data: { request_id: id, child_id: 'synthetic-an', lesson_id: lesson.id } }); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value; }
const event = (s, name, payload = {}, id = 'event-' + s.revision) => ({ api_version: '1.2', request_id: id, child_id: s.child_id, session_id: s.session_id, expected_revision: s.revision, event: name, payload });
async function send(f, a, s, name, payload = {}) { const r = await call(f, 'event', { auth: a, data: event(s, name, payload) }); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value; }
const coreChild = { active: true, childId: 'synthetic-an' };
async function through(f, a, target = 'save_understand') {
  let r = await start(f, a);
  const steps = [['prediction', { text: 'PRIVATE_CHILD_ANSWER' }], ['input_complete', { order: ['read'] }],
    ['support', { item_id: lesson.questions[0].id, kind: 'revealing_hint' }],
    ...lesson.questions.map(q => ['answer', { item_id: q.id, choice_index: q.correct_index, text: '', evidence_sentence_ids: q.evidence_spans.map(e => e.sentence_id), support_used: [], capture_status: 'not_attempted' }]),
    ['save_understand', {}], ['begin_use', {}], ['shadow_complete', { text: 'PRIVATE_CHILD_TRANSCRIPT', capture_status: 'not_attempted', support_used: ['reference_script'] }]];
  for (const [name, p] of steps) { r = await send(f, a, r.session, name, p); if (name === target) break; } return r;
}
function delayed(f, path, a, data) {
  let finish, ready; const begun = new Promise(r => { ready = r; });
  const raw = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); finish = () => { c.enqueue(new TextEncoder().encode(JSON.stringify(data).slice(1))); c.close(); }; }, pull() { ready(); } });
  const pending = call(f, path, { auth: a, raw }); return { pending, begun, finish };
}

test('family login exposes current least-privilege children and recording-off without secrets', async t => {
  const f = fixture(t), a = await login(f); assert.equal(a.info.role, 'child'); assert.equal(a.info.parent_expires_at, null);
  assert.deepEqual(a.info.children.map(c => [c.id, c.recording_allowed]), [['synthetic-an', false], ['synthetic-binh', false]]);
  assert.equal(a.info.consent_scope, 'synthetic_local_only');
  assert.doesNotMatch(JSON.stringify(a.info), /DEMO-|hash|salt|credential|parent_secret|recovery_code/);
  assert.equal((await call(f, 'parent/family', { auth: a })).value.code, 'parent_required');
  assert.equal((await call(f, 'parent/create-child', { auth: a, raw: '{' })).value.code, 'parent_required');
  assert.equal((await call(f, 'parent/create-child', { raw: '{' })).value.code, 'unauthorized');
});
test('parent elevation and exit rotate cookie and CSRF; old tokens and forged role are refused', async t => {
  const f = fixture(t), a = await login(f);
  assert.equal((await call(f, 'parent/enter', { auth: a, data: { parent_secret: 'incorrect-secret' } })).value.code, 'invalid_access');
  assert.equal((await call(f, 'parent/enter', { auth: a, data: { parent_secret: 'DEMO-PARENT-A-ONLY', role: 'parent' } })).status, 400);
  const p = await parent(f, a); assert.notEqual(a.cookie, p.cookie); assert.notEqual(a.csrf, p.csrf); assert.equal(p.info.role, 'parent');
  assert.equal(p.info.parent_expires_at, '2026-09-18T12:15:00.000Z');
  assert.equal((await call(f, 'me', { auth: a })).status, 401);
  assert.equal((await call(f, 'parent/create-child', { auth: { ...p, csrf: a.csrf }, data: { request_id: 'bad-csrf', display_name: 'No' } })).value.code, 'csrf_failed');
  const c = auth(await call(f, 'parent/exit', { auth: p, data: {} })); assert.equal(c.info.role, 'child'); assert.notEqual(c.cookie, p.cookie);
  assert.equal((await call(f, 'me', { auth: p })).status, 401);
  assert.equal((await call(f, 'parent/family', { auth: c })).status, 403);
  assert.match((await call(f, 'login', { data: { access_code: 'DEMO-FAMILY-A' } })).response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/api\/read2lead\/self-learn\/; Max-Age=3600/);
});
test('parent window expires without extending child session and delayed writes recheck it', async t => {
  const f = fixture(t, { parentTtlMs: 1000 }), a = await parent(f, await login(f));
  const d = delayed(f, 'parent/create-child', a, { request_id: 'expired-parent', display_name: 'No child' }); await d.begun;
  f.advance(1001); d.finish(); assert.equal((await d.pending).value.code, 'parent_required');
  const me = await call(f, 'me', { auth: a }); assert.equal(me.value.role, 'child'); assert.equal(me.value.parent_expires_at, null); assert.equal(me.value.expires_at, '2026-09-18T13:00:00.000Z');
  assert.equal((await call(f, 'lessons', { auth: a })).status, 200);
  assert.equal(f.familyStore.familyView(f.familyStore.elevateParent(f.familyStore.authenticateAccess('DEMO-FAMILY-A'), 'DEMO-PARENT-A-ONLY')).children.length, 2);
  const short = fixture(t, { ttlMs: 1000 }), p = await parent(short, await login(short)); assert.equal(p.info.parent_expires_at, p.info.expires_at);
  short.advance(1001); assert.equal((await call(short, 'parent/family', { auth: p })).status, 401);
  for (const parentTtlMs of [0, 999, 900001, NaN]) assert.throws(() => createLocalHandlers({ ...f.config, parentTtlMs }), /unsafe_local_api_config/);
});
test('parent-only profile create, enable, stale conflict and archive preserve family and wallet isolation', async t => {
  const f = fixture(t), p = await parent(f, await login(f)), b = await parent(f, await login(f, 'DEMO-FAMILY-B'), 'DEMO-PARENT-B-ONLY');
  const data = { request_id: 'create-child', display_name: 'Synthetic new' }, created = await call(f, 'parent/create-child', { auth: p, data }); assert.equal(created.status, 200);
  const child = created.value.profile; assert.equal(child.level, 'L0'); assert.equal(child.learning_enabled, false); assert.equal(child.recording_allowed, false);
  assert.equal((await call(f, 'parent/create-child', { auth: p, data })).value.replayed, true);
  assert.equal((await call(f, 'parent/create-child', { auth: p, data: { ...data, display_name: 'Changed' } })).status, 409);
  assert.equal((await call(f, 'child', { auth: p, data: { child_id: child.id } })).value.code, 'child_access_disabled');
  assert.equal((await call(f, 'parent/update-child', { auth: b, data: { child_id: child.id } })).value.code, 'wrong_child');
  const change = update({ child_id: child.id, request_id: 'enable-child', display_name: 'Enabled child', recording_allowed: true });
  assert.equal((await call(f, 'parent/update-child', { auth: p, data: change })).status, 200);
  assert.equal((await call(f, 'parent/update-child', { auth: p, data: change })).value.replayed, true);
  assert.equal((await call(f, 'parent/update-child', { auth: p, data: { ...change, request_id: 'stale' } })).value.code, 'stale_revision');
  for (const extra of [{ level: 'L5' }, { balance: 99 }, { role: 'parent' }, { credentialVersion: 1 }]) assert.equal((await call(f, 'parent/update-child', { auth: p, data: { ...change, ...extra } })).status, 400);
  const selected = await call(f, 'child', { auth: p, data: { child_id: child.id } }); assert.equal(selected.value.active_child_id, child.id);
  assert.equal(selected.value.children.find(c => c.id === child.id).recording_allowed, true);
  const view = (await call(f, 'parent/family', { auth: p })).value;
  assert.equal(view.children.length, 3); assert.deepEqual(view.children.find(c => c.id === child.id).wallet, { balance: 0, real_rewards: false });
  assert.equal((await call(f, 'parent/audit', { auth: b })).value.events.length, 1);
});
test('disabled active child is explicit and does not silently switch pending learning to a sibling', async t => {
  const f = fixture(t), a = await login(f), p = await parent(f, await login(f)), opened = await start(f, a);
  assert.equal((await call(f, 'parent/update-child', { auth: p, data: update({ learning_enabled: false }) })).status, 200);
  const me = (await call(f, 'me', { auth: a })).value; assert.equal(me.active_child_id, null); assert.deepEqual(me.children.map(c => c.id), ['synthetic-binh']);
  for (const route of ['lessons', 'session?session_id=' + opened.session.session_id, 'dialogue?session_id=' + opened.session.session_id]) assert.equal((await call(f, route, { auth: a })).value.code, 'child_access_disabled');
  assert.equal((await call(f, 'event', { auth: a, raw: '{' })).value.code, 'child_access_disabled');
  assert.equal((await call(f, 'start', { auth: a, raw: '{' })).value.code, 'child_access_disabled');
  assert.equal((await call(f, 'child', { auth: a, data: { child_id: 'synthetic-binh' } })).status, 200);
  assert.equal((await call(f, 'lessons', { auth: a })).status, 200);
  assert.equal(f.store.record(coreChild, 'synthetic-an', opened.session.session_id).session.revision, 0);
});
test('family can login and regain parent access when no child is enabled', async t => {
  const f = fixture(t), p = await parent(f, await login(f));
  for (const [i, id] of ['synthetic-an', 'synthetic-binh'].entries()) assert.equal((await call(f, 'parent/update-child', { auth: p, data: update({ child_id: id, request_id: 'disable-' + i, learning_enabled: false }) })).status, 200);
  const a = await login(f); assert.equal(a.info.active_child_id, null); assert.deepEqual(a.info.children, []);
  assert.equal((await call(f, 'lessons', { auth: a })).value.code, 'child_access_disabled');
  const next = await parent(f, a); assert.equal((await call(f, 'parent/family', { auth: next })).value.children.length, 2);
  assert.equal((await call(f, 'parent/update-child', { auth: next, data: update({ request_id: 'restore-enabled', expected_revision: 1 }) })).status, 200);
  assert.equal((await call(f, 'me', { auth: next })).value.active_child_id, null);
  assert.equal((await call(f, 'child', { auth: next, data: { child_id: 'synthetic-an' } })).value.active_child_id, 'synthetic-an');
});
test('delayed learning payload is refused after parent disables or archives that child', async t => {
  for (const change of [{ learning_enabled: false }, { archived: true }]) {
    const f = fixture(t), a = await login(f), p = await parent(f, await login(f)), opened = await start(f, a);
    const d = delayed(f, 'event', a, event(opened.session, 'prediction', { text: 'Do not save' })); await d.begun;
    assert.equal((await call(f, 'parent/update-child', { auth: p, data: update(change) })).status, 200); d.finish();
    assert.equal((await d.pending).value.code, 'child_access_disabled'); assert.equal(f.store.record(coreChild, 'synthetic-an', opened.session.session_id).session.revision, 0);
  }
});
test('recording preference is enforced after delayed body while typed and unavailable speech remain usable', async t => {
  const f = fixture(t), a = await login(f), p = await parent(f, await login(f)); let r = await through(f, a, 'begin_use');
  const speech = { text: 'Synthetic speech', capture_status: 'valid', support_used: [] }, data = event(r.session, 'shadow_complete', speech);
  assert.equal((await call(f, 'event', { auth: a, data })).value.code, 'recording_disabled');
  assert.equal((await call(f, 'parent/update-child', { auth: p, data: update({ recording_allowed: true }) })).status, 200);
  const d = delayed(f, 'event', a, data); await d.begun;
  await call(f, 'parent/update-child', { auth: p, data: update({ request_id: 'recording-off', expected_revision: 1 }) }); d.finish();
  assert.equal((await d.pending).value.code, 'recording_disabled');
  r = await send(f, a, r.session, 'shadow_complete', { ...speech, capture_status: 'not_attempted' }); assert.equal(r.session.stage, 'mini_story');
  assert.equal(f.store.wallet(coreChild, 'synthetic-an').balance, 5);
});
test('parent summaries contain actual support-aware evidence but no raw response or private fields', async t => {
  const f = fixture(t), a = await login(f), p = await parent(f, await login(f)), r = await through(f, a, 'shadow_complete');
  const db = new DatabaseSync(join(f.root, 'read2lead-synthetic.sqlite')), record = f.store.record(coreChild, 'synthetic-an', r.session.session_id);
  record.private_audio = 'PRIVATE_AUDIO'; record.session.private_token = 'PRIVATE_TOKEN'; record.lesson.private_key = 'PRIVATE_KEY';
  db.prepare('UPDATE sessions SET record_json=? WHERE id=?').run(JSON.stringify(record), r.session.session_id); db.close();
  const result = await call(f, 'parent/family', { auth: p }); assert.equal(result.status, 200);
  const c = result.value.children[0], h = c.history[0]; assert.equal(c.wallet.balance, 5); assert.equal(c.history_limit, 100);
  assert.equal(h.stage, 'mini_story'); assert.equal(h.practice_status_counts.assisted, 1); assert.equal(h.practice_status_counts.provisional, 2);
  assert.deepEqual(h.support_used, ['revealing_hint', 'reference_script']); assert.deepEqual(h.speech, { attempts: 1, pending: 0, unassessable: 1 });
  assert.equal(h.automatic_mastery, false); assert.equal(h.automatic_promotion, false);
  for (const route of ['parent/family', 'parent/audit', 'me']) assert.doesNotMatch(JSON.stringify((await call(f, route, { auth: p })).value), /PRIVATE_|correct_index|accepted_meanings|evidence_spans|parent_secret|recovery_code|access_hash|credential_version/);
  const b = await parent(f, await login(f, 'DEMO-FAMILY-B'), 'DEMO-PARENT-B-ONLY'); assert.equal((await call(f, 'parent/family', { auth: b })).value.children[0].history.length, 0);
  await call(f, 'parent/update-child', { auth: p, data: update({ archived: true }) });
  const archived = (await call(f, 'parent/family', { auth: p })).value.children[0]; assert.equal(archived.archived, true); assert.equal(archived.wallet.balance, 5); assert.equal(archived.history[0].session_id, r.session.session_id);
});
test('recovery revokes old cookies, rejects old access and replays without revoking newer sessions', async t => {
  const f = fixture(t), a = await login(f), p = await parent(f, await login(f)), b = await login(f, 'DEMO-FAMILY-B');
  const r = await call(f, 'recover', { data: recovery() }); assert.deepEqual(r.value, { ok: true, replayed: false }); assert.equal(r.response.headers.has('set-cookie'), false);
  for (const old of [a, p]) assert.equal((await call(f, 'me', { auth: old })).status, 401);
  assert.equal((await call(f, 'me', { auth: b })).status, 200);
  assert.equal((await call(f, 'login', { data: { access_code: 'DEMO-FAMILY-A' } })).value.code, 'invalid_access');
  const fresh = await login(f, 'RECOVERED-FAMILY-A'); assert.equal((await call(f, 'recover', { data: recovery() })).value.replayed, true);
  assert.equal((await call(f, 'me', { auth: fresh })).status, 200);
  assert.equal((await call(f, 'recover', { data: recovery({ request_id: 'old-token-new-request' }) })).value.code, 'invalid_access');
  assert.equal((await call(f, 'recover', { data: recovery({ new_access_code: 'CHANGED-FAMILY-A' }) })).value.code, 'request_conflict');
  assert.equal((await call(f, 'parent/enter', { auth: fresh, data: { parent_secret: 'DEMO-PARENT-A-ONLY' } })).value.code, 'invalid_access');
  const newParent = await parent(f, fresh, 'RECOVERED-PARENT-A'); assert.equal(newParent.info.role, 'parent');
});
test('old recovery replay cannot revoke sessions from a second completed recovery', async t => {
  const f = fixture(t); await call(f, 'recover', { data: recovery() });
  const data = recovery({ request_id: 'recovery-2', recovery_code: 'RECOVERED-FAMILY-A-TOKEN-2026', new_access_code: 'THIRD-FAMILY-A', new_parent_secret: 'THIRD-PARENT-A', new_recovery_code: 'THIRD-FAMILY-A-TOKEN-2026' });
  assert.equal((await call(f, 'recover', { data })).status, 200); const a = await login(f, 'THIRD-FAMILY-A');
  assert.equal((await call(f, 'recover', { data: recovery() })).value.replayed, true); assert.equal((await call(f, 'me', { auth: a })).status, 200);
});
test('recovery while event body is pending prevents the old authenticated write', async t => {
  const f = fixture(t), a = await login(f), opened = await start(f, a);
  const d = delayed(f, 'event', a, event(opened.session, 'prediction', { text: 'Never saved' })); await d.begun;
  assert.equal((await call(f, 'recover', { data: recovery() })).status, 200); d.finish();
  assert.equal((await d.pending).value.code, 'unauthorized'); assert.equal(f.store.record(coreChild, 'synthetic-an', opened.session.session_id).session.revision, 0);
});
test('external family credential rotation is checked even without in-memory session pruning', async t => {
  const f = fixture(t), a = await login(f);
  f.familyStore.recover(recovery(), now); assert.equal((await call(f, 'me', { auth: a })).value.code, 'unauthorized'); assert.equal(f.api.diagnostics().active_sessions, 0);
});
test('start authorization callback rechecks family permissions after asynchronous lesson preparation', async t => {
  const f = fixture(t), a = await login(f), p = await parent(f, await login(f));
  const original = f.store.start.bind(f.store); let release, entered;
  const seen = new Promise(r => { entered = r; });
  f.store.start = async (...args) => { await new Promise(r => { release = r; entered(); }); return original(...args); };
  const pending = call(f, 'start', { auth: a, data: { request_id: 'delayed-start', child_id: 'synthetic-an', lesson_id: lesson.id } }); await seen;
  await call(f, 'parent/update-child', { auth: p, data: update({ learning_enabled: false }) }); release();
  assert.equal((await pending).value.code, 'child_access_disabled'); assert.equal(f.store.history(coreChild, 'synthetic-an').length, 0);
});
test('delayed dialogue does not return private content after recovery or profile disable', async t => {
  for (const action of ['recover', 'disable']) {
    let release, begun; const entered = new Promise(r => { begun = r; });
    const f = fixture(t, { voice: { usage: () => ({ enabled: false }), async dialogue() { begun(); await new Promise(r => { release = r; }); return { text: 'PRIVATE_LATE_DIALOGUE' }; } } });
    const a = await login(f), p = await parent(f, await login(f)), r = await through(f, a, 'shadow_complete');
    const pending = call(f, 'dialogue?session_id=' + r.session.session_id, { auth: a }); await entered;
    if (action === 'recover') await call(f, 'recover', { data: recovery() }); else await call(f, 'parent/update-child', { auth: p, data: update({ learning_enabled: false }) });
    release(); const result = await pending; assert.equal(result.status, action === 'recover' ? 401 : 403); assert.doesNotMatch(JSON.stringify(result.value), /PRIVATE_LATE_DIALOGUE/);
  }
});
test('parent route methods, query strings, foreign origins and oversized bodies do not write', async t => {
  const f = fixture(t), p = await parent(f, await login(f));
  for (const route of ['parent/family?child_id=synthetic-chi', 'parent/create-child', 'parent/unknown']) assert.equal((await call(f, route, { auth: p })).status, 404);
  assert.equal((await call(f, 'parent/create-child', { auth: p, data: { request_id: 'evil', display_name: 'No' }, headers: { origin: 'https://evil.invalid' } })).value.code, 'origin_refused');
  assert.equal((await call(f, 'recover', { data: recovery(), headers: { origin: '' } })).value.code, 'origin_refused');
  assert.equal((await call(f, 'recover', { data: { ...recovery(), extra: 'x'.repeat(33000) } })).status, 413);
  assert.equal((await call(f, 'recover', { data: recovery(), headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(f, 'recover?extra=1', { data: recovery() })).status, 405);
  assert.equal((await call(f, 'parent/create-child', { auth: p, raw: '{' })).value.code, 'invalid_json');
  assert.equal((await call(f, 'parent/audit', { auth: p })).value.events.length, 1);
});
test('sensitive authentication attempts have bounded independent rate windows', async t => {
  const f = fixture(t), a = await login(f);
  for (let i = 0; i < 10; i++) assert.equal((await call(f, 'parent/enter', { auth: a, data: { parent_secret: 'bad' } })).status, 401);
  assert.equal((await call(f, 'parent/enter', { auth: a, data: { parent_secret: 'DEMO-PARENT-A-ONLY' } })).value.code, 'rate_limited');
  for (let i = 0; i < 10; i++) assert.equal((await call(f, 'recover', { data: { ...recovery(), recovery_code: 'INCORRECT-RECOVERY-TOKEN-2026' } })).status, 401);
  assert.equal((await call(f, 'recover', { data: recovery() })).value.code, 'rate_limited');
  assert.equal((await call(f, 'me', { auth: a })).status, 200);
  f.advance(60000); assert.equal((await call(f, 'parent/enter', { auth: a, data: { parent_secret: 'DEMO-PARENT-A-ONLY' } })).status, 200);
  assert.equal((await call(f, 'recover', { data: recovery() })).status, 200);
});
test('lost elevation reply can recover by fresh login without resurrecting old parent tokens', async t => {
  const f = fixture(t), a = await login(f); const lost = await parent(f, a);
  assert.equal((await call(f, 'parent/enter', { auth: a, data: { parent_secret: 'DEMO-PARENT-A-ONLY' } })).status, 401);
  const fresh = await login(f), p = await parent(f, fresh); assert.equal(p.info.role, 'parent');
  await call(f, 'parent/exit', { auth: lost, data: {} });
  assert.equal((await call(f, 'parent/family', { auth: lost })).status, 401); assert.equal((await call(f, 'parent/family', { auth: p })).status, 200);
});
test('recording allowed accepts synthetic valid-capture evidence without awarding a speech grade', async t => {
  const f = fixture(t), a = await login(f), p = await parent(f, await login(f)); const r = await through(f, a, 'begin_use');
  await call(f, 'parent/update-child', { auth: p, data: update({ recording_allowed: true }) });
  const saved = await send(f, a, r.session, 'shadow_complete', { text: 'Synthetic allowed capture', capture_status: 'valid', support_used: [] });
  assert.equal(saved.current_view.summary.speech[0].oral_language_state, 'pending'); assert.equal(saved.current_view.summary.speech[0].score, null);
  assert.equal(saved.wallet.balance, 5);
});
test('switching siblings during a delayed family learning event cannot save to either child', async t => {
  const f = fixture(t), a = await login(f), opened = await start(f, a);
  const d = delayed(f, 'event', a, event(opened.session, 'prediction', { text: 'Never sibling-swapped' })); await d.begun;
  assert.equal((await call(f, 'child', { auth: a, data: { child_id: 'synthetic-binh' } })).status, 200); d.finish();
  assert.equal((await d.pending).value.code, 'wrong_child'); assert.equal(f.store.record(coreChild, 'synthetic-an', opened.session.session_id).session.revision, 0);
  assert.equal(f.store.history({ active: true, childId: 'synthetic-binh' }, 'synthetic-binh').length, 0);
});
