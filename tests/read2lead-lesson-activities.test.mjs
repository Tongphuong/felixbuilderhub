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

test('ensureSixActivities appends read_aloud after listen_and_speak', () => {
  const activities = ensureSixActivities(FIVE_ACTIVITIES);
  assert.equal(activities.length, 6);
  assert.equal(activities[4].type, 'listen_and_speak');
  assert.equal(activities[5].type, 'read_aloud');
  assert.equal(activities[5].title_vi, 'Đọc to');
});

test('ensureSixActivities is idempotent when read_aloud already exists', () => {
  const withReadAloud = ensureSixActivities(FIVE_ACTIVITIES);
  const again = ensureSixActivities(withReadAloud);
  assert.equal(again.length, 6);
  assert.equal(again.filter((activity) => activity.type === 'read_aloud').length, 1);
});
