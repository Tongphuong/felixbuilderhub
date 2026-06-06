import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const activityProgress = readFileSync('src/components/read2lead/v2/ActivityProgress.astro', 'utf-8');

test('lesson page supports the 5-activity V2 flow', () => {
  for (const type of [
    'listening_fill_blank',
    'listen_and_order',
    'reading_comprehension',
    'written_response',
    'listen_and_speak',
  ]) {
    assert.match(lessonPage, new RegExp(type));
  }
  assert.match(lessonPage, /function renderFillBlankActivity/);
  assert.match(lessonPage, /function renderWrittenActivity/);
  assert.doesNotMatch(lessonPage, /completedTypes\.size < 4/);
  assert.doesNotMatch(lessonPage, /Math\.min\(state\.activityIndex \+ 1, 3\)/);
});

test('activity progress shows exactly 5 steps in the new order', () => {
  const labels = [
    '1. Nghe điền',
    '2. Xếp câu',
    '3. Đọc hiểu',
    '4. Viết đáp án',
    '5. Nói lại',
  ];
  for (const label of labels) {
    assert.match(activityProgress, new RegExp(label));
  }
  assert.equal((activityProgress.match(/data-step-button=/g) || []).length, 5);
});
