import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const rewardBurst = readFileSync('src/components/read2lead/v2/RewardBurst.astro', 'utf-8');

test('all SFX files exist in public/sfx/r2l/', () => {
  const expected = [
    'success-1.mp3', 'success-2.mp3', 'success-3.mp3',
    'soft-boop.mp3', 'page-complete.mp3', 'final-reward.mp3',
    'voice-colen.mp3', 'voice-gioiqua.mp3', 'voice-tienbo.mp3',
    'voice-tuyetvoi.mp3', 'voice-xuatsac.mp3',
  ];
  for (const name of expected) {
    assert.ok(
      existsSync(`public/sfx/r2l/${name}`),
      `missing SFX file: ${name}`,
    );
  }
});

test('lesson page registers SFX library + helpers', () => {
  assert.match(lessonPage, /const SFX = \{/);
  assert.match(lessonPage, /function playSfx\(/);
  assert.match(lessonPage, /VOICE_POOL/);
});

test('lesson page wires SFX to all 4 reward tiers', () => {
  for (const key of ['correctCommon', 'correctRare', 'correctLegendary', 'wrong']) {
    assert.match(lessonPage, new RegExp(`SFX\\.${key}`));
  }
});

test('lesson page wires pack-complete sequence', () => {
  assert.match(lessonPage, /playSfxSequence\(\[SFX\.packComplete/);
});

test('lesson page plays Felix voice on correct reward', () => {
  assert.match(lessonPage, /function playCorrectVoice/);
  assert.match(lessonPage, /showReward\(\{ withVoice: true \}\)/);
});

test('lesson page uses celebrate mode for activity and pack completion', () => {
  assert.match(lessonPage, /showReward\(\{ mode: 'celebrate', withVoice: true \}\)/);
});

test('lesson page wires level-up SFX', () => {
  assert.match(lessonPage, /SFX\.levelUp/);
});

test('lesson page persists mute state to localStorage', () => {
  assert.match(lessonPage, /localStorage\.(getItem|setItem)\(['"]r2l_sfx_muted['"]/);
});

test('lesson page handles autoplay block gracefully', () => {
  assert.match(lessonPage, /preloadSfxOnce/);
  assert.match(lessonPage, /once: true/);
});

test('mute toggle button present in markup', () => {
  assert.match(lessonPage, /id="sfx-toggle"/);
});

test('reward burst includes confetti and firework layers', () => {
  assert.match(rewardBurst, /reward-confetti-layer/);
  assert.match(rewardBurst, /r2l-confetti/);
  assert.match(rewardBurst, /r2l-firework/);
});

test('lesson submit sends score percent and wrong attempts affect score', () => {
  assert.match(lessonPage, /function calculateLessonScore/);
  assert.match(lessonPage, /wrong_count/);
  assert.match(lessonPage, /score_percent: calculateLessonScore\(\)\.score_percent/);
});
