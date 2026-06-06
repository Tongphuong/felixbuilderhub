import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const activityProgress = readFileSync('src/components/read2lead/v2/ActivityProgress.astro', 'utf-8');
const stateModule = readFileSync('functions/api/_read2lead-v2-state.js', 'utf-8');
const submitModule = readFileSync('functions/api/submit-read2lead-lesson.js', 'utf-8');

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

test('listen_and_order uses editable drag-drop slots instead of one-way token picking', () => {
  assert.match(lessonPage, /data-order-slot=/);
  assert.match(lessonPage, /draggable="true" data-order-item=/);
  assert.match(lessonPage, /function placeOrderToken/);
  assert.match(lessonPage, /function removeOrderToken/);
  assert.match(lessonPage, /addEventListener\('drop'/);
  assert.match(lessonPage, /Bấm chữ trong ô để lấy ra/);
  assert.doesNotMatch(lessonPage, /setTimeout\(\(\) => resetOrderCard/);
});

test('written_response hides answer hints, saves drafts, and uses manual navigation', () => {
  assert.match(lessonPage, /writtenDrafts/);
  assert.match(lessonPage, /function collectWrittenAnswers/);
  assert.match(lessonPage, /data-activity-prev/);
  assert.match(lessonPage, /data-activity-next/);
  assert.match(lessonPage, /Quay lại/);
  assert.match(lessonPage, /Tiếp theo/);
  assert.doesNotMatch(lessonPage, /data-written-model/);
  assert.doesNotMatch(lessonPage, /Gợi ý đáp án/);
  assert.doesNotMatch(lessonPage, /question\.hint_vi/);
  assert.doesNotMatch(lessonPage, /setTimeout\(\(\) => renderActivity/);
});

test('render-once architecture: renderAllActivitiesOnce + showActivity', () => {
  assert.match(lessonPage, /function renderAllActivitiesOnce/);
  assert.match(lessonPage, /function showActivity/);
  assert.doesNotMatch(lessonPage, /function renderActivity\(/);
});

test('activity navigation preserves existing answers by hiding and showing shells only', () => {
  const showStart = lessonPage.indexOf('function showActivity');
  const navStart = lessonPage.indexOf('function renderActivityNav');
  assert.ok(showStart > -1, 'showActivity should exist');
  assert.ok(navStart > showStart, 'renderActivityNav should appear after showActivity');
  const showBody = lessonPage.slice(showStart, navStart);
  assert.match(showBody, /shell\.hidden = true/);
  assert.match(showBody, /shell\.hidden = false/);
  assert.doesNotMatch(showBody, /renderFillBlankActivity/);
  assert.doesNotMatch(showBody, /renderMcqActivity/);
  assert.doesNotMatch(showBody, /renderOrderActivity/);
  assert.doesNotMatch(showBody, /renderWrittenActivity/);
  assert.doesNotMatch(showBody, /renderSpeakActivity/);
});

test('attempt-based completion uses attempted set and per-item wrong counts', () => {
  assert.match(lessonPage, /const attempted = new Set/);
  assert.match(lessonPage, /const itemWrongCounts = new Map/);
  assert.match(lessonPage, /MAX_WRONG_PER_ITEM/);
  assert.match(lessonPage, /data-state='revealed'/);
});

test('speak re-rating allows changing self-rate selection', () => {
  assert.match(lessonPage, /const currentRating = new Map/);
  assert.doesNotMatch(lessonPage, /if \(rated\.has\(itemIndex\)\) return;/);
});

test('scoring formula uses soft penalty (wrong * 0.5)', () => {
  assert.match(lessonPage, /Math\.floor\(wrong \* 0\.5\)/);
  assert.match(submitModule, /Math\.floor\(wrong \* 0\.5\)/);
});

test('pass threshold is 50% and XP penalty is 0', () => {
  assert.match(stateModule, /PASS_THRESHOLD_PERCENT = 50/);
  assert.match(stateModule, /XP_PENALTY_BELOW_THRESHOLD = 0/);
});

test('student name is wired to IdentityBanner via id', () => {
  assert.match(lessonPage, /identity-student-name/);
  const banner = readFileSync('src/components/read2lead/v2/IdentityBanner.astro', 'utf-8');
  assert.match(banner, /id="identity-student-name"/);
});
