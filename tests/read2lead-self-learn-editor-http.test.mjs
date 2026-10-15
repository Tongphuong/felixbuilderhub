import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { initializeSyntheticTarget, startLocalQA } from '../scripts/read2lead-local-qa.mjs';
const read = name => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + name + '.json', import.meta.url)));
const lesson = read('level-lessons').lessons[2], account = read('editor-access').accounts[0];
const roots = resolve('.r2l-editor-http-proofs'); mkdirSync(roots, { recursive: true });
function fixture() {
  const root = mkdtempSync(join(roots, 'case-')), dataRoot = join(root, 'data'), distRoot = join(root, 'dist');
  mkdirSync(join(distRoot, 'read2lead/self-learn'), { recursive: true }); writeFileSync(join(distRoot, 'read2lead/self-learn/index.html'), '<!doctype html><title>Isolated player fixture</title>');
  initializeSyntheticTarget(dataRoot); return { root, dataRoot, distRoot };
}
function client(qa, prefix = '/api/read2lead/editor/') {
  let cookie, csrf; const header = prefix.includes('/editor/') ? 'x-r2l-editor-csrf' : 'x-r2l-csrf';
  return { get cookie() { return cookie; }, get csrf() { return csrf; },
    async call(route, data, extra = {}) {
      const response = await fetch(qa.origin + prefix + route, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { origin: qa.origin, 'content-type': 'application/json', ...(csrf ? { [header]: csrf } : {}) }), ...extra }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text(); if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0]; if (value.csrf) csrf = value.csrf;
      return { response, value };
    } };
}
const credentials = { editor_id: account.editor_id, access_secret: account.access_secret };
const draft = { request_id: 'http-draft', expected_revision: 0, lesson };
function snapshot(root) {
  const db = new DatabaseSync(join(root, 'read2lead-synthetic.sqlite'), { readOnly: true }), rows = {};
  try { for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) rows[name] = db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all(); return rows; }
  finally { db.close(); }
}
test('actual editor HTTP isolates family cookies, content and writes with strict response headers', async t => {
  const f = fixture(), qa = await startLocalQA({ ...f, mode: 'synthetic-local', port: 0 }); t.after(() => qa.close());
  const editor = client(qa), family = client(qa, '/api/read2lead/self-learn/'); assert.equal((await editor.call('documents')).response.status, 401);
  const entered = await editor.call('login', credentials); assert.equal(entered.response.status, 200); assert.equal(entered.value.role, 'editor');
  assert.match(entered.response.headers.get('set-cookie'), /Path=\/api\/read2lead\/editor\//); assert.match(entered.response.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal((await family.call('login', { access_code: 'DEMO-FAMILY-A' })).response.status, 200);
  const denied = await fetch(qa.origin + '/api/read2lead/editor/documents', { headers: { cookie: family.cookie } }); assert.equal(denied.status, 401); assert.doesNotMatch(await denied.text(), /correct_index|lesson_json|questions/);
  assert.equal((await family.call('me', undefined, { cookie: editor.cookie })).response.status, 401);
  assert.equal((await editor.call('draft', draft, { origin: 'https://evil.example' })).response.status, 403);
  assert.equal((await editor.call('draft', draft, { 'x-r2l-editor-csrf': 'wrong' })).response.status, 403);
  assert.equal((await editor.call('draft', draft)).response.status, 200);
  const view = await editor.call('document?lesson_id=' + lesson.id); assert.equal(view.value.current_view.document.revision, 1); assert.equal(view.response.headers.get('cache-control'), 'no-store'); assert.equal(view.response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual((await editor.call('catalogue')).value.lessons, []);
  assert.equal((await fetch(qa.origin + '/tests/fixtures/read2lead-self-learn/editor-access.json')).status, 404);
});
test('actual HTTP lost acknowledgements, restart and consistent backup preserve all editorial and learner state', async t => {
  const f = fixture(), drop = new Set(['draft', 'request-review', 'review', 'publish-qa', 'quarantine']);
  let qa = await startLocalQA({ ...f, mode: 'synthetic-local', port: 0, afterHandle({ request, response }) { const route = new URL(request.url).pathname.split('/editor/')[1]; if (response.ok && drop.delete(route)) return 'drop'; } });
  t.after(() => qa.close()); let editor = client(qa), family = client(qa, '/api/read2lead/self-learn/');
  assert.equal((await editor.call('login', credentials)).response.status, 200); assert.equal((await family.call('login', { access_code: 'DEMO-FAMILY-A' })).response.status, 200);
  const opened = await family.call('library/open', { request_id: 'before-editor-reading', child_id: 'synthetic-an', lesson_id: lesson.id }); assert.equal(opened.response.status, 200);
  const before = snapshot(f.dataRoot), steps = [['draft', draft], ['request-review', { request_id: 'http-review-request', lesson_id: lesson.id, expected_revision: 1 }], ['review', { request_id: 'http-review', lesson_id: lesson.id, expected_revision: 2, decision: 'qa_ready', note: 'HTTP synthetic review.' }], ['publish-qa', { request_id: 'http-publish', lesson_id: lesson.id, expected_revision: 3 }], ['quarantine', { request_id: 'http-quarantine', lesson_id: lesson.id, content_revision: 1, expected_revision: 4, blocked: true, reason: 'HTTP synthetic quarantine.' }]];
  for (const [route, data] of steps) { await assert.rejects(editor.call(route, data)); const retry = await editor.call(route, data); assert.equal(retry.response.status, 200, JSON.stringify(retry.value)); assert.equal(retry.value.replayed, true); }
  assert.equal(drop.size, 0); assert.deepEqual((await editor.call('catalogue')).value.lessons, []);
  const oldCookie = editor.cookie; await qa.close(); qa = await startLocalQA({ ...f, mode: 'synthetic-local', port: 0 }); editor = client(qa);
  assert.equal((await editor.call('documents', undefined, { cookie: oldCookie })).response.status, 401); assert.equal((await editor.call('login', credentials)).response.status, 200);
  const replay = await editor.call('draft', draft); assert.equal(replay.value.replayed, true); assert.equal(replay.value.document.revision, 1); assert.equal(replay.value.current_view.document.revision, 5); assert.equal(replay.value.current_view.document.published_available, false);
  const after = snapshot(f.dataRoot); for (const table of Object.keys(before).filter(n => !n.startsWith('editor_'))) assert.deepEqual(after[table], before[table], table);
  const restoreRoot = join(f.root, 'restored'); initializeSyntheticTarget(restoreRoot); const db = new DatabaseSync(join(f.dataRoot, 'read2lead-synthetic.sqlite'));
  try { await backup(db, join(restoreRoot, 'read2lead-synthetic.sqlite')); } finally { db.close(); }
  assert.deepEqual(snapshot(restoreRoot), after);
  const restored = await startLocalQA({ ...f, dataRoot: restoreRoot, mode: 'synthetic-local', port: 0 }); t.after(() => restored.close()); const recovery = client(restored); await recovery.call('login', credentials);
  assert.deepEqual((await recovery.call('document?lesson_id=' + lesson.id)).value.current_view, replay.value.current_view);
  assert.equal((await recovery.call('quarantine', steps.at(-1)[1])).value.replayed, true);
  const release = { ...steps.at(-1)[1], request_id: 'http-release', expected_revision: 5, blocked: false, reason: 'HTTP recovery release.' }; const released = await recovery.call('quarantine', release); assert.equal(released.response.status, 200); assert.equal(released.value.current_view.document.published_available, true);
  assert.deepEqual((await recovery.call('catalogue')).value.lessons, [lesson]); assert.deepEqual((await editor.call('catalogue')).value.lessons, []);
  const check = new DatabaseSync(join(restoreRoot, 'read2lead-synthetic.sqlite'), { readOnly: true }); try { assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []); } finally { check.close(); }
  writeFileSync(join(f.root, 'recovery-evidence.json'), JSON.stringify({ status: 'PASS', source: f.dataRoot, backup: restoreRoot, lost_acknowledgements: 5, original_quarantined: true, restored_released: true, all_rows_matched_before_release: true, preserved_learner_tables: Object.keys(before).filter(n => !n.startsWith('editor_')), independent_review: false }, null, 2) + '\n');
});
