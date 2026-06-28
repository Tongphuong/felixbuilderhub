import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lesson = readFileSync('src/pages/read2lead/lesson.astro', 'utf8');
const progress = readFileSync('src/components/read2lead/v2/ActivityProgress.astro', 'utf8');
const readAloud = readFileSync('src/components/read2lead/v2/ReadAloud.astro', 'utf8');

test('book reader uses explicit page audio and unlocks only on ended', () => {
  assert.match(lesson, /state\.lesson\.book_page_audio\[pageIndex\]/);
  const playStart = lesson.indexOf('function bookPlayPageAudio');
  const playEnd = lesson.indexOf('function bookShowSentence', playStart);
  const body = lesson.slice(playStart, playEnd);
  const ended = body.indexOf("audio.addEventListener('ended'");
  const unlock = body.indexOf('completed[pageIndex] = true');
  assert.ok(ended > -1 && unlock > ended);
  assert.match(body, /addEventListener\('error', fail/);
  assert.match(body, /addEventListener\('r2l-play-error', fail/);
  assert.doesNotMatch(
    body.slice(body.indexOf('function bookAudioFailure'), body.indexOf('function bookPlayPageAudio')),
    /audioCompleted.*true/,
  );
});

test('book reader requires exactly two questions and persists full position state', () => {
  assert.match(lesson, /questions\.length !== 2/);
  assert.match(lesson, /book_reader: state\.bookReader/);
  assert.match(lesson, /pageIndex: Number\(book\.pageIndex\)/);
  assert.match(lesson, /sentenceIndex: Number\(book\.sentenceIndex\)/);
  assert.match(lesson, /audioCompleted: Array\.isArray/);
  assert.match(lesson, /pagesDone: Array\.isArray/);
  assert.match(lesson, /answers: book\.answers/);
});

test('book progress and activities are exactly A, B, D', () => {
  assert.match(progress, /data-activity-progress/);
  assert.match(lesson, /configureActivityProgress/);
  assert.match(lesson, /dots\.innerHTML = ''/);
  assert.match(lesson, /dot\.dataset\.dot = String\(index\)/);
  assert.match(
    lesson,
    /listening_fill_blank,listen_and_order,read_aloud/,
  );
  assert.match(readAloud, /data-activity-shell="read_aloud"/);
  assert.doesNotMatch(readAloud, /data-activity-shell="listen_and_speak"/);
});

test('read aloud reuses replay gate, whisper scoring, and type-derived mic skip', () => {
  assert.match(lesson, /recordBtn\.dataset\.heard = 'true'/);
  assert.match(lesson, /recordBtn\.disabled = !_r2lMicIsReady\(\)/);
  assert.match(lesson, /_R2L_SPEAKING_PASS_PERCENT = 50/);
  assert.match(lesson, /const activityType = activity\?\.type/);
  assert.match(lesson, /completeActivity\(activityType/);
  assert.match(lesson, /state\.activityResults\[activityType\]/);
});

test('book reader stores question outcomes and legacy routing remains separate', () => {
  assert.match(lesson, /state\.activityResults\.guided_listening/);
  assert.match(lesson, /question_outcomes: answers\.map/);
  assert.match(lesson, /if \(isBookLesson\(\)\)/);
  assert.match(lesson, /w1InitBookReaderPhase\(\)/);
  assert.match(lesson, /w1InitStoryPhase\(\)/);
  assert.match(lesson, /w1InitGuidedListeningPhase\(\)/);
});
