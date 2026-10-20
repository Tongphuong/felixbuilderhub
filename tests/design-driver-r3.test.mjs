// Tests for the Release-3 state driver's pure parts (scripts/design/drivers/r2l-r3.mjs): value replacement keeps the real lesson SHAPE,
// the checkpoint is built in the page's own save format, binding expectations change with the sample, and the two samples stay in step.
// (The "never fake a pack" refusal lives in ensureBookPack and needs the rehearsal server; it was exercised by hand, see the report.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { R3_STATES, sampleBookLesson, bookCheckpoint, r3Binding } from '../scripts/design/drivers/r2l-r3.mjs';
import { SAMPLE, loadSample, ALT_SAMPLE_PATH } from '../scripts/design/drivers/r2l.mjs';

const ALT = loadSample(ALT_SAMPLE_PATH);
// the real lesson response SHAPE (values from the rehearsal's "Kites" book; trimmed)
const realLesson = () => ({ ok: true, lesson: { schema_version: 2, topic: 'Kites', story: { title: 'Kites', paragraphs_en: ['A blue kite.'], sentences: [{ text_en: 'A blue kite.', paragraph_index: 0, audio_url: 'x', text_vi: 'y' }], full_audio_url: '' },
  activities: [{ type: 'read_aloud', items: [{ id: 'ra_0', text_en: 'A blue kite.', audio_url: 'x' }] }], book_images: ['a', 'b'], book_page_audio: ['a', 'b'], book_attribution: { title: 'Kites', publisher: 'P', image_credits: [] },
  guided_listening: [], vocabulary: [], web_session_checkpoint: null } });
const media = { image: '/__fidelity/sky.svg', audio: '/__fidelity/silence.wav' };

test('sampleBookLesson: 6 pages, one question per page, page 3 shows the sample sentences and question, shape preserved', () => {
  const L = sampleBookLesson(realLesson(), SAMPLE, media).lesson;
  assert.equal(L.story.title, 'The Sky Is Blue!');
  assert.equal(L.book_images.length, 6);
  assert.equal(L.book_page_audio.length, 6);
  assert.equal(L.story.paragraphs_en[2], 'The sky is blue. A little bird flies up, up, up!');
  const page3 = L.story.sentences.filter(s => s.paragraph_index === 2).map(s => s.text_en);
  assert.deepEqual(page3, ['The sky is blue.', 'A little bird flies up, up, up!']);
  const q = L.guided_listening[2].questions[0];
  assert.equal(q.question_en, 'What colour is the sky?');
  assert.deepEqual(q.options_en, ['Blue', 'Green']);
  assert.equal(q.sentence_index, L.story.sentences.findIndex(s => s.paragraph_index === 2), 'the question belongs to a sentence ON its page (selectBookQuestions filters on that)');
  assert.equal(L.activities[0].items.length, L.story.sentences.length);
  assert.equal(L.guided_listening.length, 6);
  assert.equal(L.book_attribution.image_credits.length, 6);
});

test('bookCheckpoint: the page\'s own save format puts the child on page 3 (pages 1-2 done) or on the last page with everything done', () => {
  const cp = state => bookCheckpoint(SAMPLE, state).snapshot;
  const listen = cp('book-page-listen').book_reader;
  assert.equal(listen.flowVersion, 2);
  assert.equal(listen.pages.length, 2);
  assert.ok(listen.pages.every(p => p.audio_completed && p.page_reads[0].status === 'passed' && p.question_results[0].correct));
  assert.equal(cp('book-page-question-correct').book_reader.pages.length, 3);
  assert.equal(cp('book-page-question-correct').book_reader.pages[2].question_results, undefined, 'page 3 has listened but not answered');
  assert.equal(cp('book-page-read-aloud').book_reader.pages[2].question_results.length, 1, 'page 3 listened and answered, read pending');
  const last = cp('book-last-page-done').book_reader;
  assert.equal(last.pages.length, 6);
  assert.equal(last.stage, 'next');
  assert.equal(last.pageIndex, 5);
  assert.equal(cp('book-page-listen').schema_version, 2);
  assert.equal(cp('book-page-listen').w1_phase, 'book_reader');
});

test('r3Binding: the alternate sample must change what the page is expected to show, and name the old values as gone', () => {
  const b = r3Binding(ALT, 'book-page-question-correct', SAMPLE);
  assert.ok(b.expect.includes('Red Apples Fall') && b.expect.includes('What falls from the tree?') && b.expect.includes('An apple'));
  assert.ok(b.absent.includes('The Sky Is Blue!') && b.absent.includes('What colour is the sky?'));
  assert.deepEqual(r3Binding(SAMPLE, 'book-page-listen').expect.slice(0, 2), ['The Sky Is Blue!', 'Trang 3 / 6']);
  assert.ok(r3Binding(ALT, 'story-mission-understand', SAMPLE).expect.includes('Nice try, keep going!'));
  assert.ok(r3Binding(ALT, 'logged-out', SAMPLE).expect.includes('Quyên'));
  assert.ok(r3Binding(SAMPLE, 'logged-out').expect.includes('1.080') && r3Binding(SAMPLE, 'logged-out').expect.includes('Percy'));
  assert.deepEqual(r3Binding(SAMPLE, 'story-mission-pool-rest').expect, []);
});

test('fixtures: the alternate sample has every Release-3 key of the mock sample, same list lengths, different values', () => {
  for (const k of ['book', 'voice', 'public_top3', 'error_message']) assert.ok(SAMPLE[k] && ALT[k], k);
  assert.equal(ALT.book.page_texts.length, SAMPLE.book.page_texts.length);
  assert.equal(ALT.book.question.options.length, SAMPLE.book.question.options.length);
  assert.equal(ALT.book.page, SAMPLE.book.page);
  assert.notEqual(ALT.book.title, SAMPLE.book.title);
  assert.notEqual(ALT.voice.turn_reply, SAMPLE.voice.turn_reply);
  assert.equal(SAMPLE.public_top3.xp.length, 3);
  for (const t of [SAMPLE.book.title, SAMPLE.book.question.text, SAMPLE.voice.question_text]) assert.ok(!Object.values(ALT).some(v => JSON.stringify(v).includes(t)), 'the alternate sample must not reuse ' + t);
});

test('every Release-3 contract state is implemented by the driver (when the contracts folder is on this machine)', t => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '_ops', 'specs', 'design-contracts', 'r2l-island');
  const alt = '/home/felixbuilderhub/work/repos/_ops/specs/design-contracts/r2l-island';
  const folder = fs.existsSync(dir) ? dir : fs.existsSync(alt) ? alt : null;
  if (!folder) { t.skip('contracts folder not on this machine'); return; }
  const r3 = fs.readdirSync(folder).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'))).filter(c => c.release === 3);
  assert.ok(r3.length >= 11, 'expected the 11 Release-3 contracts');
  for (const c of r3) assert.ok(R3_STATES.includes(c.built.state), `${c.id}: built.state "${c.built.state}" has no driver implementation`);
});
