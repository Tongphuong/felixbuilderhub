import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGuidedListeningState,
  markParagraphPlayed,
  recordAnswer,
  advanceToNextParagraph,
  scoreGuidedListening,
  restoreGuidedListeningState,
} from '../src/lib/r2l-guided-listening.ts';

test('createGuidedListeningState creates initial state for N paragraphs', () => {
  const state = createGuidedListeningState(3);
  assert.equal(state.phase, 'idle');
  assert.equal(state.paragraphIndex, 0);
  assert.deepEqual(state.paragraphPlayed, [false, false, false]);
  assert.deepEqual(state.paragraphsDone, [false, false, false]);
  assert.deepEqual(state.answers, {});
});

test('markParagraphPlayed sets the played flag and transitions to questioning', () => {
  const state = createGuidedListeningState(3);
  const next = markParagraphPlayed(state, 0);
  assert.equal(next.paragraphPlayed[0], true);
  assert.equal(next.phase, 'questioning');
  assert.equal(next.paragraphIndex, 0);
});

test('markParagraphPlayed ignores out-of-bounds index', () => {
  const state = createGuidedListeningState(2);
  const next = markParagraphPlayed(state, 5);
  assert.deepEqual(next.paragraphPlayed, [false, false]);
});

test('recordAnswer returns correct outcome on first try', () => {
  const state = createGuidedListeningState(2);
  // correctIndex=0, selectedIndex=0 → correct, first_try
  const result = recordAnswer(state, 0, 'q1', 0, 0);
  const key = '0:q1';
  assert.ok(result.answers[key]);
  assert.equal(result.answers[key].outcome, 'first_try');
  assert.equal(result.answers[key].correct, true);
  assert.equal(result.answers[key].attempts, 1);
});

test('recordAnswer tracks second_try and revealed outcomes', () => {
  const state = createGuidedListeningState(1);
  // First wrong answer: correctIndex=0, selectedIndex=1 → wrong
  const afterFirst = recordAnswer(state, 0, 'q1', 1, 0);
  const key = '0:q1';
  assert.equal(afterFirst.answers[key].correct, false);
  assert.equal(afterFirst.answers[key].outcome, 'second_try');
  assert.equal(afterFirst.answers[key].attempts, 1);

  // Second wrong answer → revealed
  const afterSecond = recordAnswer(afterFirst, 0, 'q1', 2, 0);
  assert.equal(afterSecond.answers[key].correct, false);
  assert.equal(afterSecond.answers[key].outcome, 'revealed');
  assert.equal(afterSecond.answers[key].attempts, 2);
});

test('scoreGuidedListening returns correct score from mixed answers', () => {
  const state = createGuidedListeningState(2);
  // q1 correct (first_try), q2 wrong (second_try)
  const s1 = recordAnswer(state, 0, 'q1', 0, 0); // correct
  const s2 = recordAnswer(s1, 1, 'q2', 2, 0); // wrong

  const score = scoreGuidedListening(s2);
  assert.equal(score.correct_count, 1);
  assert.equal(score.total_count, 2);
  assert.equal(score.score_percent, 50);
  assert.equal(score.question_outcomes.length, 2);
});

test('advanceToNextParagraph moves index forward', () => {
  const state = createGuidedListeningState(3);
  const next = advanceToNextParagraph(state);
  assert.equal(next.paragraphIndex, 1);
  assert.equal(next.phase, 'idle');
});

test('advanceToNextParagraph caps at last paragraph and sets phase to done', () => {
  const state = createGuidedListeningState(2);
  const s1 = { ...state, paragraphIndex: 1 };
  const next = advanceToNextParagraph(s1);
  assert.equal(next.paragraphIndex, 1);
  assert.equal(next.phase, 'done');
});

test('restoreGuidedListeningState recovers saved session', () => {
  const saved = {
    paragraph_index: 1,
    paragraph_played: [true, true, false],
    paragraphs_done: [true, false, false],
    answers: {
      '0:q1': { selected_index: 0, correct: true, outcome: 'first_try', attempts: 1 },
    },
  };
  const restored = restoreGuidedListeningState(saved, 3);
  assert.equal(restored.paragraphIndex, 1);
  assert.equal(restored.phase, 'questioning');
  assert.equal(restored.paragraphPlayed[0], true);
  assert.equal(restored.paragraphPlayed[1], true);
  assert.equal(restored.paragraphsDone[0], true);
  assert.equal(restored.answers['0:q1'].correct, true);
  assert.equal(restored.answers['0:q1'].outcome, 'first_try');
});

test('restoreGuidedListeningState returns fresh state for null input', () => {
  const restored = restoreGuidedListeningState(null, 3);
  assert.equal(restored.paragraphIndex, 0);
  assert.equal(restored.phase, 'idle');
  assert.deepEqual(restored.paragraphPlayed, [false, false, false]);
});
