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

test('book questions advance only on correct answers and use a gentle retry state', () => {
  assert.match(lesson, /selectBookQuestions\(/);
  assert.match(lesson, /selected_questions: selectedQuestions/);
  assert.match(lesson, /const questionIndex = page\?\.question_results\.length/);
  assert.match(lesson, /_r2lSpeakEnglishLine\(question\.question_en\)/);
  const start = lesson.indexOf('function bookRenderQuestion');
  const end = lesson.indexOf('function bookCurrentChunk', start);
  const body = lesson.slice(start, end);
  assert.match(body, /if \(correct\) \{\s*page\.question_results\.push/s);
  assert.match(body, /dataState = 'retry'|dataset\.state = 'retry'/);
  assert.match(body, /book-reader-question-retry/);
  assert.match(body, /Gợi ý của Minny|Con nhìn lại đoạn truyện/);
  assert.doesNotMatch(body, /question\.hint_vi/);
  assert.doesNotMatch(body, /Đáp án đúng là:|["'`]Sai["'`]|màu đỏ/);
  assert.match(body, /1200/);
});

test('book questions reuse old reward and wrong-answer SFX hooks', () => {
  assert.match(lesson, /function onBookReaderCorrect/);
  assert.match(lesson, /function onBookReaderWrong/);
  const start = lesson.indexOf('function bookRenderQuestion');
  const end = lesson.indexOf('function bookCurrentChunk', start);
  const body = lesson.slice(start, end);
  assert.match(body, /const questionId = `book:\$\{state\.lesson\?\.book_slug \|\| 'book'\}:\$\{question\.id\}`/);
  assert.match(body, /clearWrongStreak\(questionId\)/);
  assert.match(body, /onBookReaderCorrect\(\)/);
  assert.match(body, /onBookReaderWrong\(questionId\)/);
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

test('shadow reading pass and pronunciation fail reuse old celebration and wrong SFX hooks', () => {
  const start = lesson.indexOf('function bookHandleShadowScore');
  const end = lesson.indexOf('function bookHandleShadowTechnicalFailure', start);
  const body = lesson.slice(start, end);
  assert.match(body, /const questionId = `book-shadow:\$\{chunk\.chunk_id\}`/);
  assert.match(body, /clearWrongStreak\(questionId\)/);
  assert.match(body, /onBookReaderCorrect\(\{ coinTone: true \}\)/);
  assert.match(body, /onBookReaderWrong\(questionId\)/);
  assert.match(body, /continueButton\.classList\.remove\('hidden'\)/);
});

test('technical failures still use separate counters and explicit no-reward skip', () => {
  assert.match(lesson, /chunk\.technical_failures \+= 1/);
  assert.match(lesson, /chunk\.technical_failures >= 2/);
  assert.match(lesson, /technical_skip = true/);
  assert.match(lesson, /bookFinishReader\(\);/);
  assert.match(lesson, /Minny đang tự động lưu kết quả/);
  const start = lesson.indexOf('function bookHandleShadowTechnicalFailure');
  const end = lesson.indexOf('function bookSkipCurrentChunkForTechnicalFailure', start);
  const body = lesson.slice(start, end);
  assert.doesNotMatch(body, /onBookReaderCorrect|onBookReaderWrong|showReward|playSfx/);
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

test('storybook layout renders karaoke sentences and all three helper controls', () => {
  assert.match(lesson, /id="book-reader-workspace" class="r2l-book-workspace"/);
  assert.match(lesson, /id="book-reader-karaoke-text"/);
  assert.match(lesson, /id="book-reader-translate"/);
  assert.match(lesson, /id="book-reader-vocab"/);
  assert.match(lesson, /id="book-reader-listen-again"/);
  assert.match(lesson, /function bookRenderStoryText/);
  assert.match(lesson, /sentence\.text_vi/);
  assert.match(lesson, /function bookPageVocabulary/);
  assert.match(lesson, /bookPlayPageAudio\(\{ restart: true, slow: _bookListenAgainSlow \}\)/);
  assert.match(lesson, /playbackRate = slow \? 0\.82 : 1/);
});

test('audio event exposes idle playing paused and done states with karaoke timing', () => {
  for (const state of ['idle', 'playing', 'paused', 'done']) {
    assert.match(lesson, new RegExp(`bookSetAudioUiState\\('${state}'\\)`));
  }
  assert.match(lesson, /currentAudio\.pause\(\)/);
  assert.match(lesson, /currentAudio\.play\(\)/);
  assert.match(lesson, /addEventListener\('timeupdate', syncProgress\)/);
  assert.match(lesson, /bookSyncAudioProgress\(audio, pageIndex\)/);
  assert.match(lesson, /bookSetActiveSentence/);
  assert.match(lesson, /r2l-book-audio__wave/);
  assert.match(lesson, /prefers-reduced-motion: reduce/);
});

test('progress trail uses full page completion during practice and remains data driven', () => {
  const start = lesson.indexOf('function bookPageIsComplete');
  const end = lesson.indexOf('function bookFormatTime', start);
  const completion = lesson.slice(start, end);
  assert.match(completion, /page\?\.audio_completed/);
  assert.match(completion, /question_results/);
  assert.match(completion, /shadow_chunks/);
  assert.match(completion, /status === 'passed' \|\| chunk\.status === 'skipped'/);
  const trailStart = lesson.indexOf('function bookRenderTrail');
  const trailEnd = lesson.indexOf('function bookSetStage', trailStart);
  const trail = lesson.slice(trailStart, trailEnd);
  assert.match(trail, /state\.lesson\.book_images\.length/);
  assert.match(trail, /practiceStarted \? bookPageIsComplete\(pageState\) : pageState\.audio_completed === true/);
  assert.match(trail, /bookPageLabel\(i\)/);
  assert.match(trail, /Phần thưởng/);
  assert.match(trail, /svg.*viewBox.*rect.*path/s);
  assert.match(trail, /r2l-book-trail__sub/);
  assert.match(trail, /HOÀN THÀNH/);
});

test('shadow redesign wraps but does not replace protected recorder and scoring hooks', () => {
  assert.match(lesson, /class="r2l-book-shadow-card"/);
  assert.match(lesson, /data-speak-record="0"/);
  assert.match(lesson, /data-rec-meter/);
  assert.match(lesson, /function bookObserveRecordMeter/);
  assert.match(lesson, /MutationObserver/);
  assert.match(lesson, /bookSyncShadowVisualState\(cardEl, status, entry\?\.checkStatus/);
  assert.match(lesson, /_r2lStartRecording\(itemKey, card\)/);
  assert.match(lesson, /_r2lStopRecording\(itemKey, card\)/);
  assert.match(lesson, /score >= _R2L_SPEAKING_PASS_PERCENT/);
  assert.match(lesson, /Đọc rất rõ! Con đạt/);
  assert.match(lesson, /Đọc chậm hơn nhé con\. Minny đợi\./);
});

test('page reward, page turn, keyboard controls, and reduced motion are present', () => {
  assert.match(lesson, /id="book-reader-next-stage" class="r2l-book-reward/);
  assert.match(lesson, /Con được 1 ngôi sao!/);
  assert.match(lesson, /function bookAnimatePageTurn/);
  assert.match(lesson, /is-turning/);
  assert.match(lesson, /rotateY\(-32deg\)/);
  assert.match(lesson, /function bookHandleKeyboard/);
  assert.match(lesson, /key === ' '/);
  assert.match(lesson, /key === 'r'/);
  assert.match(lesson, /\^\[1-4\]\$/);
  assert.match(lesson, /key === 'enter'/);
  assert.match(lesson, /key === 'm'/);
  assert.match(lesson, /@media \(prefers-reduced-motion: reduce\)/);
});

test('responsive rules match phone tablet and laptop reader compositions', () => {
  const redesign = lesson.slice(lesson.indexOf('/* ===== Book Reader redesign'));
  assert.match(redesign, /@media \(max-width: 639px\)/);
  assert.match(redesign, /height: clamp\(14rem, 38vh, 19rem\)/);
  assert.match(redesign, /env\(safe-area-inset-bottom\)/);
  assert.match(redesign, /font-size: 1\.125rem/);
  assert.match(redesign, /@media \(min-width: 960px\)/);
  assert.match(redesign, /grid-template-columns: minmax\(0, 1\.12fr\) minmax\(21rem, 0\.88fr\)/);
  assert.match(redesign, /@media \(min-width: 1360px\), \(min-width: 1280px\) and \(max-height: 850px\)/);
  assert.match(redesign, /grid-template-columns: 220px minmax\(0, 1fr\)/);
  assert.match(redesign, /min-height: 44px/);
});

test('book reader keeps complete mixed-aspect illustrations clear of its caption band', () => {
  assert.match(lesson, /class="r2l-book-page__art"/);
  assert.doesNotMatch(lesson, /id="book-reader-img"[^>]+width="1200"[^>]+height="800"/);
  const redesign = lesson.slice(lesson.indexOf('/* ===== Book Reader redesign'));
  assert.match(redesign, /\.r2l-book-page__art\s*{[^}]*height: clamp\(18rem, 54vw, 34rem\)/s);
  assert.match(
    lesson,
    /\.r2l-book-page img\s*{[^}]*position: absolute;[^}]*inset: 0;[^}]*width: 100%;[^}]*height: 100%;[^}]*object-fit: contain;/s,
  );
  const captionRule = redesign.match(/\.r2l-book-page__text\s*{([^}]*)}/)?.[1] || '';
  assert.match(captionRule, /height: auto/);
  assert.match(captionRule, /overflow-y: auto/);
  assert.doesNotMatch(captionRule, /position: absolute|max-height: 42%/);
});
