import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import { SyntheticStore, syntheticDatabasePath } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { SyntheticFamilyStore } from '../scripts/lib/read2lead-self-learn-family.mjs';
import { SyntheticLibraryStore } from '../scripts/lib/read2lead-self-learn-library.mjs';
import { SyntheticEditorStore } from '../scripts/lib/read2lead-self-learn-editor.mjs';
import { contentHash } from '../scripts/lib/read2lead-self-learn-content.mjs';
const read = n => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + n + '.json', import.meta.url)));
const catalogue = read('level-lessons'), interests = read('library-interests'), lesson = catalogue.lessons[2], editorAccount = read('editor-access').accounts[0];
const mode = 'synthetic-local', staff = { active: true, role: 'staff', id: 'synthetic-content' }, time = '2026-09-19T06:00:00Z';
const roots = resolve('.r2l-editor-content-proofs'); mkdirSync(roots, { recursive: true });
function root() { const p = mkdtempSync(join(roots, 'case-')); writeFileSync(join(p, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' })); return p; }
async function fixture(t) {
  const path = root(); let action = () => {};
  const core = new SyntheticStore({ root: path, editorContent: true, fault: n => action(n) }), family = new SyntheticFamilyStore({ mode, root: path });
  for (const a of read('family-access').accounts) family.seed(staff, a, time);
  const library = await SyntheticLibraryStore.open({ mode, root: path, catalogue, interests, editorContent: true, fault: n => action(n) });
  const editor = new SyntheticEditorStore({ mode, root: path }); editor.seed(staff, editorAccount, time); let serial = 0;
  t.after(() => { editor.close(); library.close(); family.close(); core.close(); });
  return { root: path, core, family, library, editor, id: () => 'content-' + (++serial), setFault(fn) { action = fn; },
    principal: { ...family.authenticateAccess('DEMO-FAMILY-A'), childId: 'synthetic-an' },
    ep: editor.authenticate(editorAccount.editor_id, editorAccount.access_secret),
    db() { return new DatabaseSync(join(path, 'read2lead-synthetic.sqlite')); } };
}
async function publish(f, value = lesson) {
  const doc = f.editor.list(f.ep).find(d => d.lesson_id === value.id); let r = await f.editor.saveDraft(f.ep, { request_id: f.id(), expected_revision: doc?.revision ?? 0, lesson: value }, time);
  r = f.editor.requestReview(f.ep, { request_id: f.id(), lesson_id: value.id, expected_revision: r.document.revision }, time);
  r = await f.editor.review(f.ep, { request_id: f.id(), lesson_id: value.id, expected_revision: r.document.revision, decision: 'qa_ready', note: 'Synthetic content integration.' }, time);
  return f.editor.publishQA(f.ep, { request_id: f.id(), lesson_id: value.id, expected_revision: r.document.revision }, time);
}
async function block(f, blocked = true, version = 1, lessonId = lesson.id) { const doc = f.editor.document(f.ep, lessonId).document; return f.editor.setQuarantine(f.ep, { request_id: f.id(), lesson_id: lessonId, content_revision: version, expected_revision: doc.revision, blocked, reason: 'Synthetic content availability.' }, time); }
const start = (f, value = lesson, id = 'old-session') => f.core.start(f.principal, { sessionId: id, childId: f.principal.childId, lesson: value, now: time, apiVersion: '1.2' });
const open = (f, id = 'old-reading') => f.library.openReading(f.principal, { request_id: id, lesson_id: lesson.id }, time);
const event = (f, s, type = 'prediction', payload = { text: 'Synthetic thought.' }) => ({ api_version: '1.2', request_id: f.id(), child_id: f.principal.childId, session_id: s.session_id, expected_revision: s.revision, event: type, payload });
function send(f, s, type, payload) { return f.core.submit(f.principal, event(f, s, type, payload), time).session; }
function learnerRows(f) {
  const db = f.db(), rows = {};
  try { for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'editor_%' ORDER BY name").all()) rows[name] = db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all(); return rows; } finally { db.close(); }
}
function workerBlock(f) { const r = spawnSync(process.execPath, ['tests/fixtures/read2lead-self-learn/editor-worker.mjs', f.root, 'quarantine', '', 'content-worker-block'], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(JSON.parse(r.stdout).blocked, true); }
function integrity(f) { const db = f.db(); try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); } finally { db.close(); } }
async function understand(f) {
  let s = (await start(f)).session; s = send(f, s, 'prediction', { text: 'Synthetic prediction.' }); s = send(f, s, 'input_complete', { order: ['read'] });
  for (const q of lesson.questions) s = send(f, s, 'answer', { item_id: q.id, choice_index: q.correct_index, text: '', evidence_sentence_ids: q.evidence_spans.map(x => x.sentence_id), support_used: [], capture_status: 'not_attempted' });
  return send(f, s, 'save_understand', {});
}
test('content-aware mode is explicit and fails closed on missing or unknown editor schema', async t => {
  const f = await fixture(t); await start(f); const db = f.db();
  assert.throws(() => new SyntheticStore({ root: f.root, editorContent: 'yes' }), /invalid_content_mode/);
  await assert.rejects(SyntheticLibraryStore.open({ mode, root: f.root, catalogue, interests, editorContent: 'yes' }), /invalid_content_mode/);
  db.exec("UPDATE r2l_meta SET value='99' WHERE key='editor_schema_version'");
  assert.throws(() => f.library.catalogue(f.principal), /content_unavailable/); assert.throws(() => f.core.read(f.principal, f.principal.childId, 'old-session'), /content_unavailable/);
  db.exec("DELETE FROM r2l_meta WHERE key='editor_schema_version'"); assert.throws(() => f.library.catalogue(f.principal), /content_unavailable/); db.close();
});
test('only reviewed publication replaces bootstrap content and new pins; existing pins and value stay unchanged', async t => {
  const f = await fixture(t), s = await start(f), reading = open(f), before = learnerRows(f);
  const next = structuredClone(lesson); next.title_en += ' Revised';
  await f.editor.saveDraft(f.ep, { request_id: f.id(), expected_revision: 0, lesson: next }, time);
  assert.equal(f.library.catalogue(f.principal).find(l => l.id === lesson.id).title_en, lesson.title_en);
  await publish(f, next); assert.equal(f.library.catalogue(f.principal).find(l => l.id === lesson.id).title_en, next.title_en);
  assert.deepEqual(learnerRows(f), before); assert.equal(f.core.availableRecord(f.principal, f.principal.childId, s.session.session_id).lesson.title_en, lesson.title_en);
  assert.equal(f.library.reading(f.principal, reading.reading.reading_id).lesson.title_en, lesson.title_en);
  const newer = await start(f, next, 'new-session'), newerReading = open(f, 'new-reading');
  assert.equal(newer.session.content_sha256, contentHash(next)); assert.equal(newerReading.reading.content_sha256, contentHash(next));
  assert.equal((await start(f)).replayed, true); assert.equal(open(f).replayed, true); integrity(f);
});
test('new QA lesson with a new theme is selectable without inferring interests or changing its level', async t => {
  const f = await fixture(t), next = structuredClone(lesson); next.id = 'synthetic-editor-new-lesson'; next.theme = 'an original new theme'; await publish(f, next);
  assert.equal(f.library.catalogue(f.principal).length, catalogue.lessons.length + 1);
  const r = f.library.openReading(f.principal, { request_id: 'new-theme', lesson_id: next.id }, time); assert.equal(r.reading.level, lesson.level);
  assert.deepEqual(f.library.view(f.principal).preferences.interest_ids, []);
  assert.equal((await start(f, next, 'new-theme-session')).session.content_sha256, contentHash(next));
});
test('quarantine blocks catalogue, new starts, saved reads, updates and old receipts without deleting history', async t => {
  const f = await fixture(t); await publish(f); const s = await start(f), reading = open(f), request = event(f, s.session); f.core.submit(f.principal, request, time);
  const update = { request_id: 'saved-position', reading_id: reading.reading.reading_id, expected_revision: 0, sentence_id: lesson.story.sentences[1].id, marked_finished: false }; f.library.updateReading(f.principal, update, time);
  const before = learnerRows(f); await block(f);
  assert.ok(!f.library.catalogue(f.principal).some(l => l.id === lesson.id)); assert.ok(!f.library.view(f.principal).suggestions.some(l => l.lesson_id === lesson.id));
  assert.throws(() => open(f, 'fresh-blocked'), /content_unavailable/); assert.throws(() => open(f), /content_unavailable/);
  assert.throws(() => f.library.reading(f.principal, reading.reading.reading_id), /content_unavailable/);
  assert.throws(() => f.library.updateReading(f.principal, update, time), /content_unavailable/);
  assert.throws(() => f.library.updateReading(f.principal, { ...update, request_id: 'next-position', expected_revision: 1 }, time), /content_unavailable/);
  assert.throws(() => f.core.read(f.principal, f.principal.childId, s.session.session_id), /content_unavailable/);
  assert.throws(() => f.core.availableRecord(f.principal, f.principal.childId, s.session.session_id), /content_unavailable/);
  assert.throws(() => f.core.submit(f.principal, request, time), /content_unavailable/);
  await assert.rejects(start(f), /content_unavailable/); await assert.rejects(start(f, lesson, 'fresh-blocked'), /content_unavailable/);
  assert.equal(f.core.history(f.principal, f.principal.childId).length, 1); assert.equal(f.library.view(f.principal).reading_history.length, 1);
  assert.deepEqual(learnerRows(f), before); await block(f, false);
  assert.equal(open(f).replayed, true); assert.equal(f.library.updateReading(f.principal, update, time).replayed, true); assert.equal(f.core.submit(f.principal, request, time).replayed, true); assert.equal((await start(f)).replayed, true);
  assert.deepEqual(learnerRows(f), before); integrity(f);
});
test('a blocked published revision never falls back to bootstrap while an earlier unblocked pin remains resumable', async t => {
  const f = await fixture(t), old = await start(f), reading = open(f); const next = structuredClone(lesson); next.title_en += ' Current'; await publish(f, next); await block(f);
  assert.ok(!f.library.catalogue(f.principal).some(l => l.id === lesson.id)); assert.throws(() => open(f, 'new-blocked'), /content_unavailable/);
  assert.equal(f.core.availableRecord(f.principal, f.principal.childId, old.session.session_id).lesson.title_en, lesson.title_en);
  assert.equal(f.library.reading(f.principal, reading.reading.reading_id).lesson.title_en, lesson.title_en);
  assert.equal((await start(f)).replayed, true); assert.equal(open(f).replayed, true);
  await assert.rejects(start(f, lesson, 'stale-selection'), /content_unavailable/);
});
test('quarantine of an older exact hash blocks its pins while different reviewed content stays available', async t => {
  const f = await fixture(t); await publish(f); await start(f); const oldReading = open(f); const next = structuredClone(lesson); next.title_en += ' Different'; await publish(f, next); await block(f, true, 1);
  assert.equal(f.library.catalogue(f.principal).find(l => l.id === lesson.id).title_en, next.title_en);
  assert.throws(() => f.core.read(f.principal, f.principal.childId, 'old-session'), /content_unavailable/); assert.throws(() => f.library.reading(f.principal, oldReading.reading.reading_id), /content_unavailable/);
  assert.equal((await start(f, next, 'new-version')).session.content_sha256, contentHash(next)); assert.equal(open(f, 'new-version-reading').reading.content_sha256, contentHash(next));
  await block(f, false, 1); assert.equal((await start(f)).replayed, true); assert.equal(open(f).replayed, true);
});
test('identical content copied into another revision remains blocked until audited release', async t => {
  const f = await fixture(t); await publish(f); await block(f);
  const current = f.editor.document(f.ep, lesson.id).document; await f.editor.saveDraft(f.ep, { request_id: f.id(), expected_revision: current.revision, lesson }, time);
  assert.ok(!f.library.catalogue(f.principal).some(l => l.id === lesson.id)); await assert.rejects(start(f), /content_unavailable/);
  await block(f, false, 2); assert.equal(f.library.catalogue(f.principal).find(l => l.id === lesson.id).id, lesson.id); await start(f);
});
test('removing a favorite after quarantine preserves interests and does not remove reading history', async t => {
  const f = await fixture(t); await publish(f); open(f);
  f.library.setInterests(f.principal, { request_id: f.id(), expected_revision: 0, interest_ids: ['nature'] }, time);
  f.library.setFavorite(f.principal, { request_id: f.id(), expected_revision: 1, lesson_id: lesson.id, favorite: true }, time); await block(f);
  assert.throws(() => f.library.setFavorite(f.principal, { request_id: f.id(), expected_revision: 2, lesson_id: lesson.id, favorite: true }, time), /content_unavailable/);
  f.library.setFavorite(f.principal, { request_id: f.id(), expected_revision: 2, lesson_id: lesson.id, favorite: false }, time);
  const view = f.library.view(f.principal); assert.deepEqual(view.preferences.interest_ids, ['nature']); assert.deepEqual(view.favorites, []); assert.equal(view.reading_history.length, 1);
});
test('quarantine and release retain earned synthetic value and acknowledged learning evidence', async t => {
  const f = await fixture(t); await publish(f); const s = await understand(f); assert.equal(f.core.wallet(f.principal, f.principal.childId).balance, 5);
  const before = learnerRows(f); await block(f); assert.throws(() => send(f, s, 'begin_use', {}), /content_unavailable/);
  assert.deepEqual(learnerRows(f), before); assert.equal(f.core.audit(staff).ok, true); await block(f, false); assert.deepEqual(learnerRows(f), before);
  assert.equal(f.core.availableRecord(f.principal, f.principal.childId, s.session_id).session.stage, 'understand_saved'); assert.equal(send(f, s, 'begin_use', {}).stage, 'shadowing');
  assert.equal(f.core.wallet(f.principal, f.principal.childId).balance, 5);
});
for (const op of ['start', 'event', 'free-open', 'free-update', 'event-replay', 'free-replay']) test('separate-process quarantine immediately before ' + op + ' write lock prevents a stale write or replay', async t => {
  const f = await fixture(t); await publish(f); let s, reading, savedEvent;
  if (op.startsWith('event')) { s = await start(f); savedEvent = event(f, s.session); if (op === 'event-replay') f.core.submit(f.principal, savedEvent, time); }
  if (op === 'free-update' || op === 'free-replay') reading = open(f);
  const before = learnerRows(f); let once = true;
  f.setFault(name => { if (once && ['content_before_write_lock', 'library_before_write_lock'].includes(name)) { once = false; workerBlock(f); } });
  if (op === 'start') await assert.rejects(start(f), /content_unavailable/);
  else if (op.startsWith('event')) assert.throws(() => f.core.submit(f.principal, savedEvent, time), /content_unavailable/);
  else if (op === 'free-update') assert.throws(() => f.library.updateReading(f.principal, { request_id: 'racing-position', reading_id: reading.reading.reading_id, expected_revision: 0, sentence_id: lesson.story.sentences[1].id, marked_finished: false }, time), /content_unavailable/);
  else assert.throws(() => open(f, op === 'free-replay' ? 'old-reading' : 'racing-reading'), /content_unavailable/);
  assert.equal(once, false); assert.deepEqual(learnerRows(f), before); integrity(f);
});
test('changed publication after validation rejects a stale new start while preserving an existing pin', async t => {
  const f = await fixture(t); await start(f); const next = structuredClone(lesson); next.title_en += ' Updated'; await publish(f, next);
  await assert.rejects(start(f, lesson, 'stale-new-start'), /content_unavailable/); assert.equal((await start(f)).replayed, true); assert.equal((await start(f, next, 'current-start')).replayed, false);
});
test('current authority callback runs under the event lock even for original receipts', async t => {
  const f = await fixture(t), s = await start(f), data = event(f, s.session); f.core.submit(f.principal, data, time);
  const before = learnerRows(f); const deny = () => { const e = Error('revoked-at-commit'); e.code = 'unauthorized'; throw e; };
  assert.throws(() => f.core.submit(f.principal, data, time, deny), /revoked-at-commit/); assert.deepEqual(learnerRows(f), before);
});
test('corrupted published JSON is refused instead of serving an unchecked replacement', async t => {
  const f = await fixture(t); await publish(f); const db = f.db(); db.exec('DROP TRIGGER editor_revision_no_update'); db.exec("UPDATE editor_revisions SET lesson_json=json_set(lesson_json,'$.title_en','Corrupt text')"); db.close();
  assert.throws(() => f.library.catalogue(f.principal), /content_unavailable/); assert.throws(() => open(f), /content_unavailable/);
});
test('consistent backup reopens with exact pins, quarantine and learner rows intact', async t => {
  const f = await fixture(t); await publish(f); await understand(f); open(f); await block(f); const before = learnerRows(f), target = root(), db = f.db();
  try { await backup(db, join(target, 'read2lead-synthetic.sqlite')); } finally { db.close(); }
  const core = new SyntheticStore({ root: target, editorContent: true }), library = await SyntheticLibraryStore.open({ mode, root: target, catalogue, interests, editorContent: true });
  t.after(() => { library.close(); core.close(); }); const recovered = { db: () => new DatabaseSync(join(target, 'read2lead-synthetic.sqlite')) };
  assert.deepEqual(learnerRows(recovered), before); assert.throws(() => core.availableRecord(f.principal, f.principal.childId, 'old-session'), /content_unavailable/); assert.ok(!library.catalogue(f.principal).some(l => l.id === lesson.id));
  assert.equal(core.wallet(f.principal, f.principal.childId).balance, 5); assert.equal(core.audit(staff).ok, true); integrity(recovered);
});

for (const foreign of [false, true]) test('synthetic identity probe waits for a database lock and rechecks identity, foreign=' + foreign, async t => {
  const path = root(), initial = new SyntheticStore({ root: path }); initial.close();
  const file = join(path, 'read2lead-synthetic.sqlite'), setup = new DatabaseSync(file); setup.exec('PRAGMA journal_mode=DELETE'); setup.close();
  const bytes = readFileSync(file);
  const worker = spawn(process.execPath, ['--input-type=module', '-e', `import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN EXCLUSIVE');
    if (process.argv[2] === 'true') db.exec('PRAGMA application_id=0');
    process.stdout.write('locked\\n'); setTimeout(() => { db.exec('COMMIT'); db.close(); }, 350);`, file, String(foreign)], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (worker.exitCode === null) worker.kill(); });
  let errors = ''; worker.stderr.on('data', x => { errors += x; });
  const exited = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', code => code === 0 ? resolve() : reject(Error(errors))); });
  await new Promise((resolve, reject) => { worker.stdout.once('data', resolve); worker.once('error', reject); });
  try {
    if (foreign) assert.throws(() => syntheticDatabasePath(path), /unsafe_target/);
    else { assert.equal(syntheticDatabasePath(path), file); assert.deepEqual(readFileSync(file), bytes); }
  } finally { await exited; }
});
