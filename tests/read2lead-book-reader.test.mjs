import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lesson = readFileSync('src/pages/read2lead/lesson.astro', 'utf8');

test('book page audio must end before story navigation unlocks practice', () => {
  assert.match(lesson, /state\.lesson\.book_page_audio\[pageIndex\]/);
  const playStart = lesson.indexOf('function bookPlayPageAudio');
  const playEnd = lesson.indexOf('function bookRenderQuestion', playStart);
  const body = lesson.slice(playStart, playEnd);
  const ended = body.indexOf("audio.addEventListener('ended'");
  const unlock = body.indexOf('audio_completed = true');
  assert.ok(ended > -1 && unlock > ended);
  assert.match(body, /state\.bookReader\.stage === 'story'/);
  assert.match(body, /bookSetStage\('story'\)/);
  assert.match(lesson, /function bookGoToNextStoryPage/);
  assert.match(lesson, /state\.bookReader\.story_completed = true/);
  assert.match(lesson, /bookPracticeStageForPage\(bookPageState\(0\)\)/);
  assert.match(body, /addEventListener\('error', fail/);
  assert.match(body, /addEventListener\('r2l-play-error', fail/);
  assert.doesNotMatch(
    body.slice(body.indexOf('function bookAudioFailure'), body.indexOf('function bookPlayPageAudio')),
    /audio_completed\s*=\s*true/,
  );
});

test('book reader persists flow version 2 and migrates only legacy completed audio', () => {
  assert.match(lesson, /flowVersion: 2/);
  assert.match(lesson, /story_completed: false/);
  assert.match(lesson, /book_reader: state\.bookReader/);
  assert.match(lesson, /Number\(book\.flowVersion\) === 2/);
  assert.match(lesson, /'story', 'listen', 'questions', 'shadow', 'next', 'summary'/);
  assert.match(lesson, /book\.stage === 'listen' \? 'story' : book\.stage/);
  assert.match(lesson, /story_completed: Boolean\(book\.story_completed\)/);
  assert.match(lesson, /const completedAudio = Array\.isArray\(book\.audioCompleted\)/);
  assert.match(lesson, /stage: completedAudio\.every\(Boolean\).*'questions' : 'story'/s);
  assert.match(lesson, /selected_questions: \[\]/);
  assert.match(lesson, /question_results: \[\]/);
  assert.match(lesson, /shadow_chunks: \[\]/);
});

test('book reader exposes semantic story, questions, shadow, and next stages', () => {
  for (const stage of ['story', 'questions', 'shadow', 'next']) {
    assert.match(lesson, new RegExp(`data-book-stage-container="${stage}"`));
  }
  assert.doesNotMatch(lesson, /data-book-stage-container="listen"/);
  assert.match(lesson, /stage: 'story'/);
  assert.match(lesson, /if \(!state\.bookReader\.story_completed\)/);
  assert.match(lesson, /bookSetStage\('questions'\)/);
  assert.match(lesson, /bookSetStage\('shadow'\)/);
  assert.match(lesson, /bookSetStage\('next'\)/);
  assert.match(
    lesson,
    /\.r2l-book-reader \[data-book-stage-container\]\.hidden\s*{[^}]*display: none;/s,
  );
  assert.match(lesson, /if \(!isBookLesson\(\)\) renderAllActivitiesOnce/);
  assert.match(lesson, /lesson-activity-progress-panel.*classList\.add\('hidden'\)/s);
  assert.match(lesson, /lesson-submit-panel.*classList\.add\('hidden'\)/s);
});

test('read-aloud-only StoryWeaver packs activate book reader mode', () => {
  assert.match(lesson, /const activities = lesson\?\.activities/);
  assert.match(lesson, /Array\.isArray\(activities\)/);
  assert.match(lesson, /activities\.some\(\(activity\) => activity\?\.type === 'read_aloud'\)/);
  assert.doesNotMatch(
    lesson,
    /listening_fill_blank,listen_and_order,read_aloud/,
  );
});

test('book questions are selected once, spoken, answered one at a time, and reveal immediately', () => {
  assert.match(lesson, /selectBookQuestions\(/);
  assert.match(lesson, /selected_questions: selectedQuestions/);
  assert.match(lesson, /const questionIndex = page\?\.question_results\.length/);
  assert.match(lesson, /_r2lSpeakEnglishLine\(question\.question_en\)/);
  assert.match(lesson, /Đáp án đúng là:/);
  assert.match(lesson, /page\.question_results\.push/);
});

test('shadow chunks play sentence audio in order before unlocking the shared recorder', () => {
  assert.match(lesson, /buildBookShadowChunks\(/);
  const start = lesson.indexOf('async function bookPlayShadowChunk');
  const end = lesson.indexOf('function bookChunkFromCard', start);
  const body = lesson.slice(start, end);
  assert.match(body, /for \(const sentenceIndex of chunk\.sentence_indexes\)/);
  assert.match(body, /await new Promise/);
  assert.match(body, /chunk\.playback_completed = true/);
  assert.match(body, /recordButton\.dataset\.heard = 'true'/);
  assert.match(lesson, /_r2lStartRecording\(itemKey, card\)/);
  assert.match(lesson, /bookHandleShadowScore\(cardEl, payload\)/);
});

test('pronunciation feedback stays visible and chunk advance is manual', () => {
  assert.match(lesson, /chunk\.attempts \+= 1/);
  assert.match(lesson, /score >= _R2L_SPEAKING_PASS_PERCENT/);
  assert.match(lesson, /chunk\.attempts >= 3/);
  assert.match(lesson, /chunk\.latest_feedback = payload/);
  assert.match(lesson, /data-book-shadow-continue/);
  assert.match(lesson, /continueButton\.classList\.remove\('hidden'\)/);
  assert.doesNotMatch(lesson, /setTimeout\(\(\) => bookCompleteShadowChunk/);
  assert.match(lesson, /bookCompleteShadowChunk\(chunk\.chunk_id\)/);
});

test('technical failures still use separate counters and explicit no-reward skip', () => {
  assert.match(lesson, /chunk\.technical_failures \+= 1/);
  assert.match(lesson, /chunk\.technical_failures >= 2/);
  assert.match(lesson, /technical_skip = true/);
  assert.match(lesson, /bookFinishReader\(\);/);
  assert.match(lesson, /Minny đang tự động lưu kết quả/);
});

test('book submission sends explicit v2 pages while legacy activity routing remains available', () => {
  assert.match(lesson, /book_flow_version: 2/);
  assert.match(lesson, /book_reader: bookSubmissionState\(\)/);
  assert.match(lesson, /page_index: page\.page_index/);
  assert.match(lesson, /question_results: page\.question_results/);
  assert.match(lesson, /sentence_indexes: chunk\.sentence_indexes/);
  assert.match(lesson, /status: chunk\.status/);
  assert.match(lesson, /function w1EnterActivitiesPhase/);
  assert.match(lesson, /function w1InitGuidedListeningPhase/);
});

test('book reader keeps complete mixed-aspect illustrations clear of its stable caption band', () => {
  assert.match(lesson, /class="r2l-book-page__art"/);
  assert.doesNotMatch(lesson, /id="book-reader-img"[^>]+width="1200"[^>]+height="800"/);
  assert.match(
    lesson,
    /\.r2l-book-page__art\s*{[^}]*height: clamp\(18rem, min\(52vw, 58vh\), 36rem\);[^}]*overflow: hidden;/s,
  );
  assert.match(
    lesson,
    /\.r2l-book-page img\s*{[^}]*position: absolute;[^}]*inset: 0;[^}]*width: 100%;[^}]*height: 100%;[^}]*object-fit: contain;/s,
  );
  const captionRule = lesson.match(/\.r2l-book-page__text\s*{([^}]*)}/)?.[1] || '';
  assert.match(captionRule, /height: clamp\(10rem, 18vw, 13rem\)/);
  assert.match(captionRule, /overflow-y: auto/);
  assert.doesNotMatch(captionRule, /position: absolute|max-height: 42%/);
});
