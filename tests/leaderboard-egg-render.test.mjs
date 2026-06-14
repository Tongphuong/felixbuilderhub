import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { onRequestGet as leaderboardGet } from '../functions/api/read2lead-leaderboard.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

const PAGE_SOURCE = readFileSync('src/pages/read2lead/leaderboard.astro', 'utf8');

test('leaderboard page checks avatar_stage before rendering a monster', () => {
  assert.match(PAGE_SOURCE, /leader\.avatar_stage === 'egg'/);
  assert.match(PAGE_SOURCE, /data-leader-egg/);
  assert.match(PAGE_SOURCE, /eggSvgMarkup\(\)/);
});

test('leaderboard egg rows do not receive the monster mount hook', () => {
  const eggBranch = PAGE_SOURCE.indexOf("leader.avatar_stage === 'egg'");
  const monsterBranch = PAGE_SOURCE.indexOf('leader.avatar?.monster', eggBranch);
  assert.ok(eggBranch >= 0);
  assert.ok(monsterBranch > eggBranch);
});

test('leaderboard API exposes normalized egg stage per row', async () => {
  const code = 'R2L-EGG-BOARD';
  const records = new Map([
    [code, {
      student_profile: { student_name: 'An' },
      progress: { completed_packs: 1 },
    }],
    [progressKey(code), {
      schema_version: 2,
      level_reset_version: 20260606,
      access_code: code,
      student_name: 'An',
      current_level: 'L3',
      rank_points: 0,
      completed_packs: 1,
    }],
  ]);
  const kv = {
    async list() {
      return { keys: [{ name: code }, { name: progressKey(code) }], cursor: undefined };
    },
    async get(key, options) {
      const value = records.get(key);
      if (!value) return null;
      return options?.type === 'json' ? value : JSON.stringify(value);
    },
    async put(key, value) {
      records.set(key, JSON.parse(value));
    },
  };

  const response = await leaderboardGet({
    request: new Request('https://example.com/api/read2lead-leaderboard'),
    env: { READ2LEAD_CODES: kv },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.leaders[0].avatar_stage, 'egg');
});

test('leaderboard API exposes basic stage after reaching Silver', async () => {
  const code = 'R2L-BASIC-BOARD';
  const records = new Map([
    [code, {
      student_profile: { student_name: 'Binh' },
      progress: { completed_packs: 1 },
    }],
    [progressKey(code), {
      schema_version: 2,
      level_reset_version: 20260606,
      access_code: code,
      student_name: 'Binh',
      current_level: 'L1',
      rank_points: 9,
      completed_packs: 1,
    }],
  ]);
  const kv = {
    async list() {
      return { keys: [{ name: code }, { name: progressKey(code) }], cursor: undefined };
    },
    async get(key, options) {
      const value = records.get(key);
      if (!value) return null;
      return options?.type === 'json' ? value : JSON.stringify(value);
    },
    async put(key, value) {
      records.set(key, JSON.parse(value));
    },
  };

  const response = await leaderboardGet({
    request: new Request('https://example.com/api/read2lead-leaderboard'),
    env: { READ2LEAD_CODES: kv },
  });
  const payload = await response.json();
  assert.equal(payload.leaders[0].avatar_stage, 'basic');
});
