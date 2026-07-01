import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequestGet as leaderboardGet } from '../functions/api/read2lead-leaderboard.js';
import {
  applyPackCompletion,
  awardRankPoints,
  buildRankLadderFromPoints,
  computeRankLadder,
  normalizeProgressState,
  rankRpFromScore,
  vietnamDateKey,
} from '../functions/api/_read2lead-v2-state.js';

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
    async put(key, value) {
      records.set(key, JSON.parse(value));
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

test('Read2Lead landing surfaces action cards before the form', () => {
  const source = readFileSync(join(ROOT, 'src/pages/read2lead.astro'), 'utf8');
  const formIndex = source.indexOf('<section id="form"');
  assert.ok(formIndex > 0, 'form section should exist');
  assert.ok(source.indexOf('Tạo bài cho con') > 0);
  assert.ok(source.indexOf('Bảng xếp hạng') > 0);
  assert.ok(source.indexOf('Xem tiến độ con') > 0);
  assert.ok(source.indexOf('Tạo bài cho con') < formIndex);
  assert.ok(source.indexOf('Bảng xếp hạng') < formIndex);
  assert.ok(source.indexOf('Xem tiến độ con') < formIndex);
  assert.equal(/bảng vinh danh/i.test(source), false);
});

test('leaderboard page uses Ranking Arena wording instead of old honor-board wording', () => {
  const source = readFileSync(join(ROOT, 'src/pages/read2lead/leaderboard.astro'), 'utf8');
  assert.match(source, /Bảng xếp hạng - Ranking Arena/);
  assert.equal(/bảng vinh danh/i.test(source), false);
});

test('W2R tier costs: RP 0, đỉnh Vàng, apex 87, monotonic', () => {
  assert.equal(computeRankLadder(0).label_vi, 'Đồng III');
  assert.match(computeRankLadder(29).label_vi, /Vàng I/);
  assert.equal(computeRankLadder(87).is_apex, true);
  let previous = computeRankLadder(0).label_vi;
  for (let points = 1; points <= 100; points += 1) {
    const ladder = computeRankLadder(points);
    const order = [
      'Đồng III', 'Đồng II', 'Đồng I', 'Bạc III', 'Bạc II', 'Bạc I',
      'Vàng III', 'Vàng II', 'Vàng I', 'Bạch Kim III', 'Bạch Kim II', 'Bạch Kim I',
      'Kim Cương III', 'Kim Cương II', 'Kim Cương I', 'Tinh Anh III', 'Tinh Anh II', 'Tinh Anh I',
      'Cao Thủ III', 'Cao Thủ II', 'Cao Thủ I', 'Thách Đấu',
    ];
    assert.ok(order.indexOf(ladder.label_vi) >= order.indexOf(previous), `P=${points}`);
    previous = ladder.label_vi;
  }
});

test('W2R quality stars: 64% +0, 65% +1, 85% +2', () => {
  assert.equal(rankRpFromScore(64), 0);
  assert.equal(rankRpFromScore(65), 1);
  assert.equal(rankRpFromScore(85), 2);
});

test('W2R daily RP cap awards at most 3 RP per VN day', () => {
  let state = normalizeProgressState(null, {
    accessCode: 'R2L-DAILY',
    codeData: { student_profile: { student_name: 'Daily Kid' } },
  });
  const dayKey = '2026-06-05';
  for (let i = 0; i < 4; i += 1) {
    state = applyPackCompletion(state, {
      packId: `good-${i}`,
      completedAt: '2026-06-05T02:00:00.000Z',
      rewardsEarned: { coins: 20, xp: 20 },
      scorePercent: 90,
    }).state;
    state = awardRankPoints(state, { scorePercent: 90, dateKey: dayKey }).state;
  }
  assert.equal(state.season.rp, 3);
  state = applyPackCompletion(state, {
    packId: 'next-day',
    completedAt: '2026-06-06T02:00:00.000Z',
    rewardsEarned: { coins: 20, xp: 20 },
    scorePercent: 90,
  }).state;
  state = awardRankPoints(state, {
    scorePercent: 90,
    dateKey: vietnamDateKey('2026-06-06T02:00:00.000Z'),
  }).state;
  assert.equal(state.season.rp, 5);
});

test('W2R tier cap clamps display by learning level', () => {
  const capped = computeRankLadder({ current_level: 'L1', season: { rp: 50 } });
  assert.match(capped.label_vi, /Vàng I/);
  assert.equal(capped.capped, true);
  const atL2 = computeRankLadder({ current_level: 'L2', season: { rp: 50 } });
  assert.match(atL2.label_vi, /Bạch Kim/);
  assert.equal(atL2.capped, true);
});

test('W2R level gate blocks level-up when recent average is below 70%', () => {
  let state = normalizeProgressState(null, {
    accessCode: 'R2L-GATE-BLOCK',
    codeData: { student_profile: { student_name: 'Gate Block Kid' } },
  });
  for (let i = 1; i <= 5; i += 1) {
    const result = applyPackCompletion(state, {
      packId: `pack-${i}`,
      completedAt: `2026-06-0${i}T02:00:00.000Z`,
      rewardsEarned: { coins: 20, xp: 20 },
      scorePercent: 60,
    });
    state = result.state;
    if (i === 5) {
      assert.equal(result.level_gate_hint_vi, 'Sắp lên Level rồi! Con luyện thêm cho điểm trung bình đạt 70% nhé.');
      assert.equal(state.current_level, 'L0');
    }
  }
});

test('W2R level gate allows level-up when recent average reaches 70%', () => {
  let state = normalizeProgressState(null, {
    accessCode: 'R2L-GATE-PASS',
    codeData: { student_profile: { student_name: 'Gate Pass Kid' } },
  });
  let promoted = null;
  for (let i = 1; i <= 5; i += 1) {
    promoted = applyPackCompletion(state, {
      packId: `pack-${i}`,
      completedAt: `2026-06-0${i}T02:00:00.000Z`,
      rewardsEarned: { coins: 20, xp: 20 },
      scorePercent: 75,
    });
    state = promoted.state;
  }
  assert.equal(promoted.level_up?.to_level, 'L1');
});

test('old records without season fields normalize without losing rank', () => {
  const legacy = normalizeProgressState(
    {
      schema_version: 2,
      level_reset_version: 20260606,
      rank_points: 14,
      completed_packs: 10,
    },
    {
      accessCode: 'R2L-LEGACY-SEASON',
      codeData: { student_profile: { student_name: 'Legacy Season' } },
      nowIso: '2026-06-05T01:00:00.000Z',
    },
  );
  assert.equal(legacy.lifetime_rp, 14);
  assert.equal(legacy.season.rp, 14);
  assert.equal(buildRankLadderFromPoints(legacy.season.rp).rank_points, 14);
});

test('W2R season peak respects the level cap (no medal above the shown rank)', () => {
  let state = normalizeProgressState(null, {
    accessCode: 'R2L-PEAK-CAP',
    codeData: { student_profile: { student_name: 'Cap Kid' } },
  });
  state = { ...state, current_level: 'L1', season: { ...state.season, rp: 49 } };
  state = awardRankPoints(state, { scorePercent: 90, dateKey: '2026-06-05' }).state;
  assert.ok(state.season.peak_tier_index <= 2, 'peak tier must respect L1 cap (Vàng)');
  assert.match(state.season.peak_label_vi, /Vàng/);
});
