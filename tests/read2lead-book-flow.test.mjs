import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBookShadowChunks,
  selectBookQuestions,
  summarizeBookFlow,
  validateBookFlowSubmission,
} from '../src/lib/read2lead-book-flow.mjs';

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

test('question selection distributes four short questions across sentences with two stable choices', () => {
  const lesson = context();
  const selected = selectBookQuestions(lesson.guided_listening, lesson.story.sentences, 0);
  assert.equal(selected.length, 4);
  assert.deepEqual(selected.map((question) => question.sentence_index), [0, 1, 2, 3]);
  assert.deepEqual(selected.map((question) => question.id), ['short_0', 'short_1', 'short_2', 'short_3']);
  assert.deepEqual(selected[0].options_en, ['Yes', 'Maybe']);
  assert.equal(selected[0].correct_index, 1);
});

test('chunking covers every sentence once in order within three-sentence and 24-word limits', () => {
  const lesson = context();
  const chunks = buildBookShadowChunks(lesson.story.sentences, 0);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.sentence_indexes), [0, 1, 2, 3]);
  assert.ok(chunks.every((chunk) => chunk.sentence_indexes.length <= 3));
  assert.ok(chunks.every((chunk) => chunk.word_count <= 24));
  assert.deepEqual(chunks.map((chunk) => chunk.chunk_id), ['p0_c0', 'p0_c1']);
});

test('50 percent passes while 49 percent cannot claim a passed chunk', () => {
  const lesson = context();
  const atThreshold = validSubmission(lesson);
  assert.equal(validateBookFlowSubmission(atThreshold, lesson).ok, true);
  atThreshold.pages[0].shadow_chunks[0].score_percent = 49;
  const below = validateBookFlowSubmission(atThreshold, lesson);
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
  assert.equal(validateBookFlowSubmission(submission, lesson).ok, true);

  Object.assign(submission.pages[0].shadow_chunks[0], {
    attempts: 0,
    technical_failures: 2,
    technical_skip: true,
  });
  assert.equal(validateBookFlowSubmission(submission, lesson).ok, true);
  submission.pages[0].shadow_chunks[0].technical_failures = 1;
  assert.equal(validateBookFlowSubmission(submission, lesson).ok, false);
});

test('summary reports parent-facing page, question, chunk, and average counts', () => {
  const submission = validSubmission();
  submission.pages[0].shadow_chunks[0].score_percent = 60;
  submission.pages[0].shadow_chunks[1].score_percent = 80;
  assert.deepEqual(summarizeBookFlow(submission), {
    pages_heard: 1,
    questions_answered: 4,
    chunks_passed: 2,
    chunks_skipped: 0,
    average_pronunciation_score: 70,
  });
});
