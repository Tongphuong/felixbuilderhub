import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { levelProgressPercent } from '../functions/api/generate-read2lead-pack.js';

const generateEndpoint = readFileSync('functions/api/generate-read2lead-pack.js', 'utf-8');

test('levelProgressPercent maps xp_in_level to 0-100 through the level', () => {
  // L1 requires 5 packs (20 XP each).
  assert.equal(levelProgressPercent({ xp_in_level: 0 }, 'L1'), 0);
  assert.equal(levelProgressPercent({ xp_in_level: 40 }, 'L1'), 40); // 2/5 packs
  assert.equal(levelProgressPercent({ xp_in_level: 80 }, 'L1'), 80);
  // L2 requires 15 packs.
  assert.equal(levelProgressPercent({ xp_in_level: 100 }, 'L2'), 33); // 5/15
  // Clamped, never above 100.
  assert.equal(levelProgressPercent({ xp_in_level: 9999 }, 'L1'), 100);
});

test('levelProgressPercent is null when not computable (backend defaults to mid)', () => {
  assert.equal(levelProgressPercent({ xp_in_level: 40 }, 'L5'), null); // no next level
  assert.equal(levelProgressPercent({}, 'L1'), null);
  assert.equal(levelProgressPercent(null, 'L2'), null);
  assert.equal(levelProgressPercent({ xp_in_level: -5 }, 'L1'), null);
});

test('generate endpoint sends level_progress_percent to the backend (in-level ramp)', () => {
  assert.match(generateEndpoint, /level_progress_percent/);
  assert.match(generateEndpoint, /levelProgressPercent\(progressState, levelForPack\)/);
});
