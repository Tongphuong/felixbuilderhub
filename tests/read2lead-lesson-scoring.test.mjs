import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  questionPoints,
  calculateLessonScore,
  calculateLegacyLessonScore,
  PASS_THRESHOLD_PERCENT,
} from '../src/scripts/r2l-lesson-scoring.mjs';

test('questionPoints maps outcomes per spec', () => {
  assert.equal(questionPoints('first_try'), 1);
  assert.equal(questionPoints('second_try'), 0.5);
  assert.equal(questionPoints('revealed'), 0);
  assert.equal(questionPoints('unknown'), 0);
});

test('legacy path parity with w1 flag off', () => {
  const results = [
    { type: 'listening_fill_blank', correct_count: 4, total_count: 5, wrong_count: 2 },
    { type: 'written_response', correct_count: 5, total_count: 5, wrong_count: 0 },
  ];
  const legacy = calculateLegacyLessonScore(results);
  const viaFlag = calculateLessonScore(results, { w1: false });
  assert.deepEqual(viaFlag, legacy);
  assert.equal(legacy.score_percent, Math.round((9 / 11) * 100));
});

test('w1 path uses question_outcomes for point-tracked activities', () => {
  const results = [
    {
      type: 'reading_comprehension',
      correct_count: 2,
      total_count: 4,
      wrong_count: 2,
      question_outcomes: [
        { id: 'q1', outcome: 'first_try', attempts: 1 },
        { id: 'q2', outcome: 'second_try', attempts: 2 },
        { id: 'q3', outcome: 'revealed', attempts: 2 },
        { id: 'q4', outcome: 'first_try', attempts: 1 },
      ],
    },
    {
      type: 'written_response',
      correct_count: 5,
      total_count: 5,
      wrong_count: 0,
    },
  ];
  const score = calculateLessonScore(results, { w1: true });
  // MCQ: 1 + 0.5 + 0 + 1 = 2.5 over 4 = 63%
  // written adds 5/5 legacy-style in denominator via non-outcome branch
  assert.equal(score.score_percent, Math.round(((2.5 + 5) / (4 + 5)) * 100));
});

test('PASS_THRESHOLD_PERCENT unchanged at 50', () => {
  assert.equal(PASS_THRESHOLD_PERCENT, 50);
});
