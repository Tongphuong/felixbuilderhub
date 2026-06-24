import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRetellGuideQuestions,
  buildRetellPromptEn,
  buildRetellPromptVi,
  buildRetellTemplate,
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

test('buildRetellTemplate returns fill-in-the-blank English lines', () => {
  const template = buildRetellTemplate(SAMPLE_LESSON);
  assert.ok(template.lines.length >= 3);
  assert.match(template.lines[0].template, /Felix goes to ______ \(where\)/);
  assert.match(template.lines[0].template, /with his dad/);
  assert.match(template.lines[2].template, /feels ______ \(how\)/);
  assert.match(template.speak_prompt_en, /Felix goes to the park with his dad/);
  assert.match(template.speak_prompt_en, /feels happy/i);
});

test('buildRetellTemplate works for title-name stories like Ong and the Red Kite', () => {
  const template = buildRetellTemplate({
    story: {
      title: 'Ong and the Red Kite',
      paragraphs_en: [
        'Ong goes to the park to fly his red kite.',
        'The kite soars high above the trees.',
        'Ong felt proud when the kite landed softly.',
      ],
    },
    activities: [],
  });
  assert.match(template.lines[0].template, /^Ong goes to/);
  assert.match(template.speak_prompt_en, /Ong goes to the park/);
});

test('buildRetellGuideQuestions legacy helper mirrors template lines', () => {
  const guide = buildRetellGuideQuestions(SAMPLE_LESSON);
  assert.equal(guide.length, buildRetellTemplate(SAMPLE_LESSON).lines.length);
  assert.match(guide[0], /______/);
});

test('buildRetellTemplate falls back when pack has minimal story data', () => {
  const template = buildRetellTemplate({
    story: { title: 'A Rainy Day', paragraphs_en: ['It rained all day.', 'The child stayed inside.'] },
    activities: [],
  });
  assert.ok(template.lines.length >= 3);
  assert.match(template.speak_prompt_en, /A Rainy Day|They|child/i);
});

test('buildRetellPrompt helpers reference template scaffolding', () => {
  assert.match(buildRetellPromptVi(SAMPLE_LESSON), /chỗ trống|truyện/);
  assert.match(buildRetellPromptEn(SAMPLE_LESSON), /fill in the blanks/i);
});

test('ensureSixActivities injects read_aloud after listen_and_speak', () => {
  const activities = ensureSixActivities(SAMPLE_LESSON.activities, SAMPLE_LESSON);
  const ra = activities.find((activity) => activity.type === 'read_aloud');
  assert.ok(ra);
  assert.equal(ra.title_vi, 'Đọc to');
});
