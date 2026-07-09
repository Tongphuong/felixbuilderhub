import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectBookQuestions,
  buildBookShadowChunks,
  validateBookFlowSubmission,
  scrollBookReaderToTop,
  BOOK_READER_SCROLL_ANCHOR_ID,
} from '../src/lib/read2lead-book-flow.mjs';
import { makeBookPackLesson, makeBookReaderState } from './helpers/book-pack-fixture.mjs';

// Global sentence indexes belonging to a given page.
function pageSentenceIndexes(lesson, pageIndex) {
  return lesson.story.sentences
    .map((sentence, index) => ({ sentence, index }))
    .filter(({ sentence }) => sentence.paragraph_index === pageIndex)
    .map(({ index }) => index);
}

test('fixture drives real question selection — one per sentence, per page', () => {
  const lesson = makeBookPackLesson({ pages: 3, questionsPerPage: 2 });
  for (let p = 0; p < 3; p += 1) {
    const selected = selectBookQuestions(lesson.guided_listening, lesson.story.sentences, p);
    assert.equal(selected.length, 2, `page ${p} should select 2 questions`);
    const onPage = pageSentenceIndexes(lesson, p);
    for (const question of selected) {
      assert.ok(onPage.includes(question.sentence_index), 'question belongs to the page');
    }
  }
});

test('fixture shadow chunks cover exactly each page\'s sentences', () => {
  const lesson = makeBookPackLesson({ pages: 2, sentencesPerPage: 2 });
  for (let p = 0; p < 2; p += 1) {
    const chunks = buildBookShadowChunks(lesson.story.sentences, p);
    assert.ok(chunks.length >= 1);
    const covered = chunks.flatMap((chunk) => chunk.sentence_indexes).sort((a, b) => a - b);
    assert.deepEqual(covered, pageSentenceIndexes(lesson, p));
  }
});

test('a completed reader state built from the fixture validates ok', () => {
  const lesson = makeBookPackLesson({ pages: 2 });
  const bookReader = makeBookReaderState(lesson);
  const result = validateBookFlowSubmission(bookReader, lesson);
  assert.equal(result.ok, true, `unexpected errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.summary.pages_heard, 2);
  assert.equal(result.summary.questions_answered, 4);
});

// --- The scroll-on-page-turn behaviour (the bug that started this work) ---

// Minimal document mock in the hand-rolled style used elsewhere in this suite
// (see tests/read2lead-w2-juice.test.mjs) — no jsdom dependency.
function mockReaderDocument() {
  const calls = [];
  const target = { scrollIntoView: (options) => calls.push(options) };
  return {
    calls,
    target,
    querySelector: (selector) => (selector === `#${BOOK_READER_SCROLL_ANCHOR_ID}` ? target : null),
  };
}

test('scrollBookReaderToTop scrolls the reader phase to its top', () => {
  const doc = mockReaderDocument();
  const returned = scrollBookReaderToTop(doc);
  assert.equal(returned, doc.target);
  assert.equal(doc.calls.length, 1);
  assert.deepEqual(doc.calls[0], { behavior: 'smooth', block: 'start' });
});

test('scrollBookReaderToTop is null-safe when the reader or document is absent', () => {
  const noReader = { querySelector: () => null };
  assert.doesNotThrow(() => scrollBookReaderToTop(noReader));
  assert.equal(scrollBookReaderToTop(noReader), null);
  assert.equal(scrollBookReaderToTop(undefined), null);
  assert.equal(scrollBookReaderToTop({}), null);
});
