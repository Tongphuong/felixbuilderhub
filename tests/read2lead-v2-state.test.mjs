import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPackCompletion,
  applyPackPenalty,
  buildAdminTestLevelState,
  computeRankLadder,
  LEVELS,
  nextStreakDays,
  normalizeProgressState,
  publicProgressState,
  rankPointsFromHistory,
  RANK_ASSETS,
  RANK_TITLES,
  vietnamDateKey,
} from '../functions/api/_read2lead-v2-state.js';

test('V2 keeps 5 active generation levels', () => {
  assert.deepEqual(LEVELS, ['L1', 'L2', 'L3', 'L4', 'L5']);
});

test('V2 rank titles and assets are game-style Vietnamese ladder', () => {
  assert.deepEqual(RANK_TITLES, {
    L1: 'Đồng',
    L2: 'Bạc',
    L3: 'Vàng',
    L4: 'Kim cương',
    L5: 'Huyền thoại',
  });
  assert.equal(RANK_ASSETS.L1, '/assets/r2l/ranks/rank-l1-bronze.svg');
  assert.equal(RANK_ASSETS.L5, '/assets/r2l/ranks/rank-l5-legend.svg');
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

test('L3 and L4 use the longer V2 level-up ladder', () => {
  let l3State = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      current_level: 'L3',
      initial_level: 'L1',
      unlocked_levels: ['L1', 'L2', 'L3'],
      xp_in_level: 0,
      total_xp: 400,
      level_progress: { L1: 5, L2: 15, L3: 0, L4: 0, L5: 0 },
    },
    {
      accessCode: 'R2L-TEST-1234',
      codeData: { student_profile: { student_name: 'Bin', level: 'L3' } },
      nowIso: '2026-06-05T01:00:00.000Z',
    },
  );
  for (let i = 1; i <= 24; i += 1) {
    l3State = applyPackCompletion(l3State, {
      packId: `l3-pack-${i}`,
      completedAt: '2026-06-05T02:00:00.000Z',
      rewardsEarned: { coins: 20, xp: 20 },
    }).state;
  }
  assert.equal(publicProgressState(l3State).current_level, 'L3');
  assert.equal(publicProgressState(l3State).packs_until_level_up, 1);

  const l4Unlock = applyPackCompletion(l3State, {
    packId: 'l3-pack-25',
    completedAt: '2026-06-06T02:00:00.000Z',
    rewardsEarned: { coins: 20, xp: 20 },
  });
  assert.equal(l4Unlock.level_up.to_level, 'L4');
  assert.equal(publicProgressState(l4Unlock.state).packs_until_level_up, 35);

  let l4State = l4Unlock.state;
  for (let i = 1; i <= 34; i += 1) {
    l4State = applyPackCompletion(l4State, {
      packId: `l4-pack-${i}`,
      completedAt: '2026-06-07T02:00:00.000Z',
      rewardsEarned: { coins: 20, xp: 20 },
    }).state;
  }
  const l5Unlock = applyPackCompletion(l4State, {
    packId: 'l4-pack-35',
    completedAt: '2026-06-08T02:00:00.000Z',
    rewardsEarned: { coins: 20, xp: 20 },
  });
  assert.equal(l5Unlock.level_up.to_level, 'L5');
  assert.equal(publicProgressState(l5Unlock.state).packs_until_level_up, 0);
});

test('below-threshold attempt records penalty but does not subtract XP (penalty = 0)', () => {
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

  assert.equal(first.state.xp_in_level, 40);
  assert.equal(first.state.total_xp, 40);
  assert.equal(first.already_penalized, false);
  assert.equal(duplicate.state.xp_in_level, 40);
  assert.equal(duplicate.already_penalized, true);
});

test('rank ladder math matches Liên Quân tier table', () => {
  const cases = [
    [0, 'Đồng III', 0, false],
    [2, 'Đồng III', 2, false],
    [3, 'Đồng II', 0, false],
    [8, 'Đồng I', 2, false],
    [9, 'Bạc III', 0, false],
    [63, 'Thách Đấu', 0, true],
    [70, 'Thách Đấu', 0, true],
  ];
  for (const [points, label, stars, isApex] of cases) {
    const ladder = computeRankLadder(points);
    assert.equal(ladder.label_vi, label, `P=${points} label`);
    assert.equal(ladder.stars, stars, `P=${points} stars`);
    assert.equal(ladder.is_apex, isApex, `P=${points} apex`);
  }
  assert.equal(computeRankLadder(70).apex_points, 7);
  assert.equal(computeRankLadder(63).apex_points, 0);
});

test('rankPointsFromHistory awards bonus RP for scores at or above 80%', () => {
  const state = {
    pack_history: [
      { pack_id: 'a', score_percent: 90 },
      { pack_id: 'b', score_percent: 50 },
      { pack_id: 'c', score_percent: 85 },
    ],
  };
  assert.equal(rankPointsFromHistory(state), 5);
});

test('rank ladder is monotonic — more points never lowers label', () => {
  let previous = computeRankLadder(0).label_vi;
  for (let points = 1; points <= 80; points += 1) {
    const ladder = computeRankLadder(points);
    assert.ok(
      ladder.rank_points >= points - 1,
      `rank_points should track cumulative RP at P=${points}`,
    );
    const order = [
      'Đồng III', 'Đồng II', 'Đồng I',
      'Bạc III', 'Bạc II', 'Bạc I',
      'Vàng III', 'Vàng II', 'Vàng I',
      'Bạch Kim III', 'Bạch Kim II', 'Bạch Kim I',
      'Kim Cương III', 'Kim Cương II', 'Kim Cương I',
      'Tinh Anh III', 'Tinh Anh II', 'Tinh Anh I',
      'Cao Thủ III', 'Cao Thủ II', 'Cao Thủ I',
      'Thách Đấu',
    ];
    const prevIdx = order.indexOf(previous);
    const nextIdx = order.indexOf(ladder.label_vi);
    assert.ok(nextIdx >= prevIdx, `P=${points}: ${previous} → ${ladder.label_vi} regressed`);
    previous = ladder.label_vi;
  }
});

test('old student record without scores ranks from pack count without crashing', () => {
  const legacy = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      completed_packs: 4,
      completed_pack_ids: ['p1', 'p2', 'p3', 'p4'],
    },
    {
      accessCode: 'R2L-LEGACY',
      codeData: { student_profile: { student_name: 'Legacy' } },
    },
  );
  const ladder = computeRankLadder(legacy);
  assert.equal(ladder.rank_points, 4);
  assert.equal(ladder.label_vi, 'Đồng II');
  assert.equal(publicProgressState(legacy).rank_ladder.rank_points, 4);
});

test('buildAdminTestLevelState snaps test accounts to any ladder level', () => {
  const l3 = buildAdminTestLevelState(null, 'L3', {
    accessCode: 'R2L-PILOT-L3',
    codeData: { student_profile: { student_name: 'Pilot L3' } },
  });
  assert.equal(l3.current_level, 'L3');
  assert.deepEqual(l3.unlocked_levels, ['L1', 'L2', 'L3']);
  assert.equal(l3.level_progress.L1, 5);
  assert.equal(l3.level_progress.L2, 15);
  assert.equal(l3.level_progress.L3, 0);
  assert.equal(l3.xp_in_level, 0);
  assert.equal(l3.xp_to_next_level, 500);
  assert.equal(l3.rank_title, 'Vàng');

  const l1 = buildAdminTestLevelState(l3, 'L1', { accessCode: 'R2L-PILOT-L3' });
  assert.equal(l1.current_level, 'L1');
  assert.deepEqual(l1.unlocked_levels, ['L1']);
  assert.equal(l1.level_progress.L1, 0);
});
