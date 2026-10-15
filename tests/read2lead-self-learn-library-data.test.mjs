import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { SyntheticFamilyStore } from '../scripts/lib/read2lead-self-learn-family.mjs';
import { SyntheticLibraryStore } from '../scripts/lib/read2lead-self-learn-library.mjs';
import { validateLibraryInterests, librarySuggestions } from '../functions/lib/read2lead/self-learn/library-policy.mjs';
import { canonical } from '../src/lib/read2lead/self-learn/session-contract.mjs';
const read = name => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + name + '.json', import.meta.url)));
const access = read('family-access').accounts, catalogue = read('level-lessons'), interests = read('library-interests');
const allLessons = [...catalogue.lessons, ...read('library-lessons').lessons], lesson = catalogue.lessons[2];
const roots = resolve('.r2l-library-data-proofs'); mkdirSync(roots, { recursive: true });
const staff = { active: true, role: 'staff', id: 'synthetic-qa' }, time = '2026-09-18T15:00:00Z';
function root() { const r = mkdtempSync(join(roots, 'case-')); writeFileSync(join(r, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' })); return r; }
async function fixture(t, fault = () => {}) {
  const path = root(), core = new SyntheticStore({ root: path }), family = new SyntheticFamilyStore({ mode: 'synthetic-local', root: path });
  for (const account of access) family.seed(staff, account, time);
  let library = await SyntheticLibraryStore.open({ mode: 'synthetic-local', root: path, catalogue, interests, fault });
  t.after(() => { library.close(); family.close(); core.close(); });
  return { root: path, core, family, get library() { return library; },
    async reopen(next = catalogue) { library.close(); library = await SyntheticLibraryStore.open({ mode: 'synthetic-local', root: path, catalogue: next, interests, fault }); },
    db() { return new DatabaseSync(join(path, 'read2lead-synthetic.sqlite')); },
    principal(childId = 'synthetic-an', i = 0) { return { ...family.authenticateAccess(access[i].access_code), childId }; },
    parent() { return family.elevateParent(family.authenticateAccess(access[0].access_code), access[0].parent_secret); } };
}
const preference = (more = {}) => ({ request_id: 'set-interests', expected_revision: 0, interest_ids: ['nature'], ...more });
const favorite = (more = {}) => ({ request_id: 'set-favorite', expected_revision: 0, lesson_id: lesson.id, favorite: true, ...more });
const open = (more = {}) => ({ request_id: 'open-reading', lesson_id: lesson.id, ...more });
const update = (readingId, more = {}) => ({ request_id: 'update-reading', reading_id: readingId, expected_revision: 0, sentence_id: lesson.story.sentences[1].id, marked_finished: false, ...more });
const profile = (more = {}) => ({ request_id: 'change-profile', child_id: 'synthetic-an', expected_revision: 0, display_name: 'An mẫu', archived: false, learning_enabled: true, recording_allowed: false, ...more });
const recovery = () => ({ family_id: access[0].family_id, request_id: 'recover-library-family', recovery_code: access[0].recovery_code,
  new_access_code: 'LIBRARY-FAMILY-NEXT', new_parent_secret: 'LIBRARY-PARENT-NEXT', new_recovery_code: 'LIBRARY-RECOVERY-NEXT-2026' });
function worker(f, operation, boundary = '', requestId = 'worker-request') {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['tests/fixtures/read2lead-self-learn/library-worker.mjs', f.root, operation, boundary, requestId], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', error = ''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => error += x); child.on('error', fail);
    child.on('exit', (code, signal) => done({ code, signal, out, error }));
  });
}
function coreSnapshot(f) {
  const db = f.db(), result = {};
  try { for (const table of ['children', 'child_profiles', 'family_accounts', 'sessions', 'wallets', 'ledger', 'receipts', 'redemptions']) result[table] = db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(); return result; }
  finally { db.close(); }
}
test('library requires explicit synthetic mode, factory and existing family schema before writing', async t => {
  const path = root(), args = { root: path, catalogue, interests };
  assert.throws(() => new SyntheticLibraryStore(), /use_library_factory/);
  await assert.rejects(SyntheticLibraryStore.open({ ...args, mode: 'production' }), /unsafe_library_mode/);
  await assert.rejects(SyntheticLibraryStore.open({ ...args, mode: 'synthetic-local' }), /core_store_required/);
  assert.equal(existsSync(join(path, 'read2lead-synthetic.sqlite')), false);
  const core = new SyntheticStore({ root: path }); t.after(() => core.close());
  await assert.rejects(SyntheticLibraryStore.open({ ...args, mode: 'synthetic-local' }), /family_store_required/);
  const db = new DatabaseSync(join(path, 'read2lead-synthetic.sqlite')); assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'library_%'").get().n, 0); db.close();
});
test('invalid catalogue and taxonomy are refused before any library schema change', async t => {
  const path = root(), core = new SyntheticStore({ root: path }), family = new SyntheticFamilyStore({ mode: 'synthetic-local', root: path });
  t.after(() => { family.close(); core.close(); });
  const broken = structuredClone(catalogue); broken.lessons[0].story.text_sha256 = 'bad';
  await assert.rejects(SyntheticLibraryStore.open({ mode: 'synthetic-local', root: path, catalogue: broken, interests }), /unsuitable_content/);
  await assert.rejects(SyntheticLibraryStore.open({ mode: 'synthetic-local', root: path, catalogue, interests: {} }), /invalid_library_interests/);
  const db = new DatabaseSync(join(path, 'read2lead-synthetic.sqlite')); assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'library_%'").get().n, 0); db.close();
});
test('unknown and unmarked partial library schemas are refused without adoption', async t => {
  const f = await fixture(t), db = f.db();
  db.exec("UPDATE r2l_meta SET value='99' WHERE key='library_schema_version'");
  await assert.rejects(SyntheticLibraryStore.open({ mode: 'synthetic-local', root: f.root, catalogue, interests }), /unsupported_library_schema/);
  db.exec("DELETE FROM r2l_meta WHERE key='library_schema_version'");
  await assert.rejects(SyntheticLibraryStore.open({ mode: 'synthetic-local', root: f.root, catalogue, interests }), /unrecognized_library_schema/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM library_readings').get().n, 0); db.close();
});
test('six editorial interests cover all thirty themes and reject duplicate, unknown or oversized groups', () => {
  assert.equal(validateLibraryInterests(interests, allLessons).length, 6);
  for (const mutate of [s => s.groups.pop(), s => s.groups[1].id = s.groups[0].id, s => s.groups[1].themes.push(s.groups[0].themes[0]), s => s.groups[0].label_vi = 'x'.repeat(101), s => s.extra = true]) {
    const bad = structuredClone(interests); mutate(bad); assert.throws(() => validateLibraryInterests(bad, allLessons), /invalid_library_interests/);
  }
  assert.throws(() => validateLibraryInterests(interests, [{ theme: 'unmapped' }]), /unmapped_library_theme/);
});
test('suggestions are stable, declared-level-only and explain interests, favorites and rereads', () => {
  const groups = validateLibraryInterests(interests, allLessons), lessons = allLessons.filter(l => l.level === 'L2');
  const selected = lessons.find(l => l.theme === 'testing a change'), favoriteLesson = lessons.find(l => l.id !== selected.id);
  const args = { lessons: allLessons, groups, level: 'L2', interestIds: ['investigate'], favoriteIds: [favoriteLesson.id], seenIds: [selected.id], limit: 5 };
  const result = librarySuggestions(args); assert.deepEqual(librarySuggestions({ ...args, lessons: [...allLessons].reverse() }), result);
  assert.equal(result[0].lesson_id, selected.id); assert.equal(result[0].reason, 'same_level_interest');
  assert.equal(result[1].lesson_id, favoriteLesson.id); assert.equal(result[1].reason, 'same_level_favorite');
  assert.ok(result.every(r => lessons.some(l => l.id === r.lesson_id)));
  const plain = librarySuggestions({ ...args, interestIds: [], favoriteIds: [], seenIds: lessons.map(l => l.id) });
  assert.ok(plain.every(r => r.reason === 'same_level_reread'));
  assert.throws(() => librarySuggestions({ ...args, level: 'L6' }), /invalid_suggestion_request/);
  assert.throws(() => librarySuggestions({ ...args, limit: 11 }), /invalid_suggestion_request/);
});
test('empty preferences are read-only and snapshots cannot mutate stored or configured values', async t => {
  const f = await fixture(t), p = f.principal(), view = f.library.view(p);
  assert.deepEqual(view.preferences, { revision: 0, interest_ids: [] }); assert.deepEqual(view.favorites, []); assert.deepEqual(view.reading_history, []);
  view.groups[0].label_vi = 'Changed'; view.preferences.interest_ids.push('bad');
  assert.equal(f.library.view(p).groups[0].label_vi, interests.groups[0].label_vi);
  const db = f.db(); assert.equal(db.prepare('SELECT count(*) AS n FROM library_preferences').get().n, 0); db.close();
  const copy = structuredClone(catalogue), taxonomy = structuredClone(interests);
  const promise = SyntheticLibraryStore.open({ mode: 'synthetic-local', root: f.root, catalogue: copy, interests: taxonomy });
  copy.lessons[2].title_en = 'Changed outside after await'; taxonomy.groups[0].id = 'changed';
  const isolated = await promise; t.after(() => isolated.close());
  const reading = isolated.openReading(p, open(), time); assert.equal(reading.reading.title_en, lesson.title_en);
});
test('interests enforce up to three choices, exact shapes, stale revision and immutable replay', async t => {
  const f = await fixture(t), p = f.principal();
  for (const bad of [null, preference({ interest_ids: ['nature', 'nature'] }), preference({ interest_ids: ['missing'] }), preference({ interest_ids: interests.groups.slice(0, 4).map(g => g.id) }), preference({ expected_revision: -1 }), preference({ balance: 200 })]) assert.throws(() => f.library.setInterests(p, bad, time), /invalid_request/);
  const first = f.library.setInterests(p, preference(), time); assert.equal(first.preferences.revision, 1);
  assert.equal(f.library.setInterests(p, preference(), time).replayed, true);
  assert.throws(() => f.library.setInterests(p, preference({ request_id: 'stale-interest' }), time), /stale_revision/);
  assert.throws(() => f.library.setInterests(p, preference({ interest_ids: [] }), time), /request_conflict/);
  f.library.setInterests(p, preference({ request_id: 'clear-interest', expected_revision: 1, interest_ids: [] }), time);
  const old = f.library.setInterests(p, preference(), time); assert.deepEqual(old.preferences, first.preferences); assert.equal(f.library.view(p).preferences.revision, 2);
});
test('favorites set desired state, share preference revision and preserve interests without blind toggles', async t => {
  const f = await fixture(t), p = f.principal();
  f.library.setInterests(p, preference(), time);
  assert.throws(() => f.library.setFavorite(p, favorite(), time), /stale_revision/);
  const data = favorite({ expected_revision: 1 }), first = f.library.setFavorite(p, data, time);
  assert.equal(first.preferences.revision, 2); assert.deepEqual(first.preferences.interest_ids, ['nature']);
  assert.equal(f.library.setFavorite(p, data, time).replayed, true); assert.equal(f.library.view(p).favorites.length, 1);
  f.library.setFavorite(p, favorite({ request_id: 'already-favorite', expected_revision: 2 }), time);
  assert.equal(f.library.view(p).favorites.length, 1);
  f.library.setFavorite(p, favorite({ request_id: 'remove-favorite', expected_revision: 3, favorite: false }), time);
  assert.equal(f.library.view(p).favorites.length, 0); assert.equal(f.library.view(p).preferences.revision, 4);
  assert.throws(() => f.library.setFavorite(p, favorite({ request_id: 'unknown', expected_revision: 4, lesson_id: 'unknown' }), time), /content_unavailable/);
  assert.equal(f.library.view(p).preferences.revision, 4);
});
test('family, child, inactive, revoked and disabled access is checked before private reads and writes', async t => {
  const f = await fixture(t), p = f.principal(), created = f.library.openReading(p, open(), time);
  for (const bad of [{ ...p, active: false }, { ...p, role: 'staff' }, { ...p, credentialVersion: 99 }, { ...p, childId: 'real-child' }]) {
    assert.throws(() => f.library.view(bad), /unauthorized/); assert.throws(() => f.library.setInterests(bad, null, time), /unauthorized/);
  }
  assert.throws(() => f.library.view({ ...p, childId: 'synthetic-chi' }), /wrong_child/);
  assert.throws(() => f.library.reading(f.principal('synthetic-binh'), created.reading.reading_id), /reading_not_found/);
  assert.deepEqual(f.library.audit(f.principal('synthetic-binh')), []);
  f.family.updateChild(f.parent(), profile({ learning_enabled: false }), time);
  assert.throws(() => f.library.openReading(p, open(), time), /child_access_disabled/); assert.throws(() => f.library.reading(p, created.reading.reading_id), /child_access_disabled/);
  f.family.updateChild(f.parent(), profile({ request_id: 'restore', expected_revision: 1 }), time);
  assert.equal(f.library.openReading(p, open(), time).replayed, true);
  f.family.recover(recovery(), time);
  assert.throws(() => f.library.openReading(p, open(), time), /unauthorized/);
  const current = { ...f.family.authenticateAccess('LIBRARY-FAMILY-NEXT'), childId: p.childId };
  assert.equal(f.library.reading(current, created.reading.reading_id).reading.lesson_id, lesson.id);
});
test('authority is rechecked under the write lock after a family change between validation and commit', async t => {
  let action = () => {}; const f = await fixture(t, name => { if (name === 'library_before_write_lock') action(); }), p = f.principal();
  action = () => { action = () => {}; f.family.updateChild(f.parent(), profile({ archived: true }), time); };
  assert.throws(() => f.library.setInterests(p, preference(), time), /child_access_disabled/);
  const db = f.db(); assert.equal(db.prepare('SELECT count(*) AS n FROM library_preferences').get().n, 0); assert.equal(db.prepare('SELECT count(*) AS n FROM library_receipts').get().n, 0); db.close();
});
test('free reading pins content, resumes by revision and can self-finish without compulsory tasks or rewards', async t => {
  const f = await fixture(t), p = f.principal(), before = coreSnapshot(f);
  const opened = f.library.openReading(p, open(), time), id = opened.reading.reading_id;
  assert.equal(opened.reading.revision, 0); assert.equal(opened.reading.rewards_awarded, false);
  assert.equal(opened.reading.content_sha256, createHash('sha256').update(canonical(lesson)).digest('hex'));
  assert.equal(f.library.openReading(p, open(), time).replayed, true);
  assert.throws(() => f.library.openReading(p, open({ lesson_id: catalogue.lessons[0].id }), time), /request_conflict/);
  const first = f.library.updateReading(p, update(id), time); assert.equal(first.reading.sentence_id, lesson.story.sentences[1].id);
  assert.equal(f.library.updateReading(p, update(id), time).replayed, true);
  assert.throws(() => f.library.updateReading(p, update(id, { request_id: 'stale-cursor' }), time), /stale_revision/);
  assert.throws(() => f.library.updateReading(p, update(id, { sentence_id: 'unknown', request_id: 'unknown-sentence', expected_revision: 1 }), time), /invalid_request/);
  const finished = update(id, { request_id: 'self-finish', expected_revision: 1, marked_finished: true });
  f.library.updateReading(p, finished, time); assert.equal(f.library.updateReading(p, finished, time).replayed, true);
  assert.throws(() => f.library.updateReading(p, update(id, { request_id: 'unfinish', expected_revision: 2 }), time), /reading_finished/);
  await f.reopen(); assert.equal(f.library.reading(p, id).reading.marked_finished, true);
  const reread = f.library.openReading(p, open({ request_id: 'new-reread' }), time);
  assert.notEqual(reread.reading.reading_id, id); assert.equal(f.library.view(p).reading_history.length, 2);
  assert.deepEqual(coreSnapshot(f), before); assert.equal(f.core.wallet(p, p.childId).balance, 0);
});
test('old reading pins and exact receipts survive changed or removed catalogue content', async t => {
  const f = await fixture(t), p = f.principal(), initial = f.library.openReading(p, open(), time), oldId = initial.reading.reading_id;
  f.library.setFavorite(p, favorite(), time);
  const changed = structuredClone(catalogue); changed.contract_version = '1.0.0';
  for (const l of changed.lessons) { l.version = '1.0.0'; l.audio.content_version = '1.0.0'; for (const q of l.questions) q.version = '1.0.0'; }
  changed.lessons[2].title_en = 'Changed later version'; await f.reopen(changed);
  assert.equal(f.library.openReading(p, open(), time).replayed, true);
  assert.deepEqual(f.library.reading(p, oldId).lesson, lesson);
  const newer = f.library.openReading(p, open({ request_id: 'newer-version' }), time);
  assert.equal(newer.reading.content_version, '1.0.0'); assert.notEqual(newer.reading.content_sha256, initial.reading.content_sha256);
  await f.reopen({ ...catalogue, lessons: catalogue.lessons.filter(l => l.id !== lesson.id) });
  assert.equal(f.library.openReading(p, open(), time).replayed, true);
  assert.equal(f.library.setFavorite(p, favorite(), time).replayed, true);
  assert.throws(() => f.library.openReading(p, open({ request_id: 'missing-new' }), time), /content_unavailable/);
  f.library.updateReading(p, update(oldId), time);
  f.library.setFavorite(p, favorite({ request_id: 'remove-missing', expected_revision: 1, favorite: false }), time);
  assert.equal(f.library.view(p).favorites.length, 0);
});
test('library operations preserve an awarded learning session and all existing family and ledger records', async t => {
  const f = await fixture(t), p = f.principal();
  let result = await f.core.start(p, { sessionId: 'synthetic-learning-before-library', childId: p.childId, lesson, now: time, apiVersion: '1.2' });
  const send = (event, payload = {}) => { const s = result.session; result = f.core.submit(p, { api_version: '1.2', request_id: 'learning-' + s.revision, child_id: p.childId, session_id: s.session_id, expected_revision: s.revision, event, payload }, time); };
  send('prediction', { text: '' }); send('input_complete', { order: ['read'] });
  for (const q of lesson.questions) send('answer', { item_id: q.id, choice_index: q.correct_index, text: '', evidence_sentence_ids: q.evidence_spans.map(e => e.sentence_id), support_used: [], capture_status: 'not_attempted' });
  send('save_understand'); const before = coreSnapshot(f); assert.equal(f.core.wallet(p, p.childId).balance, 5);
  f.library.setFavorite(p, favorite(), time); f.library.setInterests(p, preference({ expected_revision: 1 }), time);
  const r = f.library.openReading(p, open(), time); f.library.updateReading(p, update(r.reading.reading_id, { marked_finished: true }), time);
  assert.deepEqual(coreSnapshot(f), before); assert.equal(f.core.audit(staff).ok, true);
});
test('view and receipts expose only explicit metadata; pins, audit and receipts resist direct rewriting', async t => {
  const f = await fixture(t), p = f.principal(), r = f.library.openReading(p, open(), time);
  const publicText = JSON.stringify([r, f.library.view(p), f.library.audit(p)]);
  assert.doesNotMatch(publicText, /correct_index|acceptable_answers|access_hash|parent_secret|recovery_code|lesson_json/);
  const db = f.db();
  for (const column of ['child_id', 'lesson_id', 'content_version', 'content_sha256', 'lesson_json']) assert.throws(() => db.exec('UPDATE library_readings SET ' + column + '=' + column), /immutable_reading_pin/);
  assert.throws(() => db.exec('DELETE FROM library_readings'), /preserve_reading_history/);
  for (const table of ['library_receipts', 'library_audit']) {
    assert.throws(() => db.exec('DELETE FROM ' + table), /immutable_library/); assert.throws(() => db.exec('UPDATE ' + table + ' SET child_id=child_id'), /immutable_library/);
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); db.close();
});
for (const operation of ['favorite', 'open', 'update']) {
  const main = { favorite: ['library_preferences_updated', 'library_favorite_updated'], open: ['library_reading_inserted'], update: ['library_reading_updated'] }[operation];
  for (const boundary of [...main, 'library_audit_inserted', 'library_receipt_inserted', 'library_before_commit', 'library_after_commit']) test('hard process exit during ' + operation + ' at ' + boundary + ' is atomic and replay-safe', async t => {
    const f = await fixture(t), p = f.principal(), before = coreSnapshot(f);
    if (operation === 'update') f.library.openReading(p, open(), time);
    const result = await worker(f, operation, boundary); assert.equal(result.signal, 'SIGKILL', result.error); await f.reopen();
    const view = f.library.view(p), committed = boundary === 'library_after_commit';
    if (operation === 'favorite') { assert.equal(view.preferences.revision, committed ? 1 : 0); assert.equal(view.favorites.length, committed ? 1 : 0); }
    else if (operation === 'open') assert.equal(view.reading_history.length, committed ? 1 : 0);
    else assert.equal(view.reading_history[0].revision, committed ? 1 : 0);
    const retry = await worker(f, operation); assert.equal(retry.code, 0, retry.error); assert.equal(JSON.parse(retry.out).replayed, committed);
    assert.deepEqual(coreSnapshot(f), before); assert.equal(f.core.audit(staff).ok, true);
  });
}
for (const operation of ['interests', 'favorite', 'open', 'update']) test('two processes replay the same ' + operation + ' request exactly once', async t => {
  const f = await fixture(t), p = f.principal(); if (operation === 'update') f.library.openReading(p, open(), time);
  const results = await Promise.all([worker(f, operation), worker(f, operation)]); assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  assert.deepEqual(results.map(r => JSON.parse(r.out).replayed).sort(), [false, true]);
  const view = f.library.view(p); assert.equal(operation === 'open' ? view.reading_history.length : operation === 'update' ? view.reading_history[0].revision : view.preferences.revision, 1);
});
for (const operation of ['favorite', 'update']) test('two processes with stale competing ' + operation + ' revisions cannot overwrite each other', async t => {
  const f = await fixture(t), p = f.principal(); if (operation === 'update') f.library.openReading(p, open(), time);
  const results = await Promise.all([worker(f, operation, '', 'compete-a'), worker(f, operation, '', 'compete-b')]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 2], JSON.stringify(results)); assert.equal(JSON.parse(results.find(r => r.code === 2).out).error, 'stale_revision');
});
