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
  assert.match(
    lessonPage,
    /playAudio\(state\.lesson\?\.story\?\.full_audio_url \|\| '', playStoryButton\)/,
  );
  assert.match(lessonPage, /playAudio\(url, button\)/);
  assert.match(lessonPage, /setLessonPlayButtonState\(button, url\)/);
});

test('lesson audio playback rejects reward sfx urls', () => {
  assert.match(lessonPage, /function isRewardSfxUrl/);
  assert.match(lessonPage, /normalized\.includes\('\/sfx\/'\)/);
  assert.match(lessonPage, /refused reward\/SFX URL for lesson playback/);

  const playAudioStart = lessonPage.indexOf('function playAudio');
  const playAudioSource = lessonPage.slice(playAudioStart, playAudioStart + 1200);

  assert.match(playAudioSource, /if \(!url\) \{/);
  assert.match(playAudioSource, /not playing reward voice/);
  assert.doesNotMatch(playAudioSource, /showReward/);
  assert.doesNotMatch(playAudioSource, /playCorrectVoice/);
  assert.doesNotMatch(playAudioSource, /pickVoiceClip/);
  assert.doesNotMatch(playAudioSource, /playSfx/);
});

test('lesson nghe cau buttons never call reward voice helpers', () => {
  for (const marker of ['data-play-fill', 'data-play-order', 'data-play-speak', 'data-sentence-index']) {
    const markerIndex = lessonPage.indexOf(`[${marker}]`);
    assert.ok(markerIndex > -1, `${marker} play buttons should exist`);
    const snippet = lessonPage.slice(markerIndex, markerIndex + 500);
    assert.match(snippet, /playAudio\(url, button\)/);
    assert.doesNotMatch(snippet, /playSfx\(/);
    assert.doesNotMatch(snippet, /playCorrectVoice\(/);
    assert.doesNotMatch(snippet, /pickVoiceClip\(/);
    assert.doesNotMatch(snippet, /showReward\(/);
  }
});

test('activity navigation stops active lesson audio', () => {
  assert.match(lessonPage, /if \(nextIndex !== state\.activityIndex\) stopLessonAudio\(\);/);
});

