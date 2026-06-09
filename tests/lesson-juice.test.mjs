import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const juiceModule = readFileSync('src/lib/lesson-juice.ts', 'utf-8');

test('lesson juice wires synth tones and confetti helpers', () => {
  assert.match(juiceModule, /playSynthTone/);
  assert.match(juiceModule, /fireStreakConfetti/);
  assert.match(juiceModule, /fireLessonPassConfetti/);
  assert.match(juiceModule, /canvas-confetti/);
  assert.match(juiceModule, /prefers-reduced-motion/);
  assert.match(lessonPage, /window\.__r2lJuice/);
  assert.match(lessonPage, /fireStreakConfetti/);
  assert.match(lessonPage, /fireLessonPassConfetti/);
});

test('listen_and_order shows tap-first instruction on touch devices', () => {
  assert.match(lessonPage, /Bấm từng từ theo thứ tự/);
  assert.match(lessonPage, /ontouchstart/);
});

test('lesson updates Minny hero mood on item correct and wrong', () => {
  assert.match(lessonPage, /_r2lUpdateActiveHeroMood\('celebrate'\)/);
  assert.match(lessonPage, /_r2lUpdateActiveHeroMood\('encourage'\)/);
});
