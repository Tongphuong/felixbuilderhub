import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { levelIssues, requireLevelLesson, requireLevelCatalogue } from '../functions/lib/read2lead/self-learn/level-policy.mjs';
import { levelPlan, readingGroups, choicePictures, retellPictures, pictureOrderText } from '../src/lib/read2lead/self-learn/level-presentation.mjs';
import { createJourney, applyJourneyEvent } from '../functions/lib/read2lead/self-learn/journey.mjs';
import { sessionView, publicLesson } from '../functions/lib/read2lead/self-learn/views.mjs';
import { renderPlayer } from '../src/lib/read2lead/self-learn/player-views.mjs';
const read = name => JSON.parse(readFileSync(new URL('./fixtures/read2lead-self-learn/' + name, import.meta.url), 'utf8'));
const old = read('reference-lessons.json'), current = read('level-lessons.json'), time = '2026-09-18T00:00:00Z';
test('all six level packages pass explicit integrity and requested-level matching', async () => {
  assert.equal(await requireLevelCatalogue(current), current);
  for (const lesson of current.lessons) { assert.deepEqual(await levelIssues(lesson), []); assert.equal(await requireLevelLesson(lesson, lesson.level), lesson); }
});
test('L5 never receives a relabelled L4 fallback, even with simultaneous integrity faults', async () => {
  const wrong = structuredClone(current.lessons[4]); wrong.story.sentences[0].text_en += ' Synthetic typo and unsafe-advice fixture.';
  await assert.rejects(requireLevelLesson(wrong, 'L5'), e => e.message === 'unsuitable_content' && ['requested_level_mismatch', 'story_hash_mismatch', 'audio_text_mismatch'].every(code => e.issues.includes(code)));
  const relabelled = structuredClone(current.lessons[4]); relabelled.level = 'L5';
  await assert.rejects(requireLevelLesson(relabelled, 'L5'), e => e.issues.includes('level_reasoning'));
});
test('missing picture, wrong audio version and missing beginner echo cannot be ignored', async () => {
  const lesson = structuredClone(current.lessons[0]); lesson.questions[0].option_illustration_ids[0] = 'absent'; lesson.audio.content_version = '1.0.0'; lesson.shadowing.mode = 'chunk_then_fade';
  const issues = await levelIssues(lesson); for (const code of ['missing_picture_choices', 'audio_version_mismatch', 'l0_support_required']) assert.ok(issues.includes(code));
  assert.throws(() => choicePictures(publicLesson(lesson), publicLesson(lesson).questions[0]), /picture_choices_unavailable/);
});
test('reading breaks must follow the authored sentence order and catalogue versions must agree', async () => {
  const lesson = structuredClone(current.lessons[0]); lesson.input.break_after_sentence_ids = ['s5', 's2', 's6'];
  assert.ok((await levelIssues(lesson)).includes('invalid_reading_groups'));
  const collection = structuredClone(current); collection.lessons[0].version = '1.0.0';
  await assert.rejects(requireLevelCatalogue(collection), /invalid_catalogue/);
});
test('public metadata preserves authored groups and explicit picture mapping without private keys', () => {
  for (const lesson of current.lessons) {
    const view = publicLesson(lesson), groups = readingGroups(view);
    assert.deepEqual(groups.flat(), lesson.story.sentences);
    assert.deepEqual(groups.map(g => g.at(-1).id), lesson.input.break_after_sentence_ids);
    assert.doesNotMatch(JSON.stringify(view), /correct_index|accepted_meanings|evidence_spans|essential_facts/);
  }
  const l0 = publicLesson(current.lessons[0]); assert.deepEqual(choicePictures(l0, l0.questions[0]).map(p => p.id), current.lessons[0].questions[0].option_illustration_ids);
  assert.deepEqual(readingGroups(l0).map(g => g.length), [3, 3]);
  assert.throws(() => levelPlan('L6'), /unknown_level/);
  assert.notDeepEqual(levelPlan('L0'), levelPlan('L5'));
});
test('picture ordering is explicit selected evidence, rejects duplicates and does not change old pins', async () => {
  const pictures = retellPictures(publicLesson(current.lessons[0])); assert.equal(pictures.length, 3);
  assert.equal(retellPictures(publicLesson(old.lessons[0])).length, 0);
  const text = pictureOrderText(pictures, [pictures[1].id, pictures[2].id, pictures[0].id]);
  assert.match(text, /selected \(not spoken\)/); assert.ok(text.indexOf('Ben rolls') < text.indexOf('Pip gets')); assert.ok(text.indexOf('Pip gets') < text.indexOf('Ben pats'));
  assert.throws(() => pictureOrderText(pictures, [pictures[0].id, pictures[0].id, pictures[1].id]), /incomplete_picture_order/);
  const pinned = await createJourney({ sessionId: 'old-pin', childId: 'synthetic-an', lesson: old.lessons[0], now: time });
  assert.equal(sessionView(pinned).lesson.version, '1.0.0'); assert.equal(retellPictures(sessionView(pinned).lesson).length, 0);
  pinned.support.push({ item_id: 'retell', kind: 'frame' });
  assert.equal(sessionView(pinned).support[0].frame_en, 'It is …');
});
for (const lesson of current.lessons) test(lesson.level + ' complete journey retains reading, assistance and unassessed speech', async () => {
  let record = await createJourney({ sessionId: 'level-' + lesson.level, childId: 'synthetic-an', lesson, now: time });
  const apply = (event, payload = {}) => {
    const result = applyJourneyEvent(record, { api_version: '1.2', request_id: 'request-' + record.session.revision, session_id: record.session.session_id, child_id: record.session.child_id, expected_revision: record.session.revision, event, payload }, { active: true, childId: 'synthetic-an' }, time);
    assert.equal(result.response.ok, true, JSON.stringify(result.response)); record = result.record;
  };
  apply('prediction', { text: '' }); apply('input_complete', { order: ['read'] });
  for (const q of lesson.questions) apply('answer', { item_id: q.id, choice_index: q.correct_index, text: '', evidence_sentence_ids: q.evidence_spans.map(e => e.sentence_id), capture_status: 'not_attempted', support_used: [] });
  apply('save_understand'); apply('begin_use');
  const speech = { text: '', capture_status: 'not_attempted', support_used: [] };
  apply('shadow_complete', { ...speech, support_used: ['reference_script'] });
  for (const t of lesson.minny.turns) apply('minny_turn', { ...speech, turn_id: t.id });
  const before = sessionView(record), access = { active_child_id: 'synthetic-an', children: [{ id: 'synthetic-an', label_vi: 'An mẫu', level: lesson.level }] };
  const html = renderPlayer({ access, client: { view: before, row: { pending: null } } });
  assert.doesNotMatch(html, /class="picture-sequence"/); assert.match(html, /planning-headings/);
  apply('support', { item_id: 'retell', kind: 'frame' });
  const supported = sessionView(record), pictures = retellPictures(supported.lesson);
  if (pictures.length) assert.match(renderPlayer({ access, client: { view: supported, row: { pending: null } } }), /class="picture-sequence"/);
  apply('retell', { ...speech, text: pictures.length ? pictureOrderText(pictures, pictures.map(p => p.id)) : 'Synthetic explanation for review.' });
  apply('followup_answer', { ...speech, item_id: lesson.independent_followup.id, choice_index: lesson.independent_followup.correct_index }); apply('complete');
  const view = sessionView(record); assert.equal(view.session.stage, 'complete'); assert.equal(view.summary.reading.length, 3); assert.ok(view.summary.reading.every(r => r.status === 'provisional'));
  const retell = view.summary.speech.at(-1); assert.equal(retell.oral_language_state, 'unassessable'); assert.ok(retell.support_used.includes('frame')); assert.equal(retell.score, null); assert.equal(view.summary.automatic_promotion, false);
});
