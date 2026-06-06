import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequestGet as leaderboardGet } from '../functions/api/read2lead-leaderboard.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('rank SVG assets exist for all five levels', () => {
  for (const file of [
    'rank-l1-bronze.svg',
    'rank-l2-silver.svg',
    'rank-l3-gold.svg',
    'rank-l4-diamond.svg',
    'rank-l5-legend.svg',
  ]) {
    assert.equal(existsSync(join(ROOT, 'public/assets/r2l/ranks', file)), true, file);
  }
});

test('leaderboard ranks by XP and never exposes stars', async () => {
  const records = new Map([
    [
      'R2L-LOW',
      {
        student_profile: { student_name: 'An' },
        progress: { completed_packs: 1, last_activity_at: '2026-06-05T01:00:00.000Z' },
      },
    ],
    [
      'R2L-HIGH',
      {
        student_profile: { student_name: 'Bin' },
        progress: { completed_packs: 5, last_activity_at: '2026-06-05T02:00:00.000Z' },
      },
    ],
    [
      'progress:R2L-HIGH',
      {
        schema_version: 2,
        level_reset_version: 20260606,
        access_code: 'R2L-HIGH',
        student_name: 'Bin',
        current_level: 'L2',
        initial_level: 'L1',
        unlocked_levels: ['L1', 'L2'],
        coins: 120,
        total_xp: 100,
        xp_in_level: 0,
        completed_packs: 5,
        level_progress: { L1: 5, L2: 0, L3: 0, L4: 0, L5: 0 },
        streak_days: 2,
      },
    ],
  ]);
  const kv = {
    async list() {
      return {
        keys: Array.from(records.keys()).map((name) => ({ name })),
        cursor: undefined,
      };
    },
    async get(key) {
      return records.get(key) || null;
    },
  };

  const response = await leaderboardGet({
    request: new Request('https://felixbuilderhub.com/api/read2lead-leaderboard'),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.leaders[0].display_name, 'Bin');
  assert.equal(body.leaders[0].rank, 'Bạc');
  assert.equal(body.leaders[0].rank_asset_url, '/assets/r2l/ranks/rank-l2-silver.svg');
  assert.equal('stars' in body.leaders[0], false);
});

test('legacy star helper names are absent from Read2Lead public APIs', () => {
  for (const file of [
    'functions/api/generate-read2lead-pack.js',
    'functions/api/read2lead-progress.js',
    'functions/api/submit-read2lead-lesson.js',
    'functions/api/read2lead-leaderboard.js',
  ]) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.equal(/rankForStars|badgesForStars|\bstars\b/.test(source), false, file);
  }
});

test('rank image slot is present in the shared Read2Lead header', () => {
  const source = readFileSync(join(ROOT, 'src/components/Header.astro'), 'utf8');
  assert.match(source, /data-r2l-rank-image/);
});
