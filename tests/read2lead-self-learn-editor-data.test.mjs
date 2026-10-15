import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { SyntheticFamilyStore } from '../scripts/lib/read2lead-self-learn-family.mjs';
import { SyntheticLibraryStore } from '../scripts/lib/read2lead-self-learn-library.mjs';
import { SyntheticEditorStore } from '../scripts/lib/read2lead-self-learn-editor.mjs';
const read = name => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + name + '.json', import.meta.url)));
const catalogue = read('level-lessons'), interests = read('library-interests'), families = read('family-access').accounts, account = read('editor-access').accounts[0], lesson = catalogue.lessons[2];
const mode = 'synthetic-local', staff = { active: true, role: 'staff', id: 'synthetic-qa' }, time = '2026-09-19T04:00:00Z';
const roots = resolve('.r2l-editor-data-proofs'); mkdirSync(roots, { recursive: true });
const marker = JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' });
function root() { const path = mkdtempSync(join(roots, 'case-')); writeFileSync(join(path, 'synthetic-target.json'), marker); return path; }
async function fixture(t, fault = () => {}) {
  const path = root(), core = new SyntheticStore({ root: path }), family = new SyntheticFamilyStore({ mode, root: path });
  for (const value of families) family.seed(staff, value, time);
  const library = await SyntheticLibraryStore.open({ mode, root: path, catalogue, interests });
  let editor = new SyntheticEditorStore({ mode, root: path, fault }); editor.seed(staff, account, time);
  t.after(() => { editor.close(); library.close(); family.close(); core.close(); });
  return { root: path, core, family, library, get editor() { return editor; },
    reopen(nextFault = fault) { editor.close(); editor = new SyntheticEditorStore({ mode, root: path, fault: nextFault }); },
    db() { return new DatabaseSync(join(path, 'read2lead-synthetic.sqlite')); },
    principal() { return editor.authenticate(account.editor_id, account.access_secret); },
    child() { return { ...family.authenticateAccess(families[0].access_code), childId: 'synthetic-an' }; } };
}
const save = (more = {}) => ({ request_id: 'save', expected_revision: 0, lesson: structuredClone(lesson), ...more });
const request = (more = {}) => ({ request_id: 'request', lesson_id: lesson.id, expected_revision: 1, ...more });
const review = (more = {}) => ({ request_id: 'review', lesson_id: lesson.id, expected_revision: 2, decision: 'qa_ready', note: 'Synthetic technical checks only.', ...more });
const publish = (more = {}) => ({ request_id: 'publish', lesson_id: lesson.id, expected_revision: 3, ...more });
const quarantine = (more = {}) => ({ request_id: 'quarantine', lesson_id: lesson.id, content_revision: 1, expected_revision: 4, blocked: true, reason: 'Synthetic availability check.', ...more });
const release = (more = {}) => quarantine({ request_id: 'release', expected_revision: 5, blocked: false, ...more });
const accessChange = (more = {}) => ({ request_id: 'disable', editor_id: account.editor_id, expected_credential_version: 1, enabled: false, ...more });
async function act(f, op, data) {
  const p = f.principal();
  if (op === 'save') return f.editor.saveDraft(p, data === undefined ? save() : data, time);
  if (op === 'request') return f.editor.requestReview(p, data === undefined ? request() : data, time);
  if (op === 'review') return f.editor.review(p, data === undefined ? review() : data, time);
  if (op === 'publish') return f.editor.publishQA(p, data === undefined ? publish() : data, time);
  return f.editor.setQuarantine(p, data === undefined ? (op === 'quarantine' ? quarantine() : release()) : data, time);
}
const operations = ['save', 'request', 'review', 'publish', 'quarantine', 'release'];
async function prepare(f, op) { for (const before of operations.slice(0, operations.indexOf(op))) await act(f, before); }
function snapshot(f, editorOnly = false) {
  const db = f.db(), result = {};
  try {
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      if (name.startsWith('editor_') !== editorOnly) continue;
      result[name] = db.prepare('SELECT * FROM ' + name + " WHERE " + (name === 'r2l_meta' ? "key<>'editor_schema_version'" : '1') + ' ORDER BY rowid').all();
    }
    return result;
  } finally { db.close(); }
}
function worker(f, op, boundary = '', requestId = 'worker-request') {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['tests/fixtures/read2lead-self-learn/editor-worker.mjs', f.root, op, boundary, requestId], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', error = ''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => error += x); child.on('error', fail);
    child.on('exit', (code, signal) => done({ code, signal, out, error }));
  });
}
function integrity(f) { const db = f.db(); try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); } finally { db.close(); } }
test('editor refuses unmarked, wrong-mode, missing-core and missing-library targets before adopting schema', t => {
  const path = root(); assert.throws(() => new SyntheticEditorStore({ mode: 'production', root: path }), /unsafe_editor_mode/);
  assert.throws(() => new SyntheticEditorStore({ mode, root: path }), /core_store_required/); assert.equal(existsSync(join(path, 'read2lead-synthetic.sqlite')), false);
  const core = new SyntheticStore({ root: path }); t.after(() => core.close());
  assert.throws(() => new SyntheticEditorStore({ mode, root: path }), /library_store_required/);
  writeFileSync(join(path, 'synthetic-target.json'), '{}'); assert.throws(() => new SyntheticEditorStore({ mode, root: path }), /unsafe_target/);
});
for (const damage of ['unknown-version', 'missing-version', 'missing-trigger', 'extra-table']) test('editor refuses ' + damage + ' on reopen', async t => {
  const f = await fixture(t), db = f.db();
  if (damage === 'unknown-version') db.exec("UPDATE r2l_meta SET value='2' WHERE key='editor_schema_version'");
  if (damage === 'missing-version') db.exec("DELETE FROM r2l_meta WHERE key='editor_schema_version'");
  if (damage === 'missing-trigger') db.exec('DROP TRIGGER editor_revision_no_update');
  if (damage === 'extra-table') db.exec('CREATE TABLE editor_unknown(x)');
  db.close(); const before = snapshot(f, true);
  assert.throws(() => new SyntheticEditorStore({ mode, root: f.root }), /unsupported_editor_schema|unrecognized_editor_schema/);
  assert.deepEqual(snapshot(f, true), before);
});
test('editor migration reopens idempotently and preserves all existing learner tables, pins and value', async t => {
  const f = await fixture(t), child = f.child();
  f.library.openReading(child, { request_id: 'old-pin', lesson_id: lesson.id }, time);
  await f.core.start(child, { sessionId: 'old-learning-pin', childId: child.childId, lesson, now: time, apiVersion: '1.2' });
  const before = snapshot(f); await prepare(f, 'release'); await act(f, 'release'); f.reopen(); f.reopen();
  assert.deepEqual(snapshot(f), before); assert.equal(f.core.audit(staff).ok, true); integrity(f);
});
test('synthetic editor seed is privileged, hashed, idempotent and never rotates an existing credential', async t => {
  const f = await fixture(t), before = snapshot(f, true);
  assert.throws(() => f.editor.seed(f.child(), account, time), /unauthorized/);
  assert.deepEqual(f.editor.seed(staff, { ...account, access_secret: 'CHANGED-PUBLIC-DEMO-SECRET' }, time), { ok: true, seeded: false });
  assert.deepEqual(snapshot(f, true), before); assert.equal(f.principal().role, 'editor');
  assert.throws(() => f.editor.authenticate(account.editor_id, 'CHANGED-PUBLIC-DEMO-SECRET'), /invalid_editor_access/);
  assert.doesNotMatch(JSON.stringify(before), /DEMO-EDITOR-LOCAL-ONLY/);
  for (const bad of [{ ...account, editor_id: 'live-editor' }, { ...account, access_secret: 'short' }, { ...account, display_name: '' }, { ...account, extra: true }]) assert.throws(() => f.editor.seed(staff, bad, time), /invalid_request/);
});
test('child, parent, staff, disabled and stale editor principals cannot read or mutate editor content', async t => {
  const f = await fixture(t), p = f.principal(); await act(f, 'save');
  const parent = f.family.elevateParent(f.family.authenticateAccess(families[0].access_code), families[0].parent_secret);
  for (const bad of [null, f.child(), parent, staff, { ...p, active: false }, { ...p, credentialVersion: 99 }, { ...p, editorId: 'live-editor' }]) {
    for (const run of [() => f.editor.list(bad), () => f.editor.document(bad, lesson.id), () => f.editor.audit(bad), () => f.editor.qaCatalogue(bad), () => f.editor.requestReview(bad, request(), time), () => f.editor.publishQA(bad, publish(), time)]) assert.throws(run, /editor_required|editor_access_revoked/);
    await assert.rejects(f.editor.saveDraft(bad, save(), time), /editor_required|editor_access_revoked/);
    await assert.rejects(f.editor.review(bad, review(), time), /editor_required|editor_access_revoked/);
    await assert.rejects(f.editor.setQuarantine(bad, quarantine(), time), /editor_required|editor_access_revoked/);
  }
  f.editor.setAccessEnabled(staff, accessChange(), time);
  assert.throws(() => f.editor.list(p), /editor_access_revoked/);
  await assert.rejects(f.editor.saveDraft(p, save(), time), /editor_access_revoked/);
  assert.throws(() => f.principal(), /invalid_editor_access/);
  const changed = f.editor.setAccessEnabled(staff, accessChange({ request_id: 'enable', expected_credential_version: 2, enabled: true }), time);
  assert.equal(changed.credential_version, 3); assert.throws(() => f.editor.list(p), /editor_access_revoked/); assert.equal(f.editor.list(f.principal()).length, 1);
  assert.equal(f.editor.setAccessEnabled(staff, accessChange(), time).enabled, false); assert.equal(f.principal().credentialVersion, 3);
});
test('save snapshots request and principal before asynchronous validation', async t => {
  const f = await fixture(t), p = f.principal(), input = save();
  const pending = f.editor.saveDraft(p, input, time); p.editorId = 'synthetic-other'; p.credentialVersion = 99; input.request_id = 'changed'; input.lesson.title_en = 'Changed after call';
  const saved = await pending; assert.equal(saved.document.title_en, lesson.title_en);
  const view = f.editor.document(f.principal(), lesson.id); assert.equal(view.revisions[0].created_by, account.editor_id);
  assert.equal((await act(f, 'save')).replayed, true);
});
for (const op of ['save', 'review', 'release']) test(op + ' rechecks revoked authority after asynchronous work before committing', async t => {
  let action = () => {}; const f = await fixture(t, name => { if (name === 'editor_before_write_lock') action(); }); await prepare(f, op);
  const p = f.principal(), other = new SyntheticEditorStore({ mode, root: f.root }); t.after(() => other.close()); const before = snapshot(f, true);
  action = () => { action = () => {}; other.setAccessEnabled(staff, accessChange(), time); };
  const run = op === 'save' ? f.editor.saveDraft(p, save(), time) : op === 'review' ? f.editor.review(p, review(), time) : f.editor.setQuarantine(p, release(), time);
  await assert.rejects(run, /editor_access_revoked/);
  const after = snapshot(f, true); for (const key of ['editor_documents', 'editor_revisions', 'editor_reviews', 'editor_blocks']) assert.deepEqual(after[key], before[key]); integrity(f);
});
test('workflow publishes only current reviewed content and keeps authored status and rights pending', async t => {
  const f = await fixture(t), p = f.principal(); assert.deepEqual(f.editor.list(p), []); assert.deepEqual(f.editor.qaCatalogue(p).lessons, []);
  const a = await act(f, 'save'); assert.equal(a.document.workflow, 'draft'); assert.equal(a.document.head_revision, 1);
  assert.throws(() => f.editor.publishQA(p, publish({ expected_revision: 1 }), time), /invalid_editor_transition/);
  await assert.rejects(f.editor.review(p, review({ expected_revision: 1 }), time), /invalid_editor_transition/);
  await act(f, 'request'); assert.throws(() => f.editor.requestReview(p, request({ request_id: 'again', expected_revision: 2 }), time), /invalid_editor_transition/);
  await act(f, 'review'); const published = await act(f, 'publish'); assert.equal(published.document.workflow, 'qa_published'); assert.equal(published.document.published_revision, 1);
  const current = f.editor.document(p, lesson.id); assert.equal(current.reviews[0].review_json.verification, 'solo_technical'); assert.equal(current.reviews[0].review_json.independent_review, false);
  assert.deepEqual(f.editor.qaCatalogue(p).lessons, [lesson]); assert.equal(f.editor.qaCatalogue(p).human_review, false);
  current.lesson.title_en = 'external mutation'; current.reviews[0].review_json.human_review = true; assert.equal(f.editor.document(p, lesson.id).lesson.title_en, lesson.title_en);
});
test('changes-requested, new draft and re-review retain old publication and immutable history', async t => {
  const f = await fixture(t), p = f.principal(); await prepare(f, 'quarantine'); const first = f.editor.document(p, lesson.id);
  const next = structuredClone(lesson); next.title_en += ' Revised';
  await act(f, 'save', save({ request_id: 'save-v2', expected_revision: 4, lesson: next }));
  assert.deepEqual(f.editor.qaCatalogue(p).lessons, [lesson]); assert.equal(f.editor.document(p, lesson.id).document.head_revision, 2);
  await act(f, 'request', request({ request_id: 'request-v2', expected_revision: 5 }));
  await act(f, 'review', review({ request_id: 'changes-v2', expected_revision: 6, decision: 'changes_requested' }));
  assert.equal(f.editor.document(p, lesson.id).document.workflow, 'changes_requested');
  assert.throws(() => f.editor.publishQA(p, publish({ request_id: 'early-v2', expected_revision: 7 }), time), /invalid_editor_transition/);
  await act(f, 'request', request({ request_id: 'request-v2-again', expected_revision: 7 }));
  await act(f, 'review', review({ request_id: 'ready-v2', expected_revision: 8 }));
  await act(f, 'publish', publish({ request_id: 'publish-v2', expected_revision: 9 }));
  assert.deepEqual(f.editor.qaCatalogue(p).lessons, [next]); assert.deepEqual(f.editor.document(p, lesson.id).revisions[1], first.revisions[0]);
  assert.equal((await act(f, 'save')).document.revision, 1); assert.equal((await act(f, 'review')).document.revision, 3); assert.equal((await act(f, 'publish')).document.revision, 4);
  assert.equal(f.editor.document(p, lesson.id).document.revision, 10);
});
for (const op of operations) test(op + ' uses immutable receipts, rejects payload changes and stale concurrent revisions', async t => {
  const f = await fixture(t); await prepare(f, op); const first = await act(f, op); f.reopen();
  const before = snapshot(f, true), again = await act(f, op); assert.deepEqual(again, { ...first, replayed: true }); assert.deepEqual(snapshot(f, true), before);
  const inputs = { save: save(), request: request(), review: review(), publish: publish(), quarantine: quarantine(), release: release() };
  const changed = { ...inputs[op], expected_revision: inputs[op].expected_revision + 1 };
  await assert.rejects(act(f, op, changed), /request_conflict/);
  await assert.rejects(act(f, op, { ...inputs[op], request_id: 'stale-' + op }), /stale_revision/);
});
test('quarantine follows exact content hash across revisions and requires fresh review to release', async t => {
  const f = await fixture(t), p = f.principal(); await prepare(f, 'quarantine'); const before = f.editor.document(p, lesson.id), hash = before.document.published_sha256;
  await act(f, 'quarantine'); assert.deepEqual(f.editor.qaCatalogue(p).lessons, []); assert.deepEqual(f.editor.availability(lesson.id, hash), { available: false, reason: 'content_quarantined' });
  f.reopen(); assert.equal(f.editor.document(p, lesson.id).document.published_available, false);
  await act(f, 'save', save({ request_id: 'same-content-v2', expected_revision: 5 }));
  assert.equal(f.editor.document(p, lesson.id).document.head_blocked, true);
  await act(f, 'request', request({ request_id: 'same-review-v2', expected_revision: 6 }));
  await act(f, 'review', review({ request_id: 'same-ready-v2', expected_revision: 7 }));
  assert.throws(() => f.editor.publishQA(p, publish({ request_id: 'blocked-publish-v2', expected_revision: 8 }), time), /content_quarantined/);
  await act(f, 'release', release({ expected_revision: 8 })); const current = f.editor.document(p, lesson.id);
  assert.equal(current.reviews.length, before.reviews.length + 2); assert.equal(current.blocks[0].revision, 2); assert.equal(current.document.published_available, true);
  assert.equal(current.reviews[0].content_revision, 1); assert.equal(current.reviews[0].review_json.human_review, false);
  assert.equal(f.editor.availability(lesson.id, hash).available, true);
  await assert.rejects(act(f, 'release', release({ request_id: 'release-again', expected_revision: 9 })), /technical_review_required/);
  const audit = f.editor.audit(p, lesson.id); assert.ok(audit.some(e => e.action === 'quarantined')); assert.equal(audit.at(-1).action, 'quarantine_released');
});
test('quarantine of old publication does not block different content and cannot erase old pins', async t => {
  const f = await fixture(t), p = f.principal(); await prepare(f, 'quarantine');
  const next = structuredClone(lesson); next.title_en += ' New';
  await act(f, 'save', save({ request_id: 'v2', expected_revision: 4, lesson: next }));
  await act(f, 'quarantine', quarantine({ expected_revision: 5 })); let doc = f.editor.document(p, lesson.id).document;
  assert.equal(doc.head_blocked, false); assert.equal(doc.published_available, false);
  await act(f, 'request', request({ request_id: 'v2-request', expected_revision: 6 }));
  await act(f, 'review', review({ request_id: 'v2-ready', expected_revision: 7 })); await act(f, 'publish', publish({ request_id: 'v2-publish', expected_revision: 8 }));
  doc = f.editor.document(p, lesson.id).document; assert.equal(doc.published_available, true); assert.equal(f.editor.availability(lesson.id, doc.head_sha256).available, true);
  assert.equal(f.editor.availability(lesson.id, f.editor.document(p, lesson.id).revisions[1].content_sha256).available, false);
  assert.equal(f.editor.availability('unknown-bootstrap', 'a'.repeat(64)).available, true);
  assert.throws(() => f.editor.availability(lesson.id, 'invalid'), /invalid_request/);
});
test('all mutation shapes and technical import controls fail without writing a receipt', async t => {
  const f = await fixture(t); await prepare(f, 'release'); const before = snapshot(f, true);
  for (const op of operations) {
    const input = { save: save(), request: request(), review: review(), publish: publish(), quarantine: quarantine(), release: release() }[op];
    for (const bad of [null, { ...input, extra: true }, { ...input, request_id: '' }, { ...input, expected_revision: -1 }, { ...input, expected_revision: Number.MAX_SAFE_INTEGER }]) await assert.rejects(act(f, op, bad), /invalid_request/);
  }
  for (const patch of [{ note: '' }, { note: 'bad\nline' }, { decision: 'human_approved' }]) await assert.rejects(act(f, 'review', review(patch)), /invalid_request/);
  for (const patch of [{ reason: '' }, { content_revision: 0 }, { blocked: 1 }]) await assert.rejects(act(f, 'quarantine', quarantine(patch)), /invalid_request/);
  const bad = structuredClone(lesson); bad.story.text_sha256 = '0'.repeat(64);
  await assert.rejects(act(f, 'save', save({ lesson: bad }))); assert.deepEqual(snapshot(f, true), before);
});
test('schema enforces immutable revisions, reviews, receipts, audit and undeletable history', async t => {
  const f = await fixture(t); await prepare(f, 'release'); const db = f.db();
  try {
    for (const [table, column] of [['editor_revisions', 'lesson_id'], ['editor_reviews', 'note'], ['editor_receipts', 'request_id'], ['editor_audit', 'reason']]) assert.throws(() => db.exec('UPDATE ' + table + ' SET ' + column + '=' + column), /immutable_editor/);
    for (const table of ['editor_accounts', 'editor_documents', 'editor_revisions', 'editor_reviews', 'editor_receipts', 'editor_audit', 'editor_blocks']) assert.throws(() => db.exec('DELETE FROM ' + table), /preserve_editor/);
    assert.throws(() => db.exec('UPDATE editor_blocks SET lesson_id=lesson_id'), /immutable_editor_block_identity/);
  } finally { db.close(); }
  integrity(f);
});
test('missing or stale technical review cannot authorize publication', async t => {
  const f = await fixture(t), p = f.principal(); await prepare(f, 'publish'); const db = f.db();
  try { db.exec('DROP TRIGGER editor_review_no_update'); db.exec("UPDATE editor_reviews SET review_json=json_set(review_json,'$.revision',99)"); }
  finally { db.close(); }
  assert.throws(() => f.editor.publishQA(p, publish(), time), /technical_review_required/); assert.deepEqual(f.editor.qaCatalogue(p).lessons, []);
});
test('consistent SQLite backup preserves every row and reopens with quarantine and immutable receipts', async t => {
  const f = await fixture(t); await prepare(f, 'release'); const target = root(), db = f.db();
  try { await backup(db, join(target, 'read2lead-synthetic.sqlite')); } finally { db.close(); }
  const recovered = new SyntheticEditorStore({ mode, root: target }); t.after(() => recovered.close()); const p = recovered.authenticate(account.editor_id, account.access_secret);
  assert.deepEqual(recovered.document(p, lesson.id), f.editor.document(f.principal(), lesson.id)); assert.deepEqual(recovered.qaCatalogue(p).lessons, []);
  assert.equal((await recovered.setQuarantine(p, quarantine(), time)).replayed, true);
  const other = { db: () => new DatabaseSync(join(target, 'read2lead-synthetic.sqlite')) }; assert.deepEqual(snapshot(other), snapshot(f)); assert.deepEqual(snapshot(other, true), snapshot(f, true)); integrity(other);
});
for (const op of operations) {
  const point = { save: 'editor_revision_inserted', request: 'editor_document_updated', review: 'editor_review_inserted', publish: 'editor_document_updated', quarantine: 'editor_block_updated', release: 'editor_review_inserted' }[op];
  const boundaries = [point, 'editor_before_commit', 'editor_after_commit', ...(op === 'save' ? ['editor_audit_inserted', 'editor_receipt_inserted'] : [])];
  for (const boundary of boundaries) test('process death during ' + op + ' at ' + boundary + ' preserves atomicity and retry receipts', async t => {
    const f = await fixture(t); await prepare(f, op); const before = snapshot(f), editorBefore = snapshot(f, true);
    const result = await worker(f, op, boundary); assert.equal(result.signal, 'SIGKILL', result.error); f.reopen();
    const committed = boundary === 'editor_after_commit'; if (!committed) assert.deepEqual(snapshot(f, true), editorBefore);
    else assert.equal(f.editor.document(f.principal(), lesson.id).document.revision, operations.indexOf(op) + 1);
    const retried = await worker(f, op); assert.equal(retried.code, 0, retried.error); assert.equal(JSON.parse(retried.out).replayed, committed);
    assert.deepEqual(snapshot(f), before); integrity(f);
  });
  test('two processes replay identical ' + op + ' once', async t => {
    const f = await fixture(t); await prepare(f, op); const results = await Promise.all([worker(f, op), worker(f, op)]);
    assert.ok(results.every(r => r.code === 0), JSON.stringify(results)); assert.deepEqual(results.map(r => JSON.parse(r.out).replayed).sort(), [false, true]);
    assert.equal(f.editor.document(f.principal(), lesson.id).document.revision, operations.indexOf(op) + 1); integrity(f);
  });
  test('two competing ' + op + ' requests cannot overwrite the same revision', async t => {
    const f = await fixture(t); await prepare(f, op); const results = await Promise.all([worker(f, op, '', 'compete-a'), worker(f, op, '', 'compete-b')]);
    assert.deepEqual(results.map(r => r.code).sort(), [0, 2], JSON.stringify(results)); assert.equal(JSON.parse(results.find(r => r.code === 2).out).error, 'stale_revision'); integrity(f);
  });
}
for (const op of ['review', 'release']) test(op + ' snapshots actor and input while validation awaits', async t => {
  const f = await fixture(t); await prepare(f, op); const p = f.principal(), input = op === 'review' ? review() : release();
  const pending = op === 'review' ? f.editor.review(p, input, time) : f.editor.setQuarantine(p, input, time);
  p.editorId = 'synthetic-replaced'; p.credentialVersion = 99; input.request_id = 'changed-after-await'; input.expected_revision = 999;
  await pending; const doc = f.editor.document(f.principal(), lesson.id); assert.equal(doc.reviews[0].created_by, account.editor_id);
  assert.equal(doc.reviews[0].review_json.reviewer_id, account.editor_id); assert.equal((await act(f, op)).replayed, true);
});
test('release refuses corrupted stored content without changing quarantine or inserting review', async t => {
  const f = await fixture(t); await prepare(f, 'release'); const db = f.db();
  try { db.exec('DROP TRIGGER editor_revision_no_update'); db.exec("UPDATE editor_revisions SET lesson_json=json_set(lesson_json,'$.title_en','Corrupted after storage')"); }
  finally { db.close(); }
  const before = snapshot(f, true); await assert.rejects(act(f, 'release'), /editor_content_corrupt/); assert.deepEqual(snapshot(f, true), before);
});
test('two processes initialize the additive editor schema once on an existing synthetic library', async t => {
  const path = root(), core = new SyntheticStore({ root: path }), family = new SyntheticFamilyStore({ mode, root: path });
  const library = await SyntheticLibraryStore.open({ mode, root: path, catalogue, interests });
  t.after(() => { library.close(); family.close(); core.close(); });
  const f = { root: path, db: () => new DatabaseSync(join(path, 'read2lead-synthetic.sqlite')) }, before = snapshot(f);
  const results = await Promise.all([worker(f, 'init'), worker(f, 'init')]); assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  const editor = new SyntheticEditorStore({ mode, root: path }); editor.close(); assert.deepEqual(snapshot(f), before); integrity(f);
});
