import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSixActivities } from '../functions/api/_read2lead-lesson-activities.js';

const FIVE_ACTIVITIES = [
  { type: 'listening_fill_blank', items: [{}] },
  { type: 'listen_and_order', items: [{}] },
  { type: 'reading_comprehension', questions: [{}] },
  { type: 'written_response', questions: [{}] },
  { type: 'listen_and_speak', items: [{}] },
];

test('ensureSixActivities appends retell_summary after listen_and_speak', () => {
  const activities = ensureSixActivities(FIVE_ACTIVITIES);
  assert.equal(activities.length, 6);
  assert.equal(activities[4].type, 'listen_and_speak');
  assert.equal(activities[5].type, 'retell_summary');
  assert.equal(activities[5].title_vi, 'Kể truyện');
  // Retell was redesigned to a fill-in-the-blank template (retell_template.lines)
  // instead of the deprecated guide_questions_vi array.
  assert.ok(activities[5].retell_template, 'retell_template should be present');
  assert.ok(Array.isArray(activities[5].retell_template.lines));
  assert.ok(activities[5].retell_template.lines.length >= 3);
});

test('ensureSixActivities is idempotent when retell already exists', () => {
  const withRetell = ensureSixActivities(FIVE_ACTIVITIES);
  const again = ensureSixActivities(withRetell);
  assert.equal(again.length, 6);
  assert.equal(again.filter((activity) => activity.type === 'retell_summary').length, 1);
});
