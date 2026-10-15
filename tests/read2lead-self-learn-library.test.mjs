import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { composeLocalCatalogue, contentDigest } from '../functions/lib/read2lead/self-learn/catalogue.mjs';
import { createLocalHandlers } from '../functions/lib/read2lead/self-learn/handlers.mjs';
import { SyntheticStore } from '../scripts/lib/read2lead-self-learn-sqlite.mjs';
import { createJourney } from '../functions/lib/read2lead/self-learn/journey.mjs';
import { publicLesson } from '../functions/lib/read2lead/self-learn/views.mjs';
import { choicePictures, retellPictures, readingGroups } from '../src/lib/read2lead/self-learn/level-presentation.mjs';

const read = n => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + n, import.meta.url), 'utf8'));
const config = { mode: 'synthetic-local', base: read('level-lessons.json'), additional: read('library-lessons.json'), review: read('library-review.json') };
const access = read('access.json'), original = read('reference-lessons.json');
test('catalogue has thirty exact reviewed snapshots, five per level, without mutating its sources', async () => {
  const before = JSON.stringify(config), result = await composeLocalCatalogue(config);
  assert.equal(result.lessons.length, 30); assert.equal(JSON.stringify(config), before);
  for (let i = 0; i < 6; i++) assert.equal(result.lessons.filter(l => l.level === 'L' + i).length, 5);
  result.lessons[0].title_en = 'Caller mutation'; assert.notEqual(config.base.lessons[0].title_en, 'Caller mutation');
  const copy = structuredClone(config), pending = composeLocalCatalogue(copy);
  copy.additional.lessons[0].title_en = 'Late source mutation';
  assert.notEqual((await pending).lessons[6].title_en, 'Late source mutation');
});
const bad = [
  ['remote mode', c => c.mode = 'production', 'local_catalogue_only'],
  ['missing lesson', c => c.additional.lessons.pop(), 'invalid_catalogue_count'],
  ['wrong level distribution', c => c.additional.lessons[0].level = 'L5', 'invalid_level_count'],
  ['duplicate lesson ID', c => c.additional.lessons[1].id = c.additional.lessons[0].id, 'invalid_catalogue'],
  ['missing review', c => c.review.reviews.pop(), 'invalid_review'],
  ['duplicate review', c => c.review.reviews[1] = c.review.reviews[0], 'invalid_review'],
  ['unknown review ID', c => c.review.reviews[0].lesson_id = 'unknown', 'invalid_review'],
  ['stale question key', c => c.additional.lessons[0].questions[0].correct_index = 1, 'stale_content_review'],
  ['stale SVG', c => c.additional.lessons[0].illustrations[0].svg += ' ', 'stale_content_review'],
  ['missing beginner picture', c => c.additional.lessons[0].illustrations.splice(2, 1), 'unsuitable_content'],
  ['false human approval', c => c.review.reviews[0].human_review = true, 'invalid_review'],
  ['false independent review', c => c.review.reviews[0].independent_review = true, 'invalid_review'],
  ['false publication', c => c.additional.lessons[0].review.publication = 'approved', 'invalid_candidate_policy'],
  ['unreviewed objective', c => c.additional.lessons[0].objectives = ['Different purpose'], 'invalid_review'],
  ['missing review version', c => delete c.review.reviews[0].version, 'invalid_review'],
  ['false audio availability', c => c.additional.lessons[0].audio.asset_status = 'ready', 'invalid_candidate_policy'],
];
for (const [name, mutate, message] of bad) test('catalogue refuses ' + name, async () => {
  const c = structuredClone(config); mutate(c);
  await assert.rejects(composeLocalCatalogue(c), e => e.message === message);
});
test('new catalogue cannot replace a pinned old lesson, and DTOs expose no private rubric', async () => {
  const old = await createJourney({ sessionId: 'synthetic-old-pin', childId: 'synthetic-an', lesson: original.lessons[0], now: '2026-09-18T00:00:00Z' });
  const before = JSON.stringify(old), current = await composeLocalCatalogue(config);
  assert.equal(old.lesson.version, '1.0.0'); assert.equal(JSON.stringify(old), before);
  assert.notEqual(old.session.content_sha256, await contentDigest(current.lessons[0]));
  for (const lesson of current.lessons) {
    const dto = publicLesson(lesson);
    assert.doesNotMatch(JSON.stringify(dto), /correct_index|accepted_meanings|evidence_spans|essential_facts|expected_meaning/);
    assert.deepEqual(readingGroups(dto).flat(), lesson.story.sentences);
    if (lesson.level === 'L0') assert.equal(choicePictures(dto, dto.questions[0]).length, 3);
    assert.equal(retellPictures(dto).length, ['L0', 'L1'].includes(lesson.level) ? 3 : 0);
  }
});

const roots = resolve('.r2l-library-proofs'); mkdirSync(roots, { recursive: true });
const origin = 'http://127.0.0.1:18876', prefix = '/api/read2lead/self-learn/';
for (const lesson of [...config.base.lessons, ...config.additional.lessons]) test(lesson.id + ' completes authenticated persisted journey and one-time credits', async t => {
  const root = mkdtempSync(join(roots, 'case-'));
  writeFileSync(join(root, 'synthetic-target.json'), JSON.stringify({ format: 1, purpose: 'read2lead-local-synthetic', database: 'read2lead-synthetic.sqlite' }));
  let store = new SyntheticStore({ root }); t.after(() => store.close());
  let api = createLocalHandlers({ mode: 'synthetic-local', origin, access, store, lessons: (await composeLocalCatalogue(config)).lessons });
  let cookie, csrf;
  async function request(path, data) {
    const response = await api.handle(new Request(origin + prefix + path, { method: data === undefined ? 'GET' : 'POST', headers: { origin, ...(cookie ? { cookie, 'x-r2l-csrf': csrf } : {}), ...(data !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }));
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value));
    if (path === 'login') { cookie = response.headers.get('set-cookie').split(';')[0]; csrf = value.csrf; }
    return value;
  }
  await request('login', { access_code: 'DEMO-FAMILY-A' });
  const filtered = await request('lessons?level=' + lesson.level); assert.equal(filtered.lessons.length, 5);
  assert.ok(filtered.lessons.every(l => l.level === lesson.level));
  let state = await request('start', { request_id: 'library-start', child_id: 'synthetic-an', lesson_id: lesson.id });
  const pin = state.session.content_sha256; assert.equal(pin, await contentDigest(lesson));
  async function send(event, payload = {}) {
    const s = state.current_view?.session || state.session;
    const body = { api_version: '1.2', request_id: 'library-event-' + s.revision, child_id: s.child_id, session_id: s.session_id, expected_revision: s.revision, event, payload };
    state = await request('event', body); return body;
  }
  await send('prediction', { text: 'Synthetic prediction.' }); await send('input_complete', { order: ['read'] });
  for (const q of lesson.questions) await send('answer', { item_id: q.id, choice_index: q.correct_index, text: '', evidence_sentence_ids: q.evidence_spans.map(e => e.sentence_id), capture_status: 'not_attempted', support_used: [] });
  await send('save_understand'); assert.equal(state.wallet.balance, 5);
  await send('begin_use');
  const text = { text: 'Synthetic text-only practice.', capture_status: 'not_attempted', support_used: [] };
  await send('shadow_complete', { ...text, support_used: ['reference_script'] });
  for (const turn of lesson.minny.turns) await send('minny_turn', { ...text, turn_id: turn.id });
  await send('retell', { ...text, text: lesson.retell.accepted_paraphrases.at(-1) });
  await send('followup_answer', { item_id: lesson.independent_followup.id, choice_index: lesson.independent_followup.correct_index, ...text });
  const completed = await send('complete'); assert.equal(state.wallet.balance, 10);
  const replay = await request('event', completed); assert.equal(replay.replayed, true); assert.equal(replay.wallet.balance, 10);
  const sid = state.session.session_id; store.close(); store = new SyntheticStore({ root });
  api = createLocalHandlers({ mode: 'synthetic-local', origin, access, store, lessons: (await composeLocalCatalogue(config)).lessons });
  await request('login', { access_code: 'DEMO-FAMILY-A' });
  const persisted = await request('session?session_id=' + sid), view = persisted.view;
  assert.equal(view.session.stage, 'complete'); assert.equal(view.session.content_sha256, pin); assert.equal(view.lesson.id, lesson.id);
  assert.equal(persisted.wallet.balance, 10); assert.equal(view.summary.reading.length, 3);
  assert.ok(view.summary.reading.every(r => r.status === 'provisional'));
  assert.ok(view.summary.speech.every(r => r.oral_language_state === 'unassessable' && r.score === null));
  assert.equal(view.summary.automatic_mastery, false); assert.equal(view.summary.automatic_promotion, false);
  assert.equal(api.diagnostics().provider_enabled, false);
});
