import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  STREAK_FREEZE_MILESTONE_DAYS,
  STREAK_FREEZE_TOKEN_CAP,
  applyPackCompletion,
  computeStreakAdvance,
  daysUntilNextStreakFreezeMilestone,
  normalizeProgressState,
  publicProgressState,
} from '../functions/api/_read2lead-v2-state.js';

const reviewPage = readFileSync('src/pages/read2lead/review.astro', 'utf-8');

test('W7 constants match roadmap milestone and cap', () => {
  assert.equal(STREAK_FREEZE_MILESTONE_DAYS, 7);
  assert.equal(STREAK_FREEZE_TOKEN_CAP, 5);
});

test('computeStreakAdvance awards freeze token at 7-day milestone', () => {
  let state = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      streak_days: 6,
      last_activity_date_vn: '2026-06-06',
    },
    { accessCode: 'R2L-TEST-1234', nowIso: '2026-06-06T10:00:00.000Z' },
  );

  for (let day = 7; day <= 13; day += 1) {
    const dateKey = `2026-06-${String(day).padStart(2, '0')}`;
    const result = applyPackCompletion(state, {
      packId: `pack-${day}`,
      completedAt: `${dateKey}T02:00:00.000Z`,
      rewardsEarned: { coins: 20, xp: 20 },
    });
    state = result.state;
  }

  assert.equal(state.streak_days, 13);
  assert.equal(state.streak_freeze_tokens, 1);
  assert.equal(publicProgressState(state).streak_freeze_tokens, 1);
});

test('computeStreakAdvance consumes freeze when skipping one day', () => {
  const state = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      streak_days: 5,
      streak_freeze_tokens: 2,
      streak_freeze_milestones_granted: 0,
      last_activity_date_vn: '2026-06-01',
    },
    { accessCode: 'R2L-TEST-1234', nowIso: '2026-06-01T10:00:00.000Z' },
  );

  const advanced = computeStreakAdvance(state, '2026-06-03');
  assert.equal(advanced.streak_days, 6);
  assert.equal(advanced.streak_freeze_tokens, 1);
  assert.equal(advanced.streak_freeze_used, true);
});

test('computeStreakAdvance resets streak after multi-day gap without freeze', () => {
  const state = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      streak_days: 8,
      streak_freeze_tokens: 1,
      streak_freeze_milestones_granted: 1,
      last_activity_date_vn: '2026-06-01',
    },
    { accessCode: 'R2L-TEST-1234', nowIso: '2026-06-01T10:00:00.000Z' },
  );

  const advanced = computeStreakAdvance(state, '2026-06-05');
  assert.equal(advanced.streak_days, 1);
  assert.equal(advanced.streak_freeze_tokens, 1);
  assert.equal(advanced.streak_freeze_milestones_granted, 0);
});

test('daysUntilNextStreakFreezeMilestone counts down from partial streak', () => {
  assert.equal(daysUntilNextStreakFreezeMilestone(0, 0), 7);
  assert.equal(daysUntilNextStreakFreezeMilestone(5, 0), 2);
  assert.equal(daysUntilNextStreakFreezeMilestone(7, 0), 7);
  assert.equal(daysUntilNextStreakFreezeMilestone(3, 5), null);
});

test('student profile shows streak freeze copy for parents', () => {
  assert.match(reviewPage, /renderStreakFreezeNote/);
  assert.match(reviewPage, /giữ streak/);
  assert.match(reviewPage, /streak_freeze_tokens/);
});
