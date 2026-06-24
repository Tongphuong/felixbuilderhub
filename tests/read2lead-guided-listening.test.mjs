import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGuidedListeningState,
  markParagraphPlayed,
  recordAnswer,
  advanceToNextParagraph,
  scoreGuidedListening,
  restoreGuidedListeningState,
  normalizeGuidedListening,
} from '../src/lib/r2l-guided-listening.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

test('normalizeGuidedListening transforms backend yes_no + choice into uniform shape', () => {
  const raw = [
    {
      paragraph_index: 0,
      questions: [
        {
          id: 'gl_p0_q1',
          type: 'yes_no',
          question_en: 'Is Pilot in the kitchen?',
          question_vi: 'Pilot co o trong bep khong?',
          answer: true,
        },
        {
          id: 'gl_p0_q2',
          type: 'choice',
          question_en: 'What does Mom help Pilot find?',
          question_vi: 'Me giup Pilot tim gi?',
          options_en: ['flour and eggs', 'a football'],
          options_vi: ['bot va trung', 'mot qua bong da'],
          correct_index: 0,
        },
      ],
    },
    {
      paragraph_index: 1,
      questions: [
        {
          id: 'gl_p1_q1',
          type: 'yes_no',
          question_en: 'Does Pilot put flour in a big bowl?',
          question_vi: 'Pilot co cho bot vao mot cai to lon khong?',
          answer: false,
        },
      ],
    },
  ];

  const result = normalizeGuidedListening(raw);

  // Should produce 3 total questions
  assert.equal(result.questions.length, 3);
  assert.equal(result.paragraphs.length, 2);

  // Yes/No question: answer=true → correct_index=0
  const yesNoQ = result.questions.find((q) => q.id === 'gl_p0_q1');
  assert.ok(yesNoQ);
  assert.equal(yesNoQ.type, 'yes_no');
  assert.deepEqual(yesNoQ.options_en, ['Yes', 'No']);
  assert.deepEqual(yesNoQ.options_vi, ['Có', 'Không']);
  assert.equal(yesNoQ.correct_index, 0);
  assert.equal(yesNoQ.answer, true);
  assert.equal(yesNoQ.paragraph_index, 0);

  // Choice question: passes through
  const choiceQ = result.questions.find((q) => q.id === 'gl_p0_q2');
  assert.ok(choiceQ);
  assert.equal(choiceQ.type, 'choice');
  assert.deepEqual(choiceQ.options_en, ['flour and eggs', 'a football']);
  assert.deepEqual(choiceQ.options_vi, ['bot va trung', 'mot qua bong da']);
  assert.equal(choiceQ.correct_index, 0);
  assert.equal(choiceQ.paragraph_index, 0);

  // Yes/No question with answer=false → correct_index=1
  const noQ = result.questions.find((q) => q.id === 'gl_p1_q1');
  assert.ok(noQ);
  assert.equal(noQ.correct_index, 1);
  assert.equal(noQ.answer, false);
  assert.equal(noQ.paragraph_index, 1);
});

test('normalizeGuidedListening returns empty for null/undefined/empty input', () => {
  assert.equal(normalizeGuidedListening(null).questions.length, 0);
  assert.equal(normalizeGuidedListening(undefined).questions.length, 0);
  assert.equal(normalizeGuidedListening([]).questions.length, 0);
});

test('normalizeGuidedListening handles the backend fixture file', () => {
  const fixturePath = join(__dirname, '..', '..', 'read2lead_v0_codex', 'tests', 'fixtures', 'guided_listening_sample_pack.json');
  if (!existsSync(fixturePath)) {
    // In case the fixture path is relative to workspace root
    const altPath = join('/home/felixbuilderhub/work/repos/read2lead_v0_codex/tests/fixtures/guided_listening_sample_pack.json');
    if (!existsSync(altPath)) {
      assert.ok(true, 'Fixture not found — skip integration test');
      return;
    }
  }
  const resolvedPath = existsSync(fixturePath) ? fixturePath : '/home/felixbuilderhub/work/repos/read2lead_v0_codex/tests/fixtures/guided_listening_sample_pack.json';
  const raw = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
  const guided = raw.guided_listening;
  assert.ok(Array.isArray(guided), 'guided_listening should be an array');

  const result = normalizeGuidedListening(guided);

  // The sample pack has 4 paragraphs, each with 2 questions = 8 total
  assert.equal(result.paragraphs.length, 4);
  assert.equal(result.questions.length, 8);

  // Verify paragraph 0 has 2 questions
  const p0 = result.paragraphs.find((p) => p.index === 0);
  assert.ok(p0);
  assert.equal(p0.questions.length, 2);

  // Verify yes_no questions got synthesized options
  const yesNoQuestions = result.questions.filter((q) => q.type === 'yes_no');
  assert.equal(yesNoQuestions.length, 4); // 4 paragraphs × 1 yes_no each
  yesNoQuestions.forEach((q) => {
    assert.deepEqual(q.options_en, ['Yes', 'No']);
    assert.deepEqual(q.options_vi, ['Có', 'Không']);
    assert.ok(q.correct_index === 0 || q.correct_index === 1);
  });

  // Verify choice questions preserved their options
  const choiceQuestions = result.questions.filter((q) => q.type === 'choice');
  assert.equal(choiceQuestions.length, 4);
  choiceQuestions.forEach((q) => {
    assert.equal(q.options_en.length, 2);
    assert.equal(q.options_vi.length, 2);
  });
});

test('lesson Guided Listening plays every sentence audio in the active paragraph', () => {
  const lessonSource = readFileSync(join(__dirname, '..', 'src', 'pages', 'read2lead', 'lesson.astro'), 'utf-8');
  assert.match(lessonSource, /filter\(\(s\) => Number\(s\.paragraph_index\) === pIdx\)/);
  assert.match(lessonSource, /playGuidedAudioSequence\(paragraphAudio, playBtn\)/);
});

test('lesson Guided Listening navigation reads the live paragraph index', () => {
  const lessonSource = readFileSync(join(__dirname, '..', 'src', 'pages', 'read2lead', 'lesson.astro'), 'utf-8');
  assert.match(lessonSource, /nav\.addEventListener\('click'/);
  assert.match(lessonSource, /const currentIndex = state\.guidedListening\.paragraphIndex/);
  assert.match(lessonSource, /Math\.max\(currentIndex - 1, 0\)/);
});

test('lesson Guided Listening allows progress after an answer is revealed', () => {
  const lessonSource = readFileSync(join(__dirname, '..', 'src', 'pages', 'read2lead', 'lesson.astro'), 'utf-8');
  assert.match(lessonSource, /answer\?\.correct \|\| answer\?\.outcome === 'revealed'/);
});
