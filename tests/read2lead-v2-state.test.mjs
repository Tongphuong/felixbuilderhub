import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPackCompletion,
  nextStreakDays,
  normalizeProgressState,
  publicProgressState,
  vietnamDateKey,
} from '../functions/api/_read2lead-v2-state.js';

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

test('third pack in level triggers level-up and resets level XP', () => {
  let state = normalizeProgressState(null, {
    accessCode: 'R2L-TEST-1234',
    codeData: { student_profile: { student_name: 'Bin', level: 'L2' } },
    nowIso: '2026-06-05T01:00:00.000Z',
  });

  for (const packId of ['pack-1', 'pack-2']) {
    state = applyPackCompletion(state, {
      packId,
      completedAt: '2026-06-05T02:00:00.000Z',
      rewardsEarned: { coins: 20, xp: 20 },
    }).state;
  }
  const third = applyPackCompletion(state, {
    packId: 'pack-3',
    completedAt: '2026-06-06T02:00:00.000Z',
    rewardsEarned: { coins: 20, xp: 20 },
  });
  const publicState = publicProgressState(third.state);

  assert.equal(third.level_up.from_level, 'L1');
  assert.equal(third.level_up.to_level, 'L2');
  assert.equal(publicState.current_level, 'L2');
  assert.equal(publicState.xp_in_level, 0);
  assert.equal(publicState.packs_until_level_up, 3);
});
