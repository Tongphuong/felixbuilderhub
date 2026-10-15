import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  onRequestGet as leaderboardGet,
  buildPreviousSeasonPodium,
  compareLeadersBySeasonRp,
  seasonRpForLeader,
} from '../functions/api/read2lead-leaderboard.js';
import { currentSeason } from '../functions/api/_read2lead-seasons.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Records in fixtures must carry the season that is ACTIVE at test time —
// any other id triggers the state core's season rollover (soft reset) and the
// expected RP ordering would change with the wall clock.
const ACTIVE_SEASON_ID = currentSeason().id;

/** Canonical contract fixture — R2 §2; R3 tests sort/podium against it. */
const SEASON_FIXTURE = {
  id: '2026-S1',
  name_vi: 'Amazing Summer',
  emoji: '🧭',
  ends_at: '2026-08-31',
  rp: 14,
  ladder: {
    tier_index: 1,
    label_vi: 'Bạc II',
    stars: 1,
    stars_per_division: 3,
    stars_to_next: 2,
    capped: false,
    cap_unlock_hint_vi: null,
  },
  peak_label_vi: 'Bạc I',
};

const MEDALS_FIXTURE = [
  {
    season_id: '2026-S0',
    name_vi: 'Mùa Khởi Đầu',
    emoji: '🌱',
    peak_label_vi: 'Vàng II',
    peak_tier_index: 2,
    reward_coins: 35,
    ts: '2026-05-31T12:00:00.000Z',
  },
];

test('compareLeadersBySeasonRp prefers season.rp and falls back sanely', () => {
  const withSeason = { season_rp: 20, rank_ladder: { tier_index: 1 }, completed_packs: 1, last_reviewed_at: '2026-01-01' };
  const legacy = { season_rp: 15, rank_ladder: { tier_index: 3 }, completed_packs: 9, last_reviewed_at: '2026-06-01' };
  const low = { season_rp: 10, rank_ladder: { tier_index: 0 }, completed_packs: 2, last_reviewed_at: '2026-06-02' };

  assert.ok(compareLeadersBySeasonRp(withSeason, legacy) < 0);
  assert.ok(compareLeadersBySeasonRp(legacy, low) < 0);
  assert.deepEqual([withSeason, legacy, low].sort(compareLeadersBySeasonRp), [withSeason, legacy, low]);
});

test('seasonRpForLeader uses season.rp when present else legacy rank_points', () => {
  assert.equal(seasonRpForLeader(SEASON_FIXTURE, {}, {}), 14);
  assert.equal(seasonRpForLeader(null, { rank_ladder: { rank_points: 9 } }, {}), 9);
  assert.equal(seasonRpForLeader(null, {}, { rank_points: 7 }), 7);
});

test('buildPreviousSeasonPodium picks latest medal per student for previous season', () => {
  const rows = [
    {
      season_id: '2026-S0',
      display_name: 'An',
      masked_code: 'R2L-***1111',
      peak_label_vi: 'Bạc I',
      peak_tier_index: 1,
      reward_coins: 20,
      season_name_vi: 'Mùa Khởi Đầu',
      emoji: '🌱',
      ts: '2026-05-01T00:00:00.000Z',
    },
    {
      season_id: '2026-S0',
      display_name: 'An',
      masked_code: 'R2L-***1111',
      peak_label_vi: 'Vàng II',
      peak_tier_index: 2,
      reward_coins: 35,
      season_name_vi: 'Mùa Khởi Đầu',
      emoji: '🌱',
      ts: '2026-05-31T12:00:00.000Z',
    },
    {
      season_id: '2026-S0',
      display_name: 'Bin',
      masked_code: 'R2L-***2222',
      peak_label_vi: 'Kim Cương I',
      peak_tier_index: 4,
      reward_coins: 70,
      season_name_vi: 'Mùa Khởi Đầu',
      emoji: '🌱',
      ts: '2026-05-20T00:00:00.000Z',
    },
    {
      season_id: '2026-S1',
      display_name: 'Chi',
      masked_code: 'R2L-***3333',
      peak_label_vi: 'Đồng III',
      peak_tier_index: 0,
      reward_coins: 10,
      season_name_vi: 'Amazing Summer',
      emoji: '🧭',
      ts: '2026-06-15T00:00:00.000Z',
    },
  ];

  const podium = buildPreviousSeasonPodium(rows, '2026-S0');
  assert.equal(podium.length, 2);
  assert.equal(podium[0].display_name, 'Bin');
  assert.equal(podium[0].medal_emoji, '🥇');
  assert.equal(podium[1].display_name, 'An');
  assert.equal(podium[1].peak_label_vi, 'Vàng II');
});

test('buildPreviousSeasonPodium returns empty when no previous-season medals', () => {
  assert.deepEqual(buildPreviousSeasonPodium([], '2026-S0'), []);
  assert.deepEqual(
    buildPreviousSeasonPodium(
      [{ season_id: '2026-S1', display_name: 'A', masked_code: 'x', peak_tier_index: 1, reward_coins: 1, peak_label_vi: 'Bạc', season_name_vi: 'S1', emoji: '🧭', ts: '1' }],
      '2026-S0',
    ),
    [],
  );
});

// BAD-A — the live regression: grant-season-honors.mjs appends a SECOND
// medal (kind:'honors', tier 0, blank label) with a NEWER ts than the
// student's real season medal. The old "latest ts wins" logic let that
// blank placeholder replace the real tier-4 medal. Must never happen.
test('buildPreviousSeasonPodium ignores honors medals in latest-per-student/tier selection (BAD-A)', () => {
  const rows = [
    {
      season_id: '2026-S1',
      display_name: 'Percy',
      masked_code: 'R2L-***PERCY',
      peak_label_vi: 'Kim Cương III',
      peak_tier_index: 4,
      reward_diamonds: 35,
      season_name_vi: 'Amazing Summer',
      emoji: '🧭',
      ts: '2026-09-02T09:26:40.863Z',
    },
    {
      season_id: '2026-S1',
      display_name: 'Percy',
      masked_code: 'R2L-***PERCY',
      kind: 'honors',
      honors_rank: 1,
      peak_label_vi: '',
      peak_tier_index: 0,
      reward_diamonds: 35,
      season_name_vi: 'Amazing Summer',
      emoji: '🧭',
      ts: '2026-09-03T09:52:54.185Z',
    },
  ];

  const podium = buildPreviousSeasonPodium(rows, '2026-S1');
  assert.equal(podium.length, 1);
  assert.equal(podium[0].display_name, 'Percy');
  assert.equal(podium[0].peak_tier_index, 4);
  assert.equal(podium[0].peak_label_vi, 'Kim Cương III');
});

// BAD-B — once the honors row is filtered out of tier logic, tied students
// (same tier, same reward_diamonds) must be ordered by the PAID honors_rank
// (founder-confirmed order), not by array/scan position.
test('buildPreviousSeasonPodium orders tied students by honors_rank, not scan order (BAD-B)', () => {
  const rows = [
    // Deliberately fed out of rank order: Hieuenzo (rank 3) first, Percy
    // (rank 1) last, so a passing test proves honors_rank drives the order.
    { season_id: '2026-S1', display_name: 'Hieuenzo', masked_code: 'R2L-***HIEU', peak_label_vi: 'Kim Cương III', peak_tier_index: 4, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:53:00.370Z' },
    { season_id: '2026-S1', display_name: 'Hieuenzo', masked_code: 'R2L-***HIEU', kind: 'honors', honors_rank: 3, peak_label_vi: '', peak_tier_index: 0, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:53:02.342Z' },
    { season_id: '2026-S1', display_name: 'Hoang', masked_code: 'R2L-***HOANG', peak_label_vi: 'Kim Cương III', peak_tier_index: 4, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:52:56.567Z' },
    { season_id: '2026-S1', display_name: 'Hoang', masked_code: 'R2L-***HOANG', kind: 'honors', honors_rank: 2, peak_label_vi: '', peak_tier_index: 0, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:52:58.244Z' },
    { season_id: '2026-S1', display_name: 'Percy', masked_code: 'R2L-***PERCY', peak_label_vi: 'Kim Cương III', peak_tier_index: 4, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-02T09:26:40.863Z' },
    { season_id: '2026-S1', display_name: 'Percy', masked_code: 'R2L-***PERCY', kind: 'honors', honors_rank: 1, peak_label_vi: '', peak_tier_index: 0, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:52:54.185Z' },
  ];

  const podium = buildPreviousSeasonPodium(rows, '2026-S1');
  assert.deepEqual(podium.map((row) => row.display_name), ['Percy', 'Hoang', 'Hieuenzo']);
  assert.deepEqual(podium.map((row) => row.medal_emoji), ['🥇', '🥈', '🥉']);
});

// BAD-C — no honors medal at all: two students tied on tier and diamonds
// must fall back to masked_code ascending, and that result must not depend
// on which order they're fed in (determinism, not KV scan order).
test('buildPreviousSeasonPodium is deterministic for ties with no honors medal (BAD-C)', () => {
  const rowA = { season_id: '2026-S1', display_name: 'Aaron', masked_code: 'R2L-***AAAA', peak_label_vi: 'Bạc II', peak_tier_index: 1, reward_diamonds: 10, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-08-01T00:00:00.000Z' };
  const rowB = { season_id: '2026-S1', display_name: 'Bao', masked_code: 'R2L-***BBBB', peak_label_vi: 'Bạc II', peak_tier_index: 1, reward_diamonds: 10, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-08-02T00:00:00.000Z' };

  const podiumForward = buildPreviousSeasonPodium([rowA, rowB], '2026-S1');
  const podiumReversed = buildPreviousSeasonPodium([rowB, rowA], '2026-S1');

  assert.deepEqual(podiumForward.map((row) => row.masked_code), ['R2L-***AAAA', 'R2L-***BBBB']);
  assert.deepEqual(podiumReversed.map((row) => row.masked_code), ['R2L-***AAAA', 'R2L-***BBBB']);
});

// BAD-D — no regression: a student with only a normal season medal (no
// honors medal at all) still appears on the podium exactly as before.
test('buildPreviousSeasonPodium still shows a student with no honors medal (BAD-D)', () => {
  const rows = [
    { season_id: '2026-S1', display_name: 'DangNemo', masked_code: 'R2L-***DANG', peak_label_vi: 'Đồng III', peak_tier_index: 3, reward_diamonds: 20, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-04T12:56:34.240Z' },
  ];

  const podium = buildPreviousSeasonPodium(rows, '2026-S1');
  assert.equal(podium.length, 1);
  assert.equal(podium[0].display_name, 'DangNemo');
  assert.equal(podium[0].peak_tier_index, 3);
  assert.equal(podium[0].medal_emoji, '🥇');
});

// Real-data sanity check against the fixture in the incident packet: the
// paid Amazing Summer winners (Percy/Hoang/Hieuenzo) must outrank
// DangNemo/Danny/Phuc, in the founder-confirmed 1/2/3 order.
test('buildPreviousSeasonPodium reproduces the paid Amazing Summer podium from the live-data fixture', () => {
  const rows = [
    { season_id: '2026-S1', display_name: 'Percy', masked_code: 'R2L-***PERCY', peak_label_vi: 'Kim Cương III', peak_tier_index: 4, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-02T09:26:40.863Z' },
    { season_id: '2026-S1', display_name: 'Percy', masked_code: 'R2L-***PERCY', kind: 'honors', honors_rank: 1, peak_label_vi: '', peak_tier_index: 0, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:52:54.185Z' },
    { season_id: '2026-S1', display_name: 'Hoang', masked_code: 'R2L-***HOANG', peak_label_vi: 'Kim Cương III', peak_tier_index: 4, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:52:56.567Z' },
    { season_id: '2026-S1', display_name: 'Hoang', masked_code: 'R2L-***HOANG', kind: 'honors', honors_rank: 2, peak_label_vi: '', peak_tier_index: 0, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:52:58.244Z' },
    { season_id: '2026-S1', display_name: 'Hieuenzo', masked_code: 'R2L-***HIEU', peak_label_vi: 'Kim Cương III', peak_tier_index: 4, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:53:00.370Z' },
    { season_id: '2026-S1', display_name: 'Hieuenzo', masked_code: 'R2L-***HIEU', kind: 'honors', honors_rank: 3, peak_label_vi: '', peak_tier_index: 0, reward_diamonds: 35, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-03T09:53:02.342Z' },
    { season_id: '2026-S1', display_name: 'DangNemo', masked_code: 'R2L-***DANG', peak_label_vi: 'Đồng III', peak_tier_index: 3, reward_diamonds: 20, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-04T12:56:34.240Z' },
    { season_id: '2026-S1', display_name: 'Danny', masked_code: 'R2L-***DANNY', peak_label_vi: 'Đồng I', peak_tier_index: 2, reward_diamonds: 10, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-01T00:00:00.000Z' },
    { season_id: '2026-S1', display_name: 'Phuc', masked_code: 'R2L-***PHUC', peak_label_vi: 'Đồng I', peak_tier_index: 2, reward_diamonds: 10, season_name_vi: 'Amazing Summer', emoji: '🧭', ts: '2026-09-01T00:00:00.000Z' },
  ];

  const podium = buildPreviousSeasonPodium(rows, '2026-S1');
  assert.deepEqual(podium.map((row) => row.display_name), ['Percy', 'Hoang', 'Hieuenzo']);
  assert.deepEqual(podium.map((row) => row.medal_emoji), ['🥇', '🥈', '🥉']);
});

test('leaderboard API sorts mixed season + legacy records and includes season cache fields', async () => {
  const records = new Map([
    [
      'R2L-LEGACY',
      {
        student_profile: { student_name: 'Legacy' },
        progress: { completed_packs: 3, last_activity_at: '2026-06-01T00:00:00.000Z' },
      },
    ],
    [
      'progress:R2L-LEGACY',
      {
        schema_version: 2,
        access_code: 'R2L-LEGACY',
        student_name: 'Legacy',
        current_level: 'L1',
        rank_points: 12,
        completed_packs: 3,
        coins: 10,
        total_xp: 40,
      },
    ],
    [
      'R2L-SEASON',
      {
        student_profile: { student_name: 'Season' },
        progress: {
          completed_packs: 2,
          season: { id: ACTIVE_SEASON_ID, rp: 25 },
          medals: MEDALS_FIXTURE,
          last_activity_at: '2026-06-02T00:00:00.000Z',
        },
      },
    ],
    [
      'progress:R2L-SEASON',
      {
        schema_version: 2,
        access_code: 'R2L-SEASON',
        student_name: 'Season',
        current_level: 'L2',
        season: { id: ACTIVE_SEASON_ID, rp: 25 },
        medals: MEDALS_FIXTURE,
        completed_packs: 2,
        coins: 20,
        total_xp: 30,
      },
    ],
  ]);

  let cachedPayload = null;
  const kv = {
    async list() {
      return {
        keys: Array.from(records.keys()).map((name) => ({ name })),
        cursor: undefined,
      };
    },
    async get(key, options) {
      const value = records.get(key);
      if (!value) return null;
      if (options?.type === 'json') return value;
      return JSON.stringify(value);
    },
    async put(key, value) {
      if (key === 'leaderboard-cache') cachedPayload = JSON.parse(value);
      records.set(key, JSON.parse(value));
    },
  };

  const response = await leaderboardGet({
    request: new Request('https://felixbuilderhub.com/api/read2lead-leaderboard'),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.leaders[0].display_name, 'Season');
  assert.equal(body.leaders[0].season_rp, 25);
  assert.equal(body.leaders[1].display_name, 'Legacy');
  assert.equal(body.leaders[1].season_rp, 12);
  assert.ok(body.season?.name_vi);
  assert.ok(body.season?.emoji);
  assert.ok(Array.isArray(body.previous_season_podium));
  assert.ok(cachedPayload?.season);
  assert.ok(Array.isArray(cachedPayload?.previous_season_podium));
  assert.ok(cachedPayload?.leaders?.length >= 2);

  const cachedResponse = await leaderboardGet({
    request: new Request('https://felixbuilderhub.com/api/read2lead-leaderboard'),
    env: { READ2LEAD_CODES: kv },
  });
  const cachedBody = await cachedResponse.json();
  assert.equal(cachedBody.leaders[0].display_name, 'Season');
  assert.ok(cachedBody.season?.id);
});

test('leaderboard API falls back to v2 progress student_name when code record has none', async () => {
  const code = 'R2L-NONAME-CODE';
  const records = new Map([
    [code, {
      progress: { completed_packs: 5 },
      student_profile: {},
    }],
    [
      `progress:${code}`,
      {
        schema_version: 2,
        level_reset_version: 20260606,
        access_code: code,
        student_name: 'Minh',
        current_level: 'L2',
        rank_points: 12,
        completed_packs: 5,
        coins: 40,
        total_xp: 80,
      },
    ],
  ]);
  const kv = {
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

  const response = await leaderboardGet({
    request: new Request('https://felixbuilderhub.com/api/read2lead-leaderboard'),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();
  assert.equal(body.leaders[0].display_name, 'Minh');
});

test('leaderboard page renders season header and previous podium hooks', () => {
  const source = readFileSync(join(ROOT, 'src/pages/read2lead/leaderboard.astro'), 'utf8');
  assert.match(source, /id="season-header"/);
  assert.match(source, /id="previous-podium"/);
  assert.match(source, /renderSeasonHeader/);
  assert.match(source, /renderPreviousPodium/);
  assert.match(source, /season_rank_label/);
  assert.doesNotMatch(source, /bét bảng|tụt hạng|mất hạng/i);
});
