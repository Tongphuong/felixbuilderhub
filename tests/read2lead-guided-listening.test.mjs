import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGuidedListeningState,
  markSentencePlayed,
  recordAnswer,
  advanceToNextSentence,
  scoreGuidedListening,
  restoreGuidedListeningState,
  normalizeGuidedListening,
} from '../src/lib/r2l-guided-listening.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('createGuidedListeningState creates version 3 state for N sentences', () => {
  const state = createGuidedListeningState(3);
  assert.equal(state.progressVersion, 3);
  assert.equal(state.phase, 'idle');
  assert.equal(state.sentenceIndex, 0);
  assert.deepEqual(state.sentencePlayed, [false, false, false]);
  assert.deepEqual(state.sentencesDone, [false, false, false]);
  assert.deepEqual(state.answers, {});
});

test('markSentencePlayed sets the played flag and transitions to questioning', () => {
  const state = createGuidedListeningState(3);
  const next = markSentencePlayed(state, 0);
  assert.equal(next.sentencePlayed[0], true);
  assert.equal(next.phase, 'questioning');
  assert.equal(next.sentenceIndex, 0);
});

test('markSentencePlayed ignores out-of-bounds index', () => {
  const state = createGuidedListeningState(2);
  const next = markSentencePlayed(state, 5);
  assert.deepEqual(next.sentencePlayed, [false, false]);
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

test('recordAnswer marks a sentence done only after every expected question is correct', () => {
  const state = createGuidedListeningState(2);
  const afterFirst = recordAnswer(state, 0, 'q1', 0, 0, ['q1', 'q2']);
  assert.equal(afterFirst.sentencesDone[0], false);
  const afterSecond = recordAnswer(afterFirst, 0, 'q2', 1, 1, ['q1', 'q2']);
  assert.equal(afterSecond.sentencesDone[0], true);
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

test('advanceToNextSentence moves index forward', () => {
  const state = createGuidedListeningState(3);
  const next = advanceToNextSentence(state);
  assert.equal(next.sentenceIndex, 1);
  assert.equal(next.phase, 'idle');
});

test('advanceToNextSentence caps at last sentence and sets phase to done', () => {
  const state = createGuidedListeningState(2);
  const s1 = { ...state, sentenceIndex: 1 };
  const next = advanceToNextSentence(s1);
  assert.equal(next.sentenceIndex, 1);
  assert.equal(next.phase, 'done');
});

test('restoreGuidedListeningState recovers sentence-level saved session', () => {
  const saved = {
    progressVersion: 2,
    sentenceIndex: 1,
    sentencePlayed: [true, true, false],
    sentencesDone: [true, false, false],
    answers: {
      '0:q1': { selected_index: 0, correct: true, outcome: 'first_try', attempts: 1 },
    },
  };
  const restored = restoreGuidedListeningState(saved, 3);
  assert.equal(restored.progressVersion, 3);
  assert.equal(restored.sentenceIndex, 1);
  assert.equal(restored.phase, 'questioning');
  assert.equal(restored.sentencePlayed[0], true);
  assert.equal(restored.sentencePlayed[1], true);
  assert.equal(restored.sentencesDone[0], true);
  assert.equal(restored.answers['0:q1'].correct, true);
  assert.equal(restored.answers['0:q1'].outcome, 'first_try');
});

test('restoreGuidedListeningState migrates paragraphIndex to the first sentence in that paragraph', () => {
  const saved = {
    paragraphIndex: 1,
    paragraphPlayed: [true, false],
    paragraphsDone: [true, false],
    answers: {},
  };
  const restored = restoreGuidedListeningState(saved, 5, [0, 3]);
  assert.equal(restored.progressVersion, 3);
  assert.equal(restored.sentenceIndex, 3);
  assert.equal(restored.phase, 'idle');
  assert.deepEqual(restored.sentencesDone, [true, true, true, false, false]);
});

test('restoreGuidedListeningState returns fresh state for null input', () => {
  const restored = restoreGuidedListeningState(null, 3);
  assert.equal(restored.sentenceIndex, 0);
  assert.equal(restored.phase, 'idle');
  assert.deepEqual(restored.sentencePlayed, [false, false, false]);
});

test('normalizeGuidedListening transforms v3 WH- comprehension questions', () => {
  const raw = [
    {
      paragraph_index: 0,
      questions: [
        {
          id: 'gl_p0_s0_q1',
          sentence_index: 0,
          type: 'choice',
          question_en: 'Who goes to the park?',
          options_en: ['Mai', 'Her mom', 'Her dad'],
          correct_index: 0,
        },
        {
          id: 'gl_p0_s0_q2',
          sentence_index: 0,
          type: 'choice',
          question_en: 'Where does Mai go?',
          options_en: ['To the park', 'To school', 'To the market'],
          correct_index: 0,
        },
      ],
    },
    {
      paragraph_index: 1,
      questions: [
        {
          id: 'gl_p1_s2_q1',
          sentence_index: 2,
          type: 'choice',
          question_en: 'What does Mai see?',
          options_en: ['A red bird', 'A blue kite', 'A big dog'],
          correct_index: 1,
        },
      ],
    },
  ];

  const result = normalizeGuidedListening(raw);

  // 3 total questions across 2 paragraphs
  assert.equal(result.questions.length, 3);
  assert.equal(result.paragraphs.length, 2);

  // All questions are choice type in v3
  result.questions.forEach((q) => {
    assert.equal(q.type, 'choice');
    assert.equal(q.options_en.length, 3);
  });

  // First question
  const q1 = result.questions.find((q) => q.id === 'gl_p0_s0_q1');
  assert.ok(q1);
  assert.equal(q1.type, 'choice');
  assert.deepEqual(q1.options_en, ['Mai', 'Her mom', 'Her dad']);
  assert.equal(q1.correct_index, 0);
  assert.equal(q1.paragraph_index, 0);
  assert.equal(q1.sentence_index, 0);

  // Second question
  const q2 = result.questions.find((q) => q.id === 'gl_p0_s0_q2');
  assert.ok(q2);
  assert.equal(q2.correct_index, 0);
  assert.equal(q2.paragraph_index, 0);
  assert.equal(q2.sentence_index, 0);

  // Third question (paragraph 1)
  const q3 = result.questions.find((q) => q.id === 'gl_p1_s2_q1');
  assert.ok(q3);
  assert.equal(q3.correct_index, 1);
  assert.equal(q3.paragraph_index, 1);
  assert.equal(q3.sentence_index, 2);
});

test('normalizeGuidedListening returns empty for null/undefined/empty input', () => {
  assert.equal(normalizeGuidedListening(null).questions.length, 0);
  assert.equal(normalizeGuidedListening(undefined).questions.length, 0);
  assert.equal(normalizeGuidedListening([]).questions.length, 0);
});

test('normalizeGuidedListening handles v3 WH- comprehension format', () => {
  // v3 mock data inline — no fixture file needed
  const guided = [
    {
      paragraph_index: 0,
      questions: [
        { id: 'gl_p0_s0_q1', type: 'choice', sentence_index: 0, question_en: 'Who goes?', options_en: ['Mai', 'Mom', 'Dad'], correct_index: 0 },
        { id: 'gl_p0_s0_q2', type: 'choice', sentence_index: 0, question_en: 'Where to?', options_en: ['Park', 'School', 'Market'], correct_index: 0 },
      ],
    },
    {
      paragraph_index: 1,
      questions: [
        { id: 'gl_p1_s1_q1', type: 'choice', sentence_index: 1, question_en: 'What did she see?', options_en: ['Bird', 'Kite', 'Dog'], correct_index: 0 },
        { id: 'gl_p1_s1_q2', type: 'choice', sentence_index: 1, question_en: 'What color?', options_en: ['Red', 'Blue', 'Green'], correct_index: 0 },
        { id: 'gl_p1_s2_q1', type: 'choice', sentence_index: 2, question_en: 'How did she feel?', options_en: ['Happy', 'Sad', 'Tired'], correct_index: 0 },
        { id: 'gl_p1_s2_q2', type: 'choice', sentence_index: 2, question_en: 'What did she do?', options_en: ['Smiled', 'Cried', 'Ran'], correct_index: 0 },
      ],
    },
  ];

  const result = normalizeGuidedListening(guided);
  assert.equal(result.paragraphs.length, 2);
  assert.equal(result.questions.length, 6);

  // All questions are choice type in v3
  result.questions.forEach((q) => {
    assert.equal(q.type, 'choice');
    assert.equal(q.options_en.length, 3);
  });

  // Paragraph 0 check
  const p0 = result.paragraphs.find((p) => p.index === 0);
  assert.ok(p0);
  assert.equal(p0.questions.length, 2);
});

test('lesson Guided Listening plays only the active sentence audio before questions', () => {
  const lessonSource = readFileSync(join(__dirname, '..', 'src', 'pages', 'read2lead', 'lesson.astro'), 'utf-8');
  assert.match(lessonSource, /const sentenceIndex = state\.guidedListening\.sentenceIndex/);
  assert.match(lessonSource, /const url = currentSentence\?\.audio_url \|\| ''/);
  assert.match(lessonSource, /audio\.addEventListener\('ended', revealQuestions/);
});

test('lesson Guided Listening auto-advances after all sentence questions are answered', () => {
  const lessonSource = readFileSync(join(__dirname, '..', 'src', 'pages', 'read2lead', 'lesson.astro'), 'utf-8');
  assert.match(lessonSource, /function checkSentenceCompletion\(sentenceIndex, sentences\)/);
  assert.match(lessonSource, /const allAnswered = sentenceQuestions\.every/);
  assert.match(lessonSource, /window\.setTimeout\(\(\) => advanceGuidedSentence\(sentences\), 700\)/);
});

test('lesson Guided Listening allows progress after an answer is revealed', () => {
  const lessonSource = readFileSync(join(__dirname, '..', 'src', 'pages', 'read2lead', 'lesson.astro'), 'utf-8');
  assert.match(lessonSource, /answer\?\.correct \|\| answer\?\.outcome === 'revealed'/);
});

test('lesson Guided Listening has its own skip handler and final mission CTA', () => {
  const lessonSource = readFileSync(join(__dirname, '..', 'src', 'pages', 'read2lead', 'lesson.astro'), 'utf-8');
  assert.match(lessonSource, /function skipGuidedSentence\(sentences\)/);
  assert.match(lessonSource, /nextBtn\.textContent = 'Bỏ qua câu này'/);
  assert.match(lessonSource, /nextBtn\.textContent = 'Bắt đầu nhiệm vụ 🎯'/);
});
