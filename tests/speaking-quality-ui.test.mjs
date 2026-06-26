import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf8');
const parentScript = readFileSync('src/pages/ho-so/ho-so.ts', 'utf8') + '\n' + readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf8');
const feedbackVisual = readFileSync('src/scripts/r2l-feedback-visual.js', 'utf8');
const replayControl = readFileSync('src/scripts/r2l-replay-control.js', 'utf8');
const creditsPage = readFileSync('src/pages/credits.astro', 'utf8');

test('waveform helper lazy-loads wavesurfer from CDN with vite-ignore', () => {
  assert.match(feedbackVisual, /wavesurfer\.js@7/);
  assert.match(feedbackVisual, /@vite-ignore/);
  assert.match(feedbackVisual, /mountDualWaveform/);
});

test('replay helper uses lazy howler import and preserves pitch flags', () => {
  assert.match(replayControl, /import\('howler'\)/);
  assert.match(replayControl, /preservesPitch/);
  assert.match(replayControl, /data-r2l-replay-rate/);
});

test('lesson mounts dual waveform and sends learning metric payload', () => {
  assert.match(lessonPage, /data-speak-waveform/);
  assert.match(lessonPage, /mountDualWaveform/);
  assert.match(lessonPage, /learning_metrics: _r2lLearningMetricPayload\(\)/);
  assert.match(lessonPage, /prefers-reduced-motion: reduce/);
});

test('parent dashboard includes learning quality section', () => {
  assert.match(parentScript, /data-learning-quality/);
  assert.match(parentScript, /dễ mất tập trung/);
  assert.match(parentScript, /parent-quality-bars/);
});

test('credits page includes required wavesurfer BSD-3 attribution', () => {
  assert.match(creditsPage, /wavesurfer\.js/);
  assert.match(creditsPage, /BSD-3-Clause/);
});
