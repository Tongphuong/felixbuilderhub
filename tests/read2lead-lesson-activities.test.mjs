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

test('ensureSixActivities populates read_aloud items from story sentences', () => {
  const activities = [
    { type: 'listening_fill_blank', items: [] },
    { type: 'listen_and_order', items: [] },
    { type: 'reading_comprehension', items: [] },
    { type: 'listen_and_speak', items: [] },
  ];
  const lessonContext = {
    story: {
      sentences: [
        { text_en: 'The cat sat.', text_vi: 'Con mèo ngồi.', audio_url: 'https://audio.test/1.mp3' },
        { text_en: 'It was happy.', text_vi: 'Nó vui.', audio_url: 'https://audio.test/2.mp3' },
      ],
    },
  };
  const result = ensureSixActivities(activities, lessonContext);
  const ra = result.find((a) => a.type === 'read_aloud');
  assert.ok(ra, 'read_aloud activity should exist');
  assert.equal(ra.items.length, 2, 'should have 2 items from story');
  assert.equal(ra.items[0].text_en, 'The cat sat.');
  assert.equal(ra.items[0].id, 'ra_0');
  assert.equal(ra.scoring_mode, 'whisper_stt');
});

test('ensureSixActivities does not duplicate read_aloud', () => {
  const activities = [
    { type: 'listening_fill_blank', items: [] },
    { type: 'listen_and_speak', items: [] },
    { type: 'read_aloud', items: [{ id: 'existing' }] },
  ];
  const result = ensureSixActivities(activities);
  const raCount = result.filter((a) => a.type === 'read_aloud').length;
  assert.equal(raCount, 1, 'should not inject duplicate read_aloud');
});
