import test from 'node:test';
import assert from 'node:assert/strict';
import { writtenModelAnswer } from '../src/scripts/r2l-written-model-answer.mjs';

const rcQuestions = [
  {
    question_en: 'What did Pilot use?',
    options_en: ['glue and tape', 'flour and sugar', 'paint and brush'],
    correct_index: 0,
  },
  {
    question_en: 'Where did Pilot find the kite?',
    options_en: ['in the attic', 'in the kitchen', 'at school'],
    correct_index: 0,
  },
];

test('writtenModelAnswer prefers expected_answer_en from pack', () => {
  assert.equal(
    writtenModelAnswer(
      {
        question_en: 'What did Pilot do when the glue spilled?',
        expected_answer_en: 'He wiped it with a cloth.',
      },
      rcQuestions,
    ),
    'He wiped it with a cloth.',
  );
});

test('writtenModelAnswer does not use RC option by question index', () => {
  assert.equal(
    writtenModelAnswer(
      { question_en: 'What did Pilot do when the glue spilled?' },
      rcQuestions,
    ),
    '',
  );
});

test('writtenModelAnswer uses RC correct option only when question_en matches', () => {
  assert.equal(
    writtenModelAnswer({ question_en: 'Where did Pilot find the kite?' }, rcQuestions),
    'in the attic',
  );
});
