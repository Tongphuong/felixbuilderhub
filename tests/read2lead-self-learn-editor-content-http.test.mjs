import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { initializeSyntheticTarget, startLocalQA } from '../scripts/read2lead-local-qa.mjs';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { SyntheticFamilyStore } from '../scripts/lib/read2lead-self-learn-family.mjs';
import { SyntheticLibraryStore } from '../scripts/lib/read2lead-self-learn-library.mjs';
import { createLocalHandlers } from '../functions/lib/read2lead/self-learn/handlers.mjs';
const read = n => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + n + '.json', import.meta.url)));
const lesson = read('level-lessons').lessons[2], child = 'synthetic-an';
const roots = resolve('.r2l-editor-content-http-proofs'); mkdirSync(roots, { recursive: true });
async function fixture(t) {
  const root = mkdtempSync(join(roots, 'case-')), dataRoot = join(root, 'data'), distRoot = join(root, 'dist'); mkdirSync(join(distRoot, 'read2lead/self-learn'), { recursive: true });
  writeFileSync(join(distRoot, 'read2lead/self-learn/index.html'), '<!doctype html><title>Synthetic content HTTP fixture</title>'); initializeSyntheticTarget(dataRoot);
  const qa = await startLocalQA({ mode: 'synthetic-local', dataRoot, distRoot, port: 0 }); t.after(() => qa.close()); let sequence = 0;
  const id = () => 'content-http-' + (++sequence);
  function client(editor = false) {
    const prefix = editor ? '/api/read2lead/editor/' : '/api/read2lead/self-learn/'; let cookie, csrf;
    return { get cookie() { return cookie; }, get csrf() { return csrf; }, async call(path, data) {
      const response = await fetch(qa.origin + prefix + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { origin: qa.origin, 'content-type': 'application/json', [editor ? 'x-r2l-editor-csrf' : 'x-r2l-csrf']: csrf || '' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const value = await response.json(); if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0]; if (value.csrf) csrf = value.csrf;
      return { status: response.status, value };
    } };
  }
  const editor = client(true), family = client(); assert.equal((await editor.call('login', { editor_id: 'synthetic-editor-qa', access_secret: 'DEMO-EDITOR-LOCAL-ONLY' })).status, 200); assert.equal((await family.call('login', { access_code: 'DEMO-FAMILY-A' })).status, 200);
  return { ...qa, dataRoot, editor, family, id };
}
async function publish(f, value = lesson) {
  const list = await f.editor.call('documents'), old = list.value.documents.find(d => d.lesson_id === value.id);
  let r = await f.editor.call('draft', { request_id: f.id(), expected_revision: old?.revision ?? 0, lesson: value }); assert.equal(r.status, 200, JSON.stringify(r.value));
  for (const [path, extra] of [['request-review', {}], ['review', { decision: 'qa_ready', note: 'PRIVATE_EDITOR_NOTE' }], ['publish-qa', {}]]) { r = await f.editor.call(path, { request_id: f.id(), lesson_id: value.id, expected_revision: r.value.document.revision, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.value)); }
  return r.value.document;
}
async function block(f, blocked, content_revision = 1) {
  const current = await f.editor.call('document?lesson_id=' + lesson.id); const r = await f.editor.call('quarantine', { request_id: f.id(), lesson_id: lesson.id, content_revision, expected_revision: current.value.current_view.document.revision, blocked, reason: 'PRIVATE_EDITOR_QUARANTINE_REASON' }); assert.equal(r.status, 200, JSON.stringify(r.value)); return r;
}
const start = (f, request_id) => f.family.call('start', { request_id, child_id: child, lesson_id: lesson.id });
const free = (f, request_id) => f.family.call('library/open', { request_id, child_id: child, lesson_id: lesson.id });
const event = (f, s, type, payload) => ({ api_version: '1.2', request_id: f.id(), child_id: child, session_id: s.session_id, expected_revision: s.revision, event: type, payload });
async function step(f, s, type, payload) { const r = await f.family.call('event', event(f, s, type, payload)); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value.session; }
async function shadow(f) {
  let s = (await start(f, f.id())).value.session; s = await step(f, s, 'prediction', { text: 'PRIVATE_CHILD_PREDICTION' }); s = await step(f, s, 'input_complete', { order: ['read'] });
  for (const q of lesson.questions) s = await step(f, s, 'answer', { item_id: q.id, choice_index: q.correct_index, text: '', evidence_sentence_ids: q.evidence_spans.map(x => x.sentence_id), support_used: [], capture_status: 'not_attempted' });
  s = await step(f, s, 'save_understand', {}); return step(f, s, 'begin_use', {});
}
test('actual HTTP uses current publication for new work and exact old pins for resume despite a blocked current catalogue', async t => {
  const f = await fixture(t), old = await start(f, 'old-start'), oldFree = await free(f, 'old-free'); assert.equal(old.status, 200); assert.equal(oldFree.status, 200);
  const next = structuredClone(lesson); next.title_en += ' Reviewed QA revision'; await publish(f, next);
  const cards = await f.family.call('lessons'), newer = await start(f, 'new-start'), newFree = await free(f, 'new-free');
  assert.equal(cards.value.lessons.find(l => l.id === lesson.id).title_en, next.title_en); assert.equal(newer.value.view.lesson.title_en, next.title_en); assert.equal(newFree.value.current_view.lesson.title_en, next.title_en);
  assert.notEqual(old.value.session.content_sha256, newer.value.session.content_sha256);
  await block(f, true);
  assert.ok(!(await f.family.call('lessons')).value.lessons.some(l => l.id === lesson.id)); assert.ok(!(await f.family.call('library')).value.lessons.some(l => l.id === lesson.id));
  for (const r of [await start(f, 'blocked-fresh-start'), await start(f, 'new-start'), await free(f, 'blocked-fresh-free'), await free(f, 'new-free'), await f.family.call('session?session_id=' + newer.value.session.session_id), await f.family.call('library/reading?reading_id=' + newFree.value.reading.reading_id)]) { assert.equal(r.status, 409, JSON.stringify(r.value)); assert.deepEqual(r.value, { ok: false, code: 'content_unavailable' }); }
  assert.equal((await start(f, 'old-start')).value.view.lesson.title_en, lesson.title_en); assert.equal((await free(f, 'old-free')).value.current_view.lesson.title_en, lesson.title_en);
  assert.equal((await f.family.call('session?session_id=' + old.value.session.session_id)).status, 200);
  assert.equal((await f.family.call('parent/enter', { parent_secret: 'DEMO-PARENT-A-ONLY' })).status, 200);
  const parent = await f.family.call('parent/family'); assert.equal(parent.status, 200); assert.equal(parent.value.children.find(c => c.id === child).history.length, 2); assert.doesNotMatch(JSON.stringify(parent.value), /PRIVATE_EDITOR|correct_index|acceptable_answers/);
  const doc = await f.editor.call('document?lesson_id=' + lesson.id), draft = await f.editor.call('draft', { request_id: f.id(), expected_revision: doc.value.current_view.document.revision, lesson }); assert.equal(draft.status, 200);
  await block(f, true, 2); assert.equal((await start(f, 'old-start')).status, 409); assert.equal((await free(f, 'old-free')).status, 409);
  await block(f, false, 2); assert.equal((await start(f, 'old-start')).status, 200); assert.equal((await start(f, 'new-start')).status, 409);
  await block(f, false, 1); assert.equal((await start(f, 'new-start')).status, 200); assert.equal((await f.family.call('lessons')).value.lessons.find(l => l.id === lesson.id).title_en, next.title_en);
});
test('actual HTTP quarantine refuses events and position replays while preserving parent history and earned value', async t => {
  const f = await fixture(t); await publish(f); const s = await shadow(f), reading = await free(f, 'saved-free');
  const change = { request_id: 'saved-position', child_id: child, reading_id: reading.value.reading.reading_id, expected_revision: 0, sentence_id: lesson.story.sentences[1].id, marked_finished: false };
  assert.equal((await f.family.call('library/position', change)).status, 200);
  const attempt = event(f, s, 'shadow_complete', { text: 'Synthetic oral practice.', capture_status: 'not_attempted', support_used: ['reference_script'] }); const acknowledged = await f.family.call('event', attempt); assert.equal(acknowledged.status, 200); assert.equal(acknowledged.value.wallet.balance, 5);
  await block(f, true);
  for (const r of [await f.family.call('event', attempt), await f.family.call('library/position', change)]) { assert.equal(r.status, 409); assert.deepEqual(r.value, { ok: false, code: 'content_unavailable' }); }
  await f.family.call('parent/enter', { parent_secret: 'DEMO-PARENT-A-ONLY' }); const summary = await f.family.call('parent/family'), profile = summary.value.children.find(c => c.id === child);
  assert.equal(summary.status, 200); assert.equal(profile.wallet.balance, 5); assert.equal(profile.history[0].stage, 'mini_story'); assert.doesNotMatch(JSON.stringify(summary.value), /PRIVATE_CHILD_PREDICTION|PRIVATE_EDITOR|correct_index/);
  await block(f, false); const retry = await f.family.call('event', attempt); assert.equal(retry.value.replayed, true); assert.equal(retry.value.wallet.balance, 5); assert.equal(retry.value.current_view.session.revision, acknowledged.value.current_view.session.revision);
  assert.equal((await f.family.call('library/position', change)).value.replayed, true);
});
test('handler rechecks exact-pin availability after asynchronous dialogue before returning its content', async t => {
  const f = await fixture(t); await publish(f); let s = await shadow(f); s = await step(f, s, 'shadow_complete', { text: '', capture_status: 'not_attempted', support_used: [] });
  const core = new SyntheticStore({ root: f.dataRoot, editorContent: true }), familyStore = new SyntheticFamilyStore({ mode: 'synthetic-local', root: f.dataRoot }), libraryStore = await SyntheticLibraryStore.open({ mode: 'synthetic-local', root: f.dataRoot, catalogue: read('level-lessons'), interests: read('library-interests'), editorContent: true });
  t.after(() => { libraryStore.close(); familyStore.close(); core.close(); }); let ready, finish; const begun = new Promise(r => { ready = r; }), resume = new Promise(r => { finish = r; });
  const api = createLocalHandlers({ mode: 'synthetic-local', origin: f.origin, access: read('access'), lessons: read('level-lessons').lessons, store: core, familyStore, libraryStore, libraryInterests: read('library-interests'), voice: { async dialogue() { ready(); await resume; return { text: 'PRIVATE_DELAYED_DIALOGUE' }; } } });
  const entered = await api.handle(new Request(f.origin + '/api/read2lead/self-learn/login', { method: 'POST', headers: { origin: f.origin, 'content-type': 'application/json' }, body: JSON.stringify({ access_code: 'DEMO-FAMILY-A' }) })); assert.equal(entered.status, 200); const cookie = entered.headers.get('set-cookie').split(';')[0];
  const pending = api.handle(new Request(f.origin + '/api/read2lead/self-learn/dialogue?session_id=' + s.session_id, { headers: { cookie } })); await begun; await block(f, true); finish();
  const result = await pending; assert.equal(result.status, 409); assert.deepEqual(await result.json(), { ok: false, code: 'content_unavailable' });
});
