import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBookShadowChunks,
  buildBookPageReads,
  selectBookQuestions,
  summarizeBookFlow,
  validateBookFlowSubmission,
  BOOK_QUESTION_LIMIT_V3,
  BOOK_PAGE_READ_WORD_CAP,
} from '../src/lib/read2lead-book-flow.mjs';
import { makeBookPackLesson, makeBookReaderState } from './helpers/book-pack-fixture.mjs';

function context() {
  const sentences = [
    { text_en: 'One small cat sits.', paragraph_index: 0, audio_url: '/0.mp3' },
    { text_en: 'It sees a red kite.', paragraph_index: 0, audio_url: '/1.mp3' },
    { text_en: 'The kite flies over one tall green tree.', paragraph_index: 0, audio_url: '/2.mp3' },
    { text_en: 'The cat runs home.', paragraph_index: 0, audio_url: '/3.mp3' },
  ];
  const questions = sentences.flatMap((_, sentenceIndex) => ([
    {
      id: `long_${sentenceIndex}`,
      sentence_index: sentenceIndex,
      question_en: `What is the longer question for sentence number ${sentenceIndex}?`,
      options_en: ['Wrong', 'Right', 'Unused'],
      correct_index: 1,
    },
    {
      id: `short_${sentenceIndex}`,
      sentence_index: sentenceIndex,
      question_en: `What ${sentenceIndex}?`,
      options_en: ['Yes', 'No', 'Maybe'],
      correct_index: 2,
    },
  ]));
  return {
    story: { paragraphs_en: ['Page one'], sentences },
    guided_listening: [{ paragraph_index: 0, questions }],
  };
}

function validSubmission(lesson = context()) {
  const questions = selectBookQuestions(lesson.guided_listening, lesson.story.sentences, 0);
  const chunks = buildBookShadowChunks(lesson.story.sentences, 0);
  return {
    pages: [{
      page_index: 0,
      audio_completed: true,
      question_results: questions.map((question) => ({ question_id: question.id, correct: true })),
      shadow_chunks: chunks.map((chunk) => ({
        chunk_id: chunk.chunk_id,
        sentence_indexes: chunk.sentence_indexes,
        attempts: 1,
        status: 'passed',
        score_percent: 50,
        technical_failures: 0,
      })),
    }],
  };
}

test('question selection distributes two short questions across sentences with two stable choices', () => {
  const lesson = context();
  const selected = selectBookQuestions(lesson.guided_listening, lesson.story.sentences, 0);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map((question) => question.sentence_index), [0, 1]);
  assert.deepEqual(selected.map((question) => question.id), ['short_0', 'short_1']);
  assert.deepEqual(selected[0].options_en, ['Yes', 'Maybe']);
  assert.equal(selected[0].correct_index, 1);
});

test('chunking covers ordinary sentences once in order within three-sentence and 24-word targets', () => {
  const lesson = context();
  const chunks = buildBookShadowChunks(lesson.story.sentences, 0);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.sentence_indexes), [0, 1, 2, 3]);
  assert.ok(chunks.every((chunk) => chunk.sentence_indexes.length <= 3));
  assert.ok(chunks.every((chunk) => chunk.word_count <= 24));
  assert.deepEqual(chunks.map((chunk) => chunk.chunk_id), ['p0_c0', 'p0_c1']);
});

test('an indivisible sentence may exceed the 24-word grouping target and still validate', () => {
  const lesson = context();
  lesson.story.sentences[0].text_en = Array.from(
    { length: 26 },
    (_, index) => `word${index + 1}`,
  ).join(' ');
  const chunks = buildBookShadowChunks(lesson.story.sentences, 0);
  assert.equal(chunks[0].word_count, 26);
  assert.deepEqual(chunks[0].sentence_indexes, [0]);
  assert.equal(validateBookFlowSubmission(validSubmission(lesson), lesson, { version: 2 }).ok, true);
});

test('50 percent passes while 49 percent cannot claim a passed chunk', () => {
  const lesson = context();
  const atThreshold = validSubmission(lesson);
  assert.equal(validateBookFlowSubmission(atThreshold, lesson, { version: 2 }).ok, true);
  atThreshold.pages[0].shadow_chunks[0].score_percent = 49;
  const below = validateBookFlowSubmission(atThreshold, lesson, { version: 2 });
  assert.equal(below.ok, false);
  assert.match(below.errors.join('\n'), /passed below 50 percent/);
});

test('a chunk can skip after three low-score attempts but technical failures do not consume attempts', () => {
  const lesson = context();
  const submission = validSubmission(lesson);
  Object.assign(submission.pages[0].shadow_chunks[0], {
    attempts: 3,
    status: 'skipped',
    score_percent: 49,
  });
  assert.equal(validateBookFlowSubmission(submission, lesson, { version: 2 }).ok, true);

  Object.assign(submission.pages[0].shadow_chunks[0], {
    attempts: 0,
    technical_failures: 2,
    technical_skip: true,
  });
  assert.equal(validateBookFlowSubmission(submission, lesson, { version: 2 }).ok, true);
  submission.pages[0].shadow_chunks[0].technical_failures = 1;
  assert.equal(validateBookFlowSubmission(submission, lesson, { version: 2 }).ok, false);
});

test('summary reports parent-facing page, question, chunk, and average counts', () => {
  const submission = validSubmission();
  submission.pages[0].shadow_chunks[0].score_percent = 60;
  submission.pages[0].shadow_chunks[1].score_percent = 80;
  assert.deepEqual(summarizeBookFlow(submission), {
    pages_heard: 1,
    questions_answered: 2,
    chunks_passed: 2,
    chunks_skipped: 0,
    average_pronunciation_score: 70,
  });
});

// --- book flow v3 (R2L-PAGE-LOOP): buildBookPageReads --------------------

test('buildBookPageReads keeps one unit when the page is at or under the word cap', () => {
  const lesson = context();
  const reads = buildBookPageReads(lesson.story.sentences, 0);
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].sentence_indexes, [0, 1, 2, 3]);
  assert.equal(reads[0].read_id, 'p0_r0');
  assert.equal(reads[0].text_en, lesson.story.sentences.map((s) => s.text_en).join(' '));
  assert.deepEqual(reads[0].audio_urls, lesson.story.sentences.map((s) => s.audio_url));
});

test('buildBookPageReads splits into exactly two units at the halving sentence boundary when over the cap', () => {
  const sentences = [0, 1, 2, 3].map((i) => ({
    paragraph_index: 0,
    text_en: Array.from({ length: 20 }, (_, w) => `w${i}_${w}`).join(' '),
  }));
  assert.ok(sentences.reduce((total, s) => total + s.text_en.split(' ').length, 0) > BOOK_PAGE_READ_WORD_CAP);
  const reads = buildBookPageReads(sentences, 0);
  assert.equal(reads.length, 2);
  assert.deepEqual(reads.map((r) => r.read_id), ['p0_r0', 'p0_r1']);
  assert.deepEqual(reads[0].sentence_indexes, [0, 1]);
  assert.deepEqual(reads[1].sentence_indexes, [2, 3]);
  assert.equal(reads[0].word_count, 40);
  assert.equal(reads[1].word_count, 40);
});

test('a single sentence over the word cap never splits (sentence integrity)', () => {
  const sentences = [{
    paragraph_index: 0,
    text_en: Array.from({ length: 65 }, (_, w) => `word${w}`).join(' '),
  }];
  const reads = buildBookPageReads(sentences, 0);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].word_count, 65);
  assert.deepEqual(reads[0].sentence_indexes, [0]);
});

test('an image-only page with no sentences has no page reads', () => {
  assert.deepEqual(buildBookPageReads([], 0), []);
  const otherPageSentences = [{ paragraph_index: 1, text_en: 'Other page.' }];
  assert.deepEqual(buildBookPageReads(otherPageSentences, 0), []);
});

test('buildBookPageReads read_ids are stable across repeat calls and reflect the page index', () => {
  const lesson = context();
  assert.deepEqual(
    buildBookPageReads(lesson.story.sentences, 0),
    buildBookPageReads(lesson.story.sentences, 0),
  );
  const oneSentence = [{ paragraph_index: 2, text_en: 'A short line.' }];
  assert.equal(buildBookPageReads(oneSentence, 2)[0].read_id, 'p2_r0');
});

// --- book flow v3: selectBookQuestions with BOOK_QUESTION_LIMIT_V3 --------

test('limit 4 selects up to one question per sentence across a multi-sentence page', () => {
  const lesson = context();
  const selected = selectBookQuestions(lesson.guided_listening, lesson.story.sentences, 0, BOOK_QUESTION_LIMIT_V3);
  assert.equal(selected.length, 4);
  assert.deepEqual(selected.map((question) => question.sentence_index), [0, 1, 2, 3]);
  assert.deepEqual(selected.map((question) => question.id), ['short_0', 'short_1', 'short_2', 'short_3']);
});

test('a 1-sentence page tops up from the same sentence pool and degrades below the limit', () => {
  const sentences = [{ paragraph_index: 0, text_en: 'One cat sits.' }];
  const guidedListening = [{
    paragraph_index: 0,
    questions: [
      { id: 'q_a', sentence_index: 0, question_en: 'Longer question here?', options_en: ['Wrong', 'Right'], correct_index: 1 },
      { id: 'q_b', sentence_index: 0, question_en: 'Q?', options_en: ['Yes', 'No'], correct_index: 0 },
    ],
  }];
  const selected = selectBookQuestions(guidedListening, sentences, 0, BOOK_QUESTION_LIMIT_V3);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map((question) => question.id), ['q_b', 'q_a']);
});

test('question selection order is deterministic across repeat calls at limit 4', () => {
  const lesson = context();
  const first = selectBookQuestions(lesson.guided_listening, lesson.story.sentences, 0, BOOK_QUESTION_LIMIT_V3);
  const second = selectBookQuestions(lesson.guided_listening, lesson.story.sentences, 0, BOOK_QUESTION_LIMIT_V3);
  assert.deepEqual(first, second);
});

// --- book flow v3: validateBookFlowSubmission version matrix -------------

test('a v2-shaped completed reader passes version 2 and fails version 3', () => {
  const lesson = makeBookPackLesson({ pages: 2, sentencesPerPage: 2, questionsPerPage: 2 });
  const reader = makeBookReaderState(lesson, { version: 2 });
  assert.equal(validateBookFlowSubmission(reader, lesson, { version: 2 }).ok, true);
  assert.equal(validateBookFlowSubmission(reader, lesson, { version: 3 }).ok, false);
});

test('a v3-shaped completed reader (page_reads) passes version 3 and fails version 2', () => {
  const lesson = makeBookPackLesson({ pages: 2, sentencesPerPage: 2, questionsPerPage: 2 });
  const reader = makeBookReaderState(lesson, { version: 3 });
  assert.equal(validateBookFlowSubmission(reader, lesson, { version: 3 }).ok, true);
  assert.equal(validateBookFlowSubmission(reader, lesson, { version: 2 }).ok, false);
});

test('an unsupported book_flow_version is rejected without throwing', () => {
  const lesson = makeBookPackLesson({ pages: 1, sentencesPerPage: 2, questionsPerPage: 2 });
  const reader = makeBookReaderState(lesson, { version: 3 });
  const result = validateBookFlowSubmission(reader, lesson, { version: 99 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['unsupported book_flow_version']);
  assert.equal(typeof result.summary, 'object');
  assert.equal(typeof result.skipped, 'boolean');
});

test('v3 page reads may skip after 3 attempts or a technical skip with 2 failures, but not before', () => {
  const lesson = makeBookPackLesson({ pages: 1, sentencesPerPage: 2, questionsPerPage: 2 });
  const reader = makeBookReaderState(lesson, { version: 3 });
  const firstRead = reader.pages[0].page_reads[0];

  Object.assign(firstRead, { status: 'skipped', attempts: 3, score_percent: 40 });
  assert.equal(validateBookFlowSubmission(reader, lesson, { version: 3 }).ok, true);

  firstRead.attempts = 2;
  assert.equal(validateBookFlowSubmission(reader, lesson, { version: 3 }).ok, false);

  Object.assign(firstRead, { attempts: 0, technical_skip: true, technical_failures: 2 });
  assert.equal(validateBookFlowSubmission(reader, lesson, { version: 3 }).ok, true);

  firstRead.technical_failures = 1;
  assert.equal(validateBookFlowSubmission(reader, lesson, { version: 3 }).ok, false);
});

test('v3 rejects a page whose question order does not match selectBookQuestions', () => {
  const lesson = makeBookPackLesson({ pages: 1, sentencesPerPage: 2, questionsPerPage: 2 });
  const reader = makeBookReaderState(lesson, { version: 3 });
  reader.pages[0].question_results.reverse();
  const result = validateBookFlowSubmission(reader, lesson, { version: 3 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /must answer .* selected questions in order/);
});

// --- book flow v3: summarizeBookFlow counts page_reads under chunks_* ----

test('summarizeBookFlow counts page_reads under the chunks_* keys for v3 readers', () => {
  const lesson = makeBookPackLesson({ pages: 2, sentencesPerPage: 2, questionsPerPage: 2 });
  const reader = makeBookReaderState(lesson, { version: 3 });
  reader.pages[0].page_reads[0].score_percent = 60;
  reader.pages[1].page_reads[0].score_percent = 80;
  assert.deepEqual(summarizeBookFlow(reader), {
    pages_heard: 2,
    questions_answered: 4,
    chunks_passed: 2,
    chunks_skipped: 0,
    average_pronunciation_score: 70,
  });
});
