import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { SyntheticFamilyStore } from '../scripts/lib/read2lead-self-learn-family.mjs';
import { SyntheticLibraryStore } from '../scripts/lib/read2lead-self-learn-library.mjs';
import { createLocalHandlers } from '../functions/lib/read2lead/self-learn/handlers.mjs';
import { publicReading, publicLibrary, freeReadingView } from '../functions/lib/read2lead/self-learn/library-views.mjs';
const json = name => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + name + '.json', import.meta.url)));
const access = json('access'), seed = json('family-access'), interests = json('library-interests');
const catalogue = { contract_version: '1.1.0', lessons: [...json('level-lessons').lessons, ...json('library-lessons').lessons] }, lesson = catalogue.lessons[2];
const origin = 'http://127.0.0.1:18773', prefix = '/api/read2lead/self-learn/';
const roots = resolve('.r2l-library-api-proofs'); mkdirSync(roots, { recursive: true });
const staff = { active: true, role: 'staff', id: 'synthetic-library-api' }, now = '2026-09-18T12:00:00.000Z';
async function fixture(t, options = {}) {
  const root = mkdtempSync(join(roots, 'case-')); writeFileSync(join(root, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' }));
  const store = new SyntheticStore({ root }), familyStore = new SyntheticFamilyStore({ mode: 'synthetic-local', root });
  for (const a of seed.accounts) familyStore.seed(staff, a, now);
  const libraryStore = await SyntheticLibraryStore.open({ mode: 'synthetic-local', root, catalogue, interests }); let time = Date.parse(now);
  const config = { mode: 'synthetic-local', origin, access, lessons: catalogue.lessons, store, familyStore, libraryStore, libraryInterests: interests, now: () => time, ...options };
  t.after(() => { libraryStore.close(); familyStore.close(); store.close(); });
  return { root, store, familyStore, libraryStore, config, api: createLocalHandlers(config), advance(ms) { time += ms; } };
}
function req(path, { auth, data, raw, headers = {}, method = 'GET' } = {}) {
  if (data !== undefined || raw !== undefined) method = 'POST';
  return new Request(origin + prefix + path, { method, headers: { origin, ...(auth ? { cookie: auth.cookie, 'x-r2l-csrf': auth.csrf } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(method === 'POST' ? { body: raw ?? JSON.stringify(data), ...(raw instanceof ReadableStream ? { duplex: 'half' } : {}) } : {}) });
}
async function call(f, path, options) { const response = await f.api.handle(req(path, options)); return { response, status: response.status, value: await response.json() }; }
function auth(r) { assert.equal(r.status, 200, JSON.stringify(r.value)); return { cookie: r.response.headers.get('set-cookie').split(';')[0], csrf: r.value.csrf }; }
async function login(f, code = 'DEMO-FAMILY-A') { return auth(await call(f, 'login', { data: { access_code: code } })); }
async function parent(f) { return auth(await call(f, 'parent/enter', { auth: await login(f), data: { parent_secret: 'DEMO-PARENT-A-ONLY' } })); }
const selected = 'synthetic-an';
const open = (more = {}) => ({ request_id: 'open-library', child_id: selected, lesson_id: lesson.id, ...more });
const preference = (more = {}) => ({ request_id: 'library-interest', child_id: selected, expected_revision: 0, interest_ids: ['together'], ...more });
const favorite = (more = {}) => ({ request_id: 'library-favorite', child_id: selected, expected_revision: 0, lesson_id: lesson.id, favorite: true, ...more });
const position = (id, more = {}) => ({ request_id: 'library-position', child_id: selected, reading_id: id, expected_revision: 0, sentence_id: lesson.story.sentences[1].id, marked_finished: false, ...more });
const profile = (more = {}) => ({ request_id: 'library-profile', child_id: selected, expected_revision: 0, display_name: 'An mẫu', archived: false, learning_enabled: true, recording_allowed: false, ...more });
const recovery = () => ({ family_id: 'synthetic-family-a', request_id: 'library-recovery', recovery_code: 'DEMO-RECOVERY-FAMILY-A-2026', new_access_code: 'LIBRARY-RECOVERED-ACCESS', new_parent_secret: 'LIBRARY-RECOVERED-PARENT', new_recovery_code: 'LIBRARY-RECOVERED-TOKEN-2026' });
function delayed(f, path, a, data) {
  let finish, ready; const begun = new Promise(r => { ready = r; });
  const raw = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); finish = () => { c.enqueue(new TextEncoder().encode(JSON.stringify(data).slice(1))); c.close(); }; }, pull() { ready(); } });
  return { pending: call(f, path, { auth: a, raw }), begun, finish: () => finish() };
}
function rows(f, table) { const db = new DatabaseSync(join(f.root, 'read2lead-synthetic.sqlite')); try { return db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(); } finally { db.close(); } }
test('library injection requires family authority; prior static handlers remain compatible', async t => {
  const f = await fixture(t);
  assert.throws(() => createLocalHandlers({ ...f.config, familyStore: undefined }), /unsafe_local_api_config/);
  assert.throws(() => createLocalHandlers({ ...f.config, libraryInterests: {} }), /invalid_library_interests/);
  f.api = createLocalHandlers({ ...f.config, libraryStore: undefined });
  const a = await login(f); assert.equal((await call(f, 'library', { auth: a })).status, 404); assert.equal((await call(f, 'lessons', { auth: a })).status, 200);
});
test('library filters all thirty lessons by explicit level, editorial interest and favorites', async t => {
  const f = await fixture(t), a = await login(f), all = await call(f, 'library', { auth: a });
  assert.equal(all.status, 200); assert.equal(all.value.lessons.length, 30); assert.equal(all.value.library.level, 'L2'); assert.equal(all.value.library.history_limit, 100);
  assert.equal(all.response.headers.get('cache-control'), 'no-store'); assert.equal(all.value.library.groups.length, 6);
  assert.ok(all.value.library.suggestions.every(s => catalogue.lessons.find(l => l.id === s.lesson_id).level === 'L2'));
  for (let i = 0; i <= 5; i++) {
    const r = (await call(f, 'library?level=L' + i, { auth: a })).value;
    assert.equal(r.lessons.length, 5); assert.ok(r.lessons.every(l => l.level === 'L' + i)); assert.equal(r.library.level, 'L2');
  }
  const matching = (await call(f, 'library?level=L2&interest=together', { auth: a })).value;
  assert.equal(matching.lessons.length, 2); assert.ok(matching.lessons.every(l => l.interest_id === 'together'));
  assert.deepEqual((await call(f, 'library?level=L2&interest=nature', { auth: a })).value.lessons, []);
  assert.deepEqual((await call(f, 'library?favorites=1', { auth: a })).value.lessons, []);
  await call(f, 'library/favorite', { auth: a, data: favorite() });
  assert.deepEqual((await call(f, 'library?level=L2&favorites=1', { auth: a })).value.lessons.map(l => l.id), [lesson.id]);
});
test('strict library queries and route methods reject ambiguity and forged child selection', async t => {
  const f = await fixture(t), a = await login(f);
  for (const query of ['level=L6', 'level=', 'interest=unknown', 'favorites=0', 'favorites=true', 'level=L2&level=L0', 'child_id=synthetic-binh', 'role=parent']) assert.equal((await call(f, 'library?' + query, { auth: a })).status, 400, query);
  for (const route of ['library', 'library/reading', 'library/open?force=true', 'library/unknown']) assert.equal((await call(f, route, { auth: a, data: {} })).status, 404, route);
  for (const query of ['', '?reading_id=x&reading_id=y', '?other=x']) assert.equal((await call(f, 'library/reading' + query, { auth: a })).status, 400);
});
test('library writes require current selected child, CSRF, bounded JSON and omit caller authority', async t => {
  const f = await fixture(t), a = await login(f);
  assert.equal((await call(f, 'library/open', { raw: '{' })).value.code, 'unauthorized');
  assert.equal((await call(f, 'library/open', { auth: a, data: open(), headers: { 'x-r2l-csrf': 'forged' } })).value.code, 'csrf_failed');
  assert.equal((await call(f, 'library/open', { auth: a, data: open(), headers: { origin: 'https://elsewhere.example' } })).value.code, 'origin_refused');
  assert.equal((await call(f, 'library/open', { auth: a, raw: '{' })).value.code, 'invalid_json');
  assert.equal((await call(f, 'library/open', { auth: a, data: open({ text: 'x'.repeat(33000) }) })).status, 413);
  for (const data of [open({ child_id: 'synthetic-binh' }), open({ child_id: 'synthetic-chi' }), { request_id: 'no-child', lesson_id: lesson.id }]) assert.equal((await call(f, 'library/open', { auth: a, data })).value.code, 'wrong_child');
  for (const extra of [{ role: 'parent' }, { balance: 100 }, { credentialVersion: 99 }]) assert.equal((await call(f, 'library/open', { auth: a, data: open(extra) })).status, 400);
  assert.equal(rows(f, 'library_readings').length, 0);
});
test('interest and favorite replies keep original receipt separate from current preferences', async t => {
  const f = await fixture(t), a = await login(f), first = await call(f, 'library/interests', { auth: a, data: preference() });
  assert.equal(first.status, 200); assert.equal(first.value.preferences.revision, 1);
  const fav = favorite({ expected_revision: 1 }); assert.equal((await call(f, 'library/favorite', { auth: a, data: fav })).value.preferences.revision, 2);
  const old = (await call(f, 'library/interests', { auth: a, data: preference() })).value;
  assert.equal(old.replayed, true); assert.equal(old.preferences.revision, 1); assert.equal(old.library.preferences.revision, 2); assert.equal(old.library.favorites.length, 1);
  assert.equal((await call(f, 'library/interests', { auth: a, data: preference({ interest_ids: [] }) })).value.code, 'request_conflict');
  assert.equal((await call(f, 'library/interests', { auth: a, data: preference({ request_id: 'stale-new' }) })).value.code, 'stale_revision');
  assert.equal(rows(f, 'library_receipts').length, 2);
});
test('free-reader HTTP view is story-only and preserves original receipt versus latest saved position', async t => {
  const f = await fixture(t), a = await login(f), first = await call(f, 'library/open', { auth: a, data: open() }), id = first.value.reading.reading_id;
  assert.equal(first.status, 200); assert.equal(first.value.current_view.lesson.policy.compulsory_tasks, false);
  assert.equal(first.value.reading.rewards_awarded, false); assert.deepEqual(first.value.current_view.lesson.story.sentences, lesson.story.sentences);
  const pos = position(id); assert.equal((await call(f, 'library/position', { auth: a, data: pos })).value.current_view.reading.revision, 1);
  const finish = position(id, { request_id: 'finish', expected_revision: 1, marked_finished: true });
  assert.equal((await call(f, 'library/position', { auth: a, data: finish })).value.current_view.reading.marked_finished, true);
  const old = (await call(f, 'library/position', { auth: a, data: pos })).value;
  assert.equal(old.replayed, true); assert.equal(old.reading.revision, 1); assert.equal(old.current_view.reading.revision, 2); assert.equal(old.current_view.reading.marked_finished, true);
  assert.equal((await call(f, 'library/open', { auth: a, data: open() })).value.current_view.reading.revision, 2);
  assert.equal((await call(f, 'library/position', { auth: a, data: position(id, { request_id: 'finished-update', expected_revision: 2 }) })).value.code, 'reading_finished');
  const saved = (await call(f, 'library/reading?reading_id=' + id, { auth: a })).value;
  assert.equal(saved.view.reading.revision, 2);
  for (const value of [first.value, old, saved]) assert.doesNotMatch(JSON.stringify(value), /questions|correct_index|accepted_meanings|evidence_spans|expected_meaning|minny|retell|misconception_repair/);
  assert.equal(rows(f, 'sessions').length, 0); assert.equal(rows(f, 'ledger').length, 0); assert.equal(f.store.wallet({ active: true, childId: selected }, selected).balance, 0);
});
test('private field injection is excluded at every library projection depth', async t => {
  const f = await fixture(t), p = { ...f.familyStore.authenticateAccess('DEMO-FAMILY-A'), childId: selected };
  const reading = f.libraryStore.openReading(p, { request_id: 'poison', lesson_id: lesson.id }, now).reading;
  const record = f.libraryStore.reading(p, reading.reading_id), view = f.libraryStore.view(p);
  function poison(value) { if (!value || typeof value !== 'object') return; for (const item of Object.values(value)) poison(item); if (!Array.isArray(value)) value.private_secret = 'PRIVATE_INJECTED'; }
  poison(record); poison(view); poison(reading);
  const a = await login(f), real = f.config.libraryStore;
  f.api = createLocalHandlers({ ...f.config, libraryStore: { view: () => view, reading: () => record, openReading: () => ({ ok: true, replayed: true, reading, private_secret: 'PRIVATE_INJECTED' }) } });
  const b = await login(f);
  for (const r of [await call(f, 'library', { auth: b }), await call(f, 'library/reading?reading_id=' + reading.reading_id, { auth: b }), await call(f, 'library/open', { auth: b, data: open() })]) { assert.equal(r.status, 200); assert.doesNotMatch(JSON.stringify(r.value), /PRIVATE_INJECTED|private_secret|correct_index|accepted_meanings/); }
  assert.doesNotMatch(JSON.stringify([publicReading(reading), publicLibrary(view), freeReadingView(record)]), /PRIVATE_INJECTED|private_secret/);
  assert.equal(real.view(p).reading_history.length, 1); assert.equal((await call(f, 'library', { auth: a })).status, 401);
});
test('another family and a sibling cannot read or change a saved free-reading record', async t => {
  const f = await fixture(t), a = await login(f), b = await login(f, 'DEMO-FAMILY-B'), opened = (await call(f, 'library/open', { auth: a, data: open() })).value;
  assert.equal((await call(f, 'library/reading?reading_id=' + opened.reading.reading_id, { auth: b })).value.code, 'reading_not_found');
  await call(f, 'child', { auth: a, data: { child_id: 'synthetic-binh' } });
  assert.equal((await call(f, 'library/reading?reading_id=' + opened.reading.reading_id, { auth: a })).value.code, 'reading_not_found');
  assert.equal((await call(f, 'library/position', { auth: a, data: position(opened.reading.reading_id, { child_id: 'synthetic-binh' }) })).value.code, 'reading_not_found');
  assert.equal((await call(f, 'library', { auth: a })).value.library.reading_history.length, 0);
});
for (const route of ['library/interests', 'library/favorite', 'library/open', 'library/position']) test('delayed ' + route + ' refuses a sibling switch before storing a write', async t => {
  const f = await fixture(t), a = await login(f), r = (await call(f, 'library/open', { auth: a, data: open() })).value;
  const data = route.endsWith('interests') ? preference() : route.endsWith('favorite') ? favorite() : route.endsWith('open') ? open({ request_id: 'delayed-open' }) : position(r.reading.reading_id);
  const d = delayed(f, route, a, data); await d.begun;
  await call(f, 'child', { auth: a, data: { child_id: 'synthetic-binh' } }); d.finish();
  assert.equal((await d.pending).value.code, 'wrong_child'); assert.equal(rows(f, 'library_receipts').length, 1);
});
for (const change of ['disable', 'archive', 'recover', 'logout', 'expire']) test('delayed library write rechecks ' + change + ' after parsing the body', async t => {
  const f = await fixture(t, change === 'expire' ? { ttlMs: 1000 } : {}), a = await login(f), p = await parent(f);
  const d = delayed(f, 'library/open', a, open()); await d.begun;
  if (change === 'disable' || change === 'archive') await call(f, 'parent/update-child', { auth: p, data: profile(change === 'disable' ? { learning_enabled: false } : { archived: true }) });
  else if (change === 'recover') await call(f, 'recover', { data: recovery() });
  else if (change === 'logout') await call(f, 'logout', { auth: a, data: {} });
  else f.advance(1001);
  d.finish(); const code = (await d.pending).value.code;
  assert.equal(code, ['disable', 'archive'].includes(change) ? 'child_access_disabled' : change === 'expire' ? 'access_expired' : 'unauthorized');
  assert.equal(rows(f, 'library_readings').length, 0); assert.equal(rows(f, 'library_receipts').length, 0);
});
test('disabled and recovered access cannot replay a previously successful library receipt', async t => {
  const f = await fixture(t), a = await login(f), p = await parent(f);
  await call(f, 'library/open', { auth: a, data: open() });
  await call(f, 'parent/update-child', { auth: p, data: profile({ learning_enabled: false }) });
  assert.equal((await call(f, 'library/open', { auth: a, data: open() })).value.code, 'child_access_disabled');
  assert.equal((await call(f, 'library/open', { auth: a, raw: '{' })).value.code, 'child_access_disabled');
  await call(f, 'parent/update-child', { auth: p, data: profile({ request_id: 'enable-again', expected_revision: 1 }) });
  await call(f, 'recover', { data: recovery() });
  assert.equal((await call(f, 'library/open', { auth: a, data: open() })).status, 401);
  const fresh = await login(f, recovery().new_access_code); assert.equal((await call(f, 'library/open', { auth: fresh, data: open() })).value.replayed, true);
});
test('library write limit is bounded per child, preserves reads and resets after one minute', async t => {
  const f = await fixture(t), a = await login(f);
  for (let i = 0; i < 60; i++) assert.equal((await call(f, 'library/open', { auth: a, data: open() })).status, 200);
  assert.equal((await call(f, 'library/open', { auth: a, data: open() })).value.code, 'rate_limited');
  assert.equal((await call(f, 'library', { auth: a })).status, 200); assert.equal(rows(f, 'library_readings').length, 1);
  await call(f, 'child', { auth: a, data: { child_id: 'synthetic-binh' } });
  assert.equal((await call(f, 'library/open', { auth: a, data: open({ child_id: 'synthetic-binh' }) })).status, 200);
  await call(f, 'child', { auth: a, data: { child_id: selected } }); f.advance(60001);
  assert.equal((await call(f, 'library/open', { auth: a, data: open() })).status, 200);
});
