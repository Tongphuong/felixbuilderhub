import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cumulativeStartRP,
  currentSeason,
  PRE_SEASON,
  SEASON_REWARD_DIAMONDS,
  seasonRewardDiamonds,
  tierStartRp,
} from '../functions/api/_read2lead-seasons.js';
import {
  buildRankLadderFromPoints,
  normalizeProgressState,
} from '../functions/api/_read2lead-v2-state.js';

test('currentSeason returns pre-season before July 2026', () => {
  const season = currentSeason(new Date('2026-06-15T10:00:00.000Z'));
  assert.equal(season.id, PRE_SEASON.id);
});

test('SEASON_REWARD_DIAMONDS matches spec conversion [5..75] (1💎 = 2🪙, floor)', () => {
  assert.deepEqual(SEASON_REWARD_DIAMONDS, [5, 10, 17, 25, 35, 45, 60, 75]);
  assert.equal(seasonRewardDiamonds(0), 5);
  assert.equal(seasonRewardDiamonds(7), 75);
  assert.equal(seasonRewardDiamonds(99), 75, 'tier index above 7 clamps to the top reward, same as before the rename');
});

test('currentSeason returns active season inside its window', () => {
  const season = currentSeason(new Date('2026-07-15T10:00:00.000Z'));
  assert.equal(season.id, '2026-S1');
  assert.equal(season.name_vi, 'Amazing Summer');
});

test('cumulativeStartRP matches progressive tier thresholds', () => {
  assert.equal(cumulativeStartRP(0), 0);
  assert.equal(cumulativeStartRP(1), 9);
  assert.equal(cumulativeStartRP(3), 30);
  assert.equal(tierStartRp(4), 42);
});

test('season rollover freezes medal, grants diamonds, and soft-resets one tier', () => {
  const beforeRollover = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      diamonds: 20,
      season: {
        id: '2026-S1',
        rp: 50,
        peak_tier_index: 4,
        peak_label_vi: 'Kim Cương II',
      },
      lifetime_rp: 50,
      rank_points: 50,
      medals: [],
    },
    {
      accessCode: 'R2L-ROLLOVER',
      codeData: { student_profile: { student_name: 'Rollover Kid' } },
      nowIso: '2026-09-01T01:00:00.000Z',
    },
  );

  assert.equal(beforeRollover.season.id, '2026-S2');
  assert.equal(beforeRollover.season.rp, cumulativeStartRP(3));
  assert.equal(beforeRollover.medals.length, 1);
  assert.equal(beforeRollover.medals[0].season_id, '2026-S1');
  assert.equal(beforeRollover.medals[0].reward_diamonds, seasonRewardDiamonds(4));
  assert.equal(
    beforeRollover.diamonds,
    20 + seasonRewardDiamonds(4),
  );
  assert.equal(beforeRollover.season.rp, cumulativeStartRP(3));
  assert.match(buildRankLadderFromPoints(beforeRollover.season.rp).label_vi, /Bạch Kim/);

  const again = normalizeProgressState(beforeRollover, {
    accessCode: 'R2L-ROLLOVER',
    nowIso: '2026-09-02T01:00:00.000Z',
  });
  assert.equal(again.medals.length, 1);
  assert.equal(again.season.rp, beforeRollover.season.rp);
});

test('pre-season records migrate without RP loss', () => {
  const migrated = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      rank_points: 22,
      completed_packs: 12,
    },
    {
      accessCode: 'R2L-PRE',
      codeData: { student_profile: { student_name: 'Pre Season' } },
      nowIso: '2026-06-10T01:00:00.000Z',
    },
  );
  assert.equal(migrated.lifetime_rp, 22);
  assert.equal(migrated.season.rp, 22);
  assert.equal(migrated.season.id, PRE_SEASON.id);
});
