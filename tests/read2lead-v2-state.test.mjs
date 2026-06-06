import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPackCompletion,
  applyPackPenalty,
  LEVELS,
  nextStreakDays,
  normalizeProgressState,
  publicProgressState,
  vietnamDateKey,
} from '../functions/api/_read2lead-v2-state.js';

test('V2 keeps 3 active generation levels', () => {
  assert.deepEqual(LEVELS, ['L1', 'L2', 'L3']);
});

test('Vietnam date key uses UTC+7 day boundary', () => {
  assert.equal(vietnamDateKey('2026-06-05T16:59:00.000Z'), '2026-06-05');
  assert.equal(vietnamDateKey('2026-06-05T17:01:00.000Z'), '2026-06-06');
});

test('streak increments, holds same day, and resets after a gap', () => {
  assert.equal(nextStreakDays('', '2026-06-05', 0), 1);
  assert.equal(nextStreakDays('2026-06-05', '2026-06-05', 1), 1);
  assert.equal(nextStreakDays('2026-06-05', '2026-06-06', 1), 2);
  assert.equal(nextStreakDays('2026-06-05', '2026-06-07', 4), 1);
});

test('pack completion increments coins and XP once', () => {
  const base = normalizeProgressState(null, {
    accessCode: 'R2L-TEST-1234',
    codeData: { student_profile: { student_name: 'Bin', level: 'L2' } },
    nowIso: '2026-06-05T01:00:00.000Z',
  });
  assert.equal(base.current_level, 'L1');

  const first = applyPackCompletion(base, {
    packId: 'pack-1',
    completedAt: '2026-06-05T02:00:00.000Z',
    rewardsEarned: { coins: 23, xp: 20 },
    activityResults: [{ type: 'listen_and_speak', attempted: true }],
  });
  const duplicate = applyPackCompletion(first.state, {
    packId: 'pack-1',
    completedAt: '2026-06-05T03:00:00.000Z',
    rewardsEarned: { coins: 23, xp: 20 },
  });

  assert.equal(first.state.coins, 23);
  assert.equal(first.state.total_xp, 20);
  assert.equal(first.state.completed_packs, 1);
  assert.equal(first.state.voice_attempts, 1);
  assert.equal(first.state.badges.find((badge) => badge.id === 'level_climber').unlocked, false);
  assert.equal(duplicate.already_counted, true);
  assert.equal(duplicate.state.coins, 23);
});

test('fifth L1 pack triggers level-up and resets level XP', () => {
  let state = normalizeProgressState(null, {
    accessCode: 'R2L-TEST-1234',
    codeData: { student_profile: { student_name: 'Bin', level: 'L2' } },
    nowIso: '2026-06-05T01:00:00.000Z',
  });

  for (const packId of ['pack-1', 'pack-2', 'pack-3', 'pack-4']) {
    state = applyPackCompletion(state, {
      packId,
      completedAt: '2026-06-05T02:00:00.000Z',
      rewardsEarned: { coins: 20, xp: 20 },
    }).state;
  }
  const fifth = applyPackCompletion(state, {
    packId: 'pack-5',
    completedAt: '2026-06-06T02:00:00.000Z',
    rewardsEarned: { coins: 20, xp: 20 },
  });
  const publicState = publicProgressState(fifth.state);

  assert.equal(fifth.level_up.from_level, 'L1');
  assert.equal(fifth.level_up.to_level, 'L2');
  assert.equal(publicState.current_level, 'L2');
  assert.equal(publicState.xp_in_level, 0);
  assert.equal(publicState.xp_to_next_level, 300);
  assert.equal(publicState.packs_until_level_up, 15);
});

test('L2 needs 15 passed packs to unlock L3', () => {
  let state = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      current_level: 'L2',
      initial_level: 'L1',
      unlocked_levels: ['L1', 'L2'],
      xp_in_level: 0,
      total_xp: 100,
      level_progress: { L1: 5, L2: 0, L3: 0 },
    },
    {
      accessCode: 'R2L-TEST-1234',
      codeData: { student_profile: { student_name: 'Bin', level: 'L2' } },
      nowIso: '2026-06-05T01:00:00.000Z',
    },
  );

  for (let i = 1; i <= 14; i += 1) {
    state = applyPackCompletion(state, {
      packId: `l2-pack-${i}`,
      completedAt: '2026-06-05T02:00:00.000Z',
      rewardsEarned: { coins: 20, xp: 20 },
    }).state;
  }
  assert.equal(publicProgressState(state).current_level, 'L2');
  assert.equal(publicProgressState(state).packs_until_level_up, 1);

  const fifteenth = applyPackCompletion(state, {
    packId: 'l2-pack-15',
    completedAt: '2026-06-06T02:00:00.000Z',
    rewardsEarned: { coins: 20, xp: 20 },
  });
  assert.equal(fifteenth.level_up.to_level, 'L3');
  assert.equal(publicProgressState(fifteenth.state).current_level, 'L3');
});

test('below-threshold attempt subtracts 10 XP once per pack', () => {
  const base = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      current_level: 'L1',
      xp_in_level: 40,
      total_xp: 40,
    },
    {
      accessCode: 'R2L-TEST-1234',
      codeData: { student_profile: { student_name: 'Bin' } },
      nowIso: '2026-06-05T01:00:00.000Z',
    },
  );

  const first = applyPackPenalty(base, {
    packId: 'pack-low-score',
    completedAt: '2026-06-05T02:00:00.000Z',
  });
  const duplicate = applyPackPenalty(first.state, {
    packId: 'pack-low-score',
    completedAt: '2026-06-05T03:00:00.000Z',
  });

  assert.equal(first.state.xp_in_level, 30);
  assert.equal(first.state.total_xp, 30);
  assert.equal(first.already_penalized, false);
  assert.equal(duplicate.state.xp_in_level, 30);
  assert.equal(duplicate.already_penalized, true);
});
