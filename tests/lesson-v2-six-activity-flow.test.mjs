import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const activityProgress = readFileSync('src/components/read2lead/v2/ActivityProgress.astro', 'utf-8');
const listenAndSpeak = readFileSync('src/components/read2lead/v2/ListenAndSpeak.astro', 'utf-8');
const stateModule = readFileSync('functions/api/_read2lead-v2-state.js', 'utf-8');
const submitModule = readFileSync('functions/api/submit-read2lead-lesson.js', 'utf-8');

test('lesson page keeps legacy A/B/C/E and book A/B/D orders separate', () => {
  assert.match(lessonPage, /function ensureLessonActivities/);
  assert.match(lessonPage, /const FRONTEND_ACTIVITY_ORDER/);
  assert.match(lessonPage, /const BOOK_ACTIVITY_ORDER/);
  assert.match(lessonPage, /const activityOrder = isBookLesson\(lesson\)/);
  assert.match(lessonPage, /read_aloud/);
  assert.doesNotMatch(lessonPage, /written_response/);
});

test('lesson page supports the four-activity V2 flow', () => {
  for (const type of [
    'listening_fill_blank',
    'listen_and_order',
    'reading_comprehension',
    'listen_and_speak',
  ]) {
    assert.match(lessonPage, new RegExp(type));
  }
  assert.match(lessonPage, /function renderFillBlankActivity/);
  assert.doesNotMatch(lessonPage, /function renderWrittenActivity/);
  assert.doesNotMatch(lessonPage, /function renderReadAloudActivity/);
  assert.doesNotMatch(lessonPage, /speaking-check-section/);
  assert.doesNotMatch(lessonPage, /Câu hỏi mở bonus/);
});

test('activity progress shows exactly four steps in the active order', () => {
  const labels = [
    '1. Nghe điền',
    '2. Xếp câu',
    '3. Đọc hiểu',
    '4. Nói lại',
  ];
  for (const label of labels) {
    assert.match(activityProgress, new RegExp(label));
  }
  assert.equal((activityProgress.match(/data-step-button=/g) || []).length, 4);
});

test('listen_and_speak uses Minny hero and nghe-before-speak gating', () => {
  assert.match(listenAndSpeak, /data-minny-hero="listen_and_speak"/);
  assert.match(listenAndSpeak, /data-minny-video/);
  assert.match(listenAndSpeak, /data-minny-fallback/);
  assert.match(lessonPage, /Bước 1: Bấm Nghe\. Bước 2: Bấm Con nói/);
  assert.match(lessonPage, /🔊 Nghe/);
  assert.match(lessonPage, /🎤 Con nói/);
  assert.match(lessonPage, /data-speak-record/);
  assert.match(lessonPage, /recordBtn\.dataset\.heard = 'true'/);
  assert.match(lessonPage, /_r2lSetMinnyMood/);
  assert.match(lessonPage, /tryPlay\('mp4'\)/);
});

test('book read-aloud shell is present while written response stays retired', () => {
  assert.match(lessonPage, /import ReadAloud/);
  assert.match(lessonPage, /<ReadAloud \/>/);
  assert.doesNotMatch(lessonPage, /data-activity-shell="written_response"/);
  assert.doesNotMatch(lessonPage, /renderWrittenActivity/);
});

test('global CTA advances through live activity list', () => {
  assert.match(lessonPage, /function updateGlobalCta/);
  assert.match(lessonPage, /id="lesson-continue"/);
  assert.match(lessonPage, /showActivity\(state\.activityIndex \+ 1\)/);
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

test('listen_and_order is audio-first with replay, persistence, and missing-audio fallback', () => {
  const listenAndOrder = readFileSync('src/components/read2lead/v2/ListenAndOrder.astro', 'utf-8');
  assert.match(listenAndOrder, /Bước 1: Nghe câu\. Bước 2: Xếp từ/);
  assert.match(listenAndOrder, /data-dictation-live/);
  assert.match(lessonPage, /data-dictation-locked="true"/);
  assert.match(lessonPage, /const heard = new Set/);
  assert.match(lessonPage, /heard: Array\.from\(heard\)/);
  assert.match(lessonPage, /normalizeDictationHeard\(savedOrder\.heard/);
  assert.match(lessonPage, /button\.dataset\.audioDefaultLabel = 'Nghe lại'/);
  assert.match(lessonPage, /Câu này chưa có audio\. Con vẫn có thể xếp từ nhé\./);
  assert.match(lessonPage, /canUseDictationItem/);
});

test('listen_and_order accepts duplicate tokens by sentence text, not strict index match', () => {
  assert.match(lessonPage, /function isOrderAnswerCorrect/);
  assert.match(lessonPage, /normalizeOrderSentence\(reconstructed\) === normalizeOrderSentence\(item\.original_sentence/);
  assert.doesNotMatch(lessonPage, /correct_order_indices\.every\(\(idx, i\) => idx === st\[i\]\)/);
});

test('lesson progress survives refresh and tab closure via durable local storage', () => {
  assert.match(lessonPage, /function saveLessonSession/);
  assert.match(lessonPage, /function restoreLessonSession/);
  assert.match(lessonPage, /function clearLessonSession/);
  assert.match(lessonPage, /r2l_lesson_session:/);
  assert.match(lessonPage, /activityProgress/);
  assert.match(lessonPage, /scheduleSaveLessonSession/);
  assert.match(lessonPage, /localStorage\.setItem\(key, serialized\)/);
  assert.match(lessonPage, /const durable = parseLessonSession\(durableRaw\)/);
  assert.match(lessonPage, /localStorage\.removeItem\(key\)/);
  assert.match(lessonPage, /sessionStorage\.removeItem\(key\)/);
});

test('retired written response state is removed while global CTA navigation remains', () => {
  assert.doesNotMatch(lessonPage, /writtenDrafts/);
  assert.doesNotMatch(lessonPage, /function collectWrittenAnswers/);
  assert.match(lessonPage, /id="lesson-continue"/);
  assert.match(lessonPage, /function updateGlobalCta/);
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
  const ctaStart = lessonPage.indexOf('function updateGlobalCta');
  assert.ok(showStart > -1, 'showActivity should exist');
  assert.ok(ctaStart > showStart, 'updateGlobalCta should appear after showActivity');
  const showBody = lessonPage.slice(showStart, ctaStart);
  assert.match(showBody, /shell\.hidden = true/);
  assert.match(showBody, /shell\.hidden = false/);
  assert.doesNotMatch(showBody, /renderFillBlankActivity/);
  assert.doesNotMatch(showBody, /renderMcqActivity/);
  assert.doesNotMatch(showBody, /renderOrderActivity/);
  assert.doesNotMatch(showBody, /renderWrittenActivity/);
  assert.doesNotMatch(showBody, /renderSpeakActivity/);
  assert.doesNotMatch(showBody, /renderReadAloudActivity/);
});

test('attempt-based completion uses attempted set and per-item wrong counts', () => {
  assert.match(lessonPage, /const attempted = new Set/);
  assert.match(lessonPage, /const itemWrongCounts = new Map/);
  assert.match(lessonPage, /MAX_WRONG_PER_ITEM/);
  assert.match(lessonPage, /data-state='revealed'/);
});

test('listen_and_speak completes via Whisper scoring, not self-rate', () => {
  assert.match(lessonPage, /_r2lMergeSpeakActivityScores/);
  assert.doesNotMatch(lessonPage, /data-rate-speak/);
  assert.doesNotMatch(lessonPage, /self_rate: true/);
});

test('scoring formula uses soft penalty (wrong * 0.5)', () => {
  assert.match(lessonPage, /Math\.floor\(wrong \* 0\.5\)/);
  assert.match(submitModule, /Math\.floor\(wrong \* 0\.5\)/);
  assert.match(submitModule, /completedTypes\.size >= ACTIVE_LESSON_ACTIVITY_TYPES\.size/);
});

test('pass threshold is 50% and XP penalty is 0', () => {
  assert.match(stateModule, /PASS_THRESHOLD_PERCENT = 50/);
  assert.match(stateModule, /XP_PENALTY_BELOW_THRESHOLD = 0/);
  assert.match(
    submitModule,
    /const SPEAKING_ACTIVITY_TYPES = new Set\(\['listen_and_speak', 'read_aloud'\]\)/,
  );
});

test('student name is wired to IdentityBanner via id', () => {
  assert.match(lessonPage, /identity-student-name/);
  const banner = readFileSync('src/components/read2lead/v2/IdentityBanner.astro', 'utf-8');
  assert.match(banner, /id="identity-student-name"/);
});

test('flag-off path renders V2.1 maintenance screen for schema_version "2.1" packs', () => {
  assert.match(lessonPage, /V21MaintenanceScreen/);
  assert.match(lessonPage, /PUBLIC_R2L_V21/);
  assert.match(lessonPage, /'2\.1'/);
  assert.match(lessonPage, /v21-maintenance/);
});
