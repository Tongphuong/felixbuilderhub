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

test('activity progress nav is a dynamic placeholder populated from lesson.activities', () => {
  // Nav itself is empty markup so lesson.astro can render N buttons matching
  // the actual lesson (V2.0 has 6 steps, V2.1 has 7 including speed_round).
  assert.match(activityProgress, /data-activity-progress-nav/);
  assert.match(lessonPage, /function populateActivityProgressNav/);
  // Labels are sourced from ACTIVITY_LABELS, which must cover both V2.0 + V2.1.
  for (const label of ['Nghe điền', 'Xếp câu', 'Đọc hiểu', 'Viết đáp án', 'Nói lại', 'Kể truyện']) {
    assert.match(lessonPage, new RegExp(label));
  }
  for (const v21 of ['Nghe & Khám phá', 'Sức mạnh từ vựng', 'Thợ xây câu', 'Thám tử truyện', 'Tai thần', 'Giọng ca vàng', 'Tổng công kích']) {
    assert.match(lessonPage, new RegExp(v21));
  }
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

test('retell listen plays story audio and unlocks record', () => {
  assert.match(lessonPage, /_r2lRetellState\.heardInstruction = true/);
  assert.match(lessonPage, /_r2lPlayRetellStoryAudio/);
  assert.doesNotMatch(lessonPage, /_r2lSpeakVietnameseLine\(prompt\.vi/);
});

test('global CTA advances through live activity list', () => {
  assert.match(lessonPage, /function updateGlobalCta/);
  assert.match(lessonPage, /id="lesson-continue"/);
  assert.match(lessonPage, /showActivity\(state\.activityIndex \+ 1\)/);
  assert.match(lessonPage, /function activityIndexByType/);
});

test('retell_summary shows story panel and fill-in template before recording', () => {
  assert.match(lessonPage, /function _r2lBuildRetellTemplate/);
  assert.match(lessonPage, /function _r2lResolveRetellTemplate/);
  assert.match(lessonPage, /function _r2lBuildRetellTemplateHtml/);
  assert.match(lessonPage, /function _r2lBuildRetellStoryHtml/);
  assert.match(lessonPage, /function _r2lPlayRetellStoryAudio/);
  assert.match(lessonPage, /data-retell-template/);
  assert.match(lessonPage, /data-retell-story/);
  assert.match(lessonPage, /Nghe truyện/);
  assert.match(readFileSync('functions/api/_read2lead-retell-guide.js', 'utf-8'), /buildRetellTemplate/);
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

test('lesson progress survives accidental page refresh via session storage', () => {
  assert.match(lessonPage, /function saveLessonSession/);
  assert.match(lessonPage, /function restoreLessonSession/);
  assert.match(lessonPage, /function clearLessonSession/);
  assert.match(lessonPage, /r2l_lesson_session:/);
  assert.match(lessonPage, /activityProgress/);
  assert.match(lessonPage, /scheduleSaveLessonSession/);
});

test('written_response hides answer hints, saves drafts, and uses global CTA navigation', () => {
  assert.match(lessonPage, /writtenDrafts/);
  assert.match(lessonPage, /function collectWrittenAnswers/);
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
