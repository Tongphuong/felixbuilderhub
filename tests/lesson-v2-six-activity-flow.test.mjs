import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const activityProgress = readFileSync('src/components/read2lead/v2/ActivityProgress.astro', 'utf-8');
const listenAndSpeak = readFileSync('src/components/read2lead/v2/ListenAndSpeak.astro', 'utf-8');
const retellSummary = readFileSync('src/components/read2lead/v2/RetellSummary.astro', 'utf-8');
const stateModule = readFileSync('functions/api/_read2lead-v2-state.js', 'utf-8');
const submitModule = readFileSync('functions/api/submit-read2lead-lesson.js', 'utf-8');
const speakingEndpoint = readFileSync('functions/api/read2lead-speaking-check.js', 'utf-8');

test('lesson page injects retell_summary when pack only has five backend activities', () => {
  assert.match(lessonPage, /function ensureLessonActivities/);
  assert.match(lessonPage, /retell_summary/);
  assert.match(readFileSync('functions/api/read2lead-lesson.js', 'utf-8'), /ensureSixActivities/);
});

test('lesson page supports the 6-activity V2 flow', () => {
  for (const type of [
    'listening_fill_blank',
    'listen_and_order',
    'reading_comprehension',
    'written_response',
    'listen_and_speak',
    'retell_summary',
  ]) {
    assert.match(lessonPage, new RegExp(type));
  }
  assert.match(lessonPage, /function renderFillBlankActivity/);
  assert.match(lessonPage, /function renderWrittenActivity/);
  assert.match(lessonPage, /function renderRetellSummaryActivity/);
  assert.doesNotMatch(lessonPage, /completedTypes\.size < 4/);
  assert.doesNotMatch(lessonPage, /speaking-check-section/);
  assert.doesNotMatch(lessonPage, /Câu hỏi mở bonus/);
});

test('activity progress shows exactly 6 steps in the new order', () => {
  const labels = [
    '1. Nghe điền',
    '2. Xếp câu',
    '3. Đọc hiểu',
    '4. Viết đáp án',
    '5. Nói lại',
    '6. Kể truyện',
  ];
  for (const label of labels) {
    assert.match(activityProgress, new RegExp(label));
  }
  assert.equal((activityProgress.match(/data-step-button=/g) || []).length, 6);
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

test('retell_summary activity uses open mode with 60s limit', () => {
  assert.match(retellSummary, /data-activity-shell="retell_summary"/);
  assert.match(lessonPage, /RETELL_MAX_SECONDS = 60/);
  assert.match(lessonPage, /check_mode: 'open'/);
  assert.match(lessonPage, /_r2lBuildOpenSpeakingFeedbackHtml/);
  assert.match(speakingEndpoint, /MAX_AUDIO_BYTES_LONG/);
  assert.match(speakingEndpoint, /max_seconds/);
});

test('retell listen unlocks record immediately like activity 5', () => {
  assert.match(lessonPage, /_r2lRetellState\.heardInstruction = true/);
  assert.match(lessonPage, /_r2lSpeakVietnameseLine\(prompt\.vi/);
  assert.doesNotMatch(lessonPage, /_r2lSpeakEnglishLine\(prompt\.en, \(\) => \{\s*_r2lRetellState\.heardInstruction = true/s);
});

test('activity nav resolves next/prev from live activity list', () => {
  assert.match(lessonPage, /function updateActivityNavButtons/);
  assert.match(lessonPage, /data-activity-nav="\$\{escapeHtml\(activityType\)\}"/);
  assert.match(lessonPage, /function activityIndexByType/);
});

test('retell_summary shows guided Vietnamese questions before recording', () => {
  assert.match(lessonPage, /function _r2lBuildRetellGuideQuestions/);
  assert.match(lessonPage, /function _r2lResolveRetellGuideQuestions/);
  assert.match(lessonPage, /function _r2lBuildRetellGuideHtml/);
  assert.match(lessonPage, /data-retell-guide/);
  assert.match(lessonPage, /r2l-retell-guide/);
  assert.match(lessonPage, /Con trả lời từng câu bằng tiếng Anh khi kể nhé/);
  assert.match(lessonPage, /Dùng câu gợi ý/);
  assert.match(readFileSync('functions/api/_read2lead-retell-guide.js', 'utf-8'), /buildRetellGuideQuestions/);
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

test('listen_and_order accepts duplicate tokens by sentence text, not strict index match', () => {
  assert.match(lessonPage, /function isOrderAnswerCorrect/);
  assert.match(lessonPage, /normalizeOrderSentence\(reconstructed\) === normalizeOrderSentence\(item\.original_sentence/);
  assert.doesNotMatch(lessonPage, /correct_order_indices\.every\(\(idx, i\) => idx === st\[i\]\)/);
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
  assert.doesNotMatch(showBody, /renderRetellSummaryActivity/);
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
  assert.match(submitModule, /completedTypes\.size >= 6/);
});

test('pass threshold is 50% and XP penalty is 0', () => {
  assert.match(stateModule, /PASS_THRESHOLD_PERCENT = 50/);
  assert.match(stateModule, /XP_PENALTY_BELOW_THRESHOLD = 0/);
  assert.match(stateModule, /retell_summary/);
});

test('student name is wired to IdentityBanner via id', () => {
  assert.match(lessonPage, /identity-student-name/);
  const banner = readFileSync('src/components/read2lead/v2/IdentityBanner.astro', 'utf-8');
  assert.match(banner, /id="identity-student-name"/);
});
