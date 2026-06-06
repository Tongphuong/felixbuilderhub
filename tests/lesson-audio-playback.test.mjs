import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');

test('lesson content audio uses one shared playback state', () => {
  assert.match(lessonPage, /const lessonAudioState = \{/);
  assert.match(lessonPage, /function stopLessonAudio/);
  assert.match(lessonPage, /function resetAudioButton/);
  assert.match(lessonPage, /function markAudioButtonPlaying/);
});

test('same audio button toggles playback off instead of stacking audio', () => {
  assert.match(
    lessonPage,
    /lessonAudioState\.audio && lessonAudioState\.url === url && !lessonAudioState\.audio\.paused/,
  );
  assert.match(lessonPage, /stopLessonAudio\(\);\s*return;/);
});

test('new lesson audio stops the previous lesson audio before playing', () => {
  const playAudioStart = lessonPage.indexOf('function playAudio');
  const playAudioSource = lessonPage.slice(playAudioStart, playAudioStart + 900);

  assert.ok(playAudioStart > -1, 'playAudio should exist');
  assert.match(playAudioSource, /stopLessonAudio\(\);/);
  assert.match(playAudioSource, /new Audio\(url\)/);
});

test('story and sentence play buttons pass their button to playAudio', () => {
  assert.match(lessonPage, /playAudio\(fullAudio, playStoryButton\)/);
  assert.match(lessonPage, /playAudio\(sentence\?\.audio_url \|\| '', button\)/);
  assert.match(lessonPage, /playAudio\(activity\.items\[Number\(button\.dataset\.playOrder\)\]\?\.audio_url \|\| '', button\)/);
  assert.match(lessonPage, /playAudio\(activity\.items\[Number\(button\.dataset\.playSpeak\)\]\?\.audio_url \|\| '', button\)/);
});

test('activity navigation stops active lesson audio', () => {
  assert.match(lessonPage, /if \(nextIndex !== state\.activityIndex\) stopLessonAudio\(\);/);
});

