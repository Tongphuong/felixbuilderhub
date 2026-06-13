import { test } from 'node:test';
import assert from 'node:assert';
import { getAudioStats } from '../scripts/check-audio-budget.mjs';

test('audio kenney directory total size ≤ 200KB', () => {
  const stats = getAudioStats();
  assert.ok(
    !stats.overBudget,
    `Audio budget exceeded: ${stats.total} bytes (limit ${stats.budget}). Files: ${stats.entries.map(e => `${e.name}=${e.bytes}`).join(', ')}`,
  );
});

test('every audio file is non-empty', () => {
  const stats = getAudioStats();
  for (const e of stats.entries) {
    assert.ok(e.bytes > 0, `Empty audio file: ${e.name}`);
  }
});

test('expected audio files present (8 Kenney sounds from Z5)', () => {
  const stats = getAudioStats();
  const names = new Set(stats.entries.map(e => e.name));
  const expected = ['chest-shake.mp3', 'chest-crack.mp3', 'chest-burst.mp3', 'coin-clink.mp3', 'quest-complete.mp3', 'combo-tick.mp3', 'near-miss.mp3', 'daily-chest-claim.mp3'];
  for (const exp of expected) {
    assert.ok(names.has(exp), `Missing expected audio: ${exp}`);
  }
});
