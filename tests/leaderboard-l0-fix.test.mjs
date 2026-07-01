import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet as leaderboardGet } from '../functions/api/read2lead-leaderboard.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

/**
 * Regression tests for the L0 leaderboard fix (SPEC_LEADERBOARD_L0_FIX).
 *
 * The L0 commit changed START_LEVEL from 'L1' to 'L0', which shifted the
 * code path for students without a matching level_reset_version. Combined
 * with the lack of error isolation in computeLeaders(), a single student
 * whose stored data threw inside publicLeader() crashed the entire endpoint
 * with Cloudflare error 1101.
 *
 * These tests verify:
 * 1. A "poison" student (data that throws) is skipped, not fatal.
 * 2. config: keys (e.g. config:book_levels) are filtered out by the allowlist.
 * 3. L0 students render with "Mầm non" rank and seedling badge.
 * 4. Valid students still appear alongside a poison student.
 */

function makeKv(records) {
  return {
    async list() {
      return { keys: Array.from(records.keys()).map((name) => ({ name })), cursor: undefined };
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
}

test('leaderboard skips a poison student without crashing the endpoint', async () => {
  const goodCode = 'R2L-GOOD-L0';
  const poisonCode = 'R2L-POISON-XX';
  const records = new Map([
    [goodCode, {
      student_profile: { student_name: 'Minh' },
      progress: { completed_packs: 3 },
    }],
    [progressKey(goodCode), {
      schema_version: 2,
      level_reset_version: 20260606,
      access_code: goodCode,
      student_name: 'Minh',
      current_level: 'L0',
      completed_packs: 3,
      rank_points: 2,
    }],
    // Poison: a getter that throws when publicLeader accesses .progress.
    // This simulates a student whose stored data causes an exception deep
    // in the normalize/publicProgressState call chain.
    [poisonCode, {
      student_profile: { student_name: 'Poison' },
      get progress() { throw new Error('poison student data'); },
    }],
    [progressKey(poisonCode), null],
  ]);

  const kv = makeKv(records);
  const response = await leaderboardGet({
    request: new Request('https://example.com/api/read2lead-leaderboard?limit=50'),
    env: { READ2LEAD_CODES: kv },
  });
  const payload = await response.json();

  assert.equal(response.status, 200, 'endpoint must not crash');
  assert.equal(payload.ok, true);
  assert.ok(payload.leaders.length >= 1, 'at least the good student must appear');
  const goodLeader = payload.leaders.find((l) => l.display_name === 'Minh');
  assert.ok(goodLeader, 'valid student must still be in the leaderboard');
  const poisonLeader = payload.leaders.find((l) => l.masked_code?.includes('POISON'));
  assert.equal(poisonLeader, undefined, 'poison student must be skipped');
});

test('leaderboard filters out config: keys via the allowlist', async () => {
  const studentCode = 'R2L-CONFIG-FIX';
  const records = new Map([
    [studentCode, {
      student_profile: { student_name: 'Hoa' },
      progress: { completed_packs: 1 },
    }],
    [progressKey(studentCode), {
      schema_version: 2,
      level_reset_version: 20260606,
      access_code: studentCode,
      student_name: 'Hoa',
      current_level: 'L0',
      completed_packs: 1,
    }],
    // Non-student keys that must be filtered out by the allowlist.
    // NOTE: leaderboard-cache is intentionally omitted — if present with
    // a truthy leaders+updated_at shape, the endpoint returns the cached
    // payload instead of computing. We want to test the compute path.
    ['config:book_levels', ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']],
    ['config:other', { foo: 'bar' }],
    ['task:abc123', { status: 'pending' }],
    ['rl:1.2.3.4', { fails: 3 }],
    ['debug:something', { data: 'debug' }],
  ]);

  const kv = makeKv(records);
  const response = await leaderboardGet({
    request: new Request('https://example.com/api/read2lead-leaderboard?limit=50'),
    env: { READ2LEAD_CODES: kv },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  // Only the one valid student should appear
  assert.equal(payload.leaders.length, 1);
  assert.equal(payload.leaders[0].display_name, 'Hoa');
});

test('leaderboard renders L0 students with Mầm non rank and seedling badge', async () => {
  const code = 'R2L-L0-RANK';
  const records = new Map([
    [code, {
      student_profile: { student_name: 'Bé An' },
      progress: { completed_packs: 0 },
    }],
    [progressKey(code), {
      schema_version: 2,
      level_reset_version: 20260606,
      access_code: code,
      student_name: 'Bé An',
      current_level: 'L0',
      completed_packs: 0,
      rank_points: 0,
    }],
  ]);

  const kv = makeKv(records);
  const response = await leaderboardGet({
    request: new Request('https://example.com/api/read2lead-leaderboard?limit=50'),
    env: { READ2LEAD_CODES: kv },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.leaders.length, 1);
  const leader = payload.leaders[0];
  assert.equal(leader.current_level, 'L0');
  assert.equal(leader.rank, 'Mầm non');
  assert.equal(leader.rank_vi, 'Mầm non');
  assert.equal(leader.rank_asset_url, '/assets/r2l/ranks/rank-l0-seedling.svg');
});

test('leaderboard returns graceful error when computeLeaders throws entirely', async () => {
  // KV whose list() throws — simulates a total KV outage
  const kv = {
    async list() { throw new Error('KV unavailable'); },
    async get() { return null; },
    async put() {},
  };

  const response = await leaderboardGet({
    request: new Request('https://example.com/api/read2lead-leaderboard?limit=50'),
    env: { READ2LEAD_CODES: kv },
  });
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'leaderboard_compute_failed');
  assert.ok(payload.message.includes('bảng xếp hạng'));
});