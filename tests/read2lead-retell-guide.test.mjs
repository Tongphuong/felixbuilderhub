import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRetellGuideQuestions,
  buildRetellPromptEn,
  buildRetellPromptVi,
} from '../functions/api/_read2lead-retell-guide.js';
import { ensureSixActivities } from '../functions/api/_read2lead-lesson-activities.js';

const SAMPLE_LESSON = {
  story: {
    title: 'Felix and the Kite',
    paragraphs_en: [
      'Felix went to the park with his dad.',
      'The wind was strong and his kite flew high.',
      'Felix felt happy when the kite landed safely.',
    ],
  },
  topic: 'park fun',
  activities: [
    { type: 'listening_fill_blank', items: [{}] },
    { type: 'listen_and_order', items: [{}] },
    {
      type: 'reading_comprehension',
      questions: [
        { section: 'Find It', question_vi: 'Felix đi đâu cùng bố?' },
        { section: 'Find It', question_vi: 'Cái gì bay cao trên trời?' },
        { section: 'Think About It', question_vi: 'Vì sao Felix vui?' },
      ],
    },
    {
      type: 'written_response',
      questions: [
        { question_vi: 'Con thích nhất điều gì trong truyện?' },
      ],
    },
    { type: 'listen_and_speak', items: [{}] },
  ],
};

test('buildRetellGuideQuestions returns 3–4 Vietnamese guide questions', () => {
  const guide = buildRetellGuideQuestions(SAMPLE_LESSON);
  assert.ok(guide.length >= 3 && guide.length <= 4);
  assert.match(guide[0], /Felix and the Kite/);
  assert.ok(guide.some((q) => /Felix đi đâu/.test(q)));
  assert.ok(guide.some((q) => /Felix vui/.test(q)));
});

test('buildRetellGuideQuestions falls back to roadmap when pack has no comprehension', () => {
  const guide = buildRetellGuideQuestions({
    story: { title: 'A Rainy Day', paragraphs_en: ['It rained all day.'] },
    activities: [],
  });
  assert.ok(guide.length >= 3);
  assert.ok(guide.some((q) => /A Rainy Day/.test(q)));
  assert.ok(guide.some((q) => /Chuyện gì đã xảy ra/.test(q)));
});

test('buildRetellGuideQuestions dedupes repeated questions', () => {
  const guide = buildRetellGuideQuestions({
    story: { title: 'Test Story' },
    activities: [
      {
        type: 'reading_comprehension',
        questions: [
          { section: 'Find It', question_vi: 'Ai là nhân vật chính?' },
          { section: 'Find It', question_vi: 'Ai là nhân vật chính?' },
        ],
      },
    ],
  });
  const normalized = guide.map((q) => q.toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length);
});

test('buildRetellPrompt helpers reference guide scaffolding', () => {
  assert.match(buildRetellPromptVi(SAMPLE_LESSON), /câu gợi ý/);
  assert.match(buildRetellPromptEn(SAMPLE_LESSON), /guide questions/i);
});

test('ensureSixActivities injects guide_questions_vi on retell_summary', () => {
  const activities = ensureSixActivities(SAMPLE_LESSON.activities, SAMPLE_LESSON);
  const retell = activities.find((activity) => activity.type === 'retell_summary');
  assert.ok(retell);
  assert.ok(Array.isArray(retell.guide_questions_vi));
  assert.ok(retell.guide_questions_vi.length >= 3);
  assert.match(retell.prompt_vi, /câu gợi ý/);
  assert.match(retell.identity_vi, /câu gợi ý/);
});
