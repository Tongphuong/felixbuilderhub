import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEADERBOARD_BOT_PRESETS,
  buildAdminBotLeaderboardState,
  buildRankLadderFromPoints,
  publicProgressState,
  rpForRankLabelVi,
} from '../functions/api/_read2lead-v2-state.js';
import { applyBotStatsToCode } from '../functions/api/admin/codes/_apply-bot-stats.js';
import { onRequestPost as applyBotPresetsPost } from '../functions/api/admin/codes/apply-bot-presets.js';

test('rpForRankLabelVi maps Vàng II and Vàng III', () => {
  assert.equal(buildRankLadderFromPoints(rpForRankLabelVi('Vàng II')).label_vi, 'Vàng II');
  assert.equal(buildRankLadderFromPoints(rpForRankLabelVi('Vàng III')).label_vi, 'Vàng III');
  assert.ok(rpForRankLabelVi('Vàng II') > rpForRankLabelVi('Vàng III'));
});

test('buildAdminBotLeaderboardState snaps Pilot preset stats', () => {
  const preset = LEADERBOARD_BOT_PRESETS.pilot;
  const state = buildAdminBotLeaderboardState(null, {
    accessCode: preset.code,
    rankLabelVi: preset.rank_label_vi,
    completedPacks: preset.completed_packs,
    coins: preset.coins,
    studentName: preset.student_name,
  });
  const view = publicProgressState(state);
  assert.equal(state.student_name, 'Pilot');
  assert.equal(state.completed_packs, 39);
  assert.equal(state.coins, 975);
  assert.equal(view.rank_ladder.label_vi, 'Vàng II');
  assert.equal(state.season.rp, rpForRankLabelVi('Vàng II'));
});

test('buildAdminBotLeaderboardState snaps Ong preset stats', () => {
  const preset = LEADERBOARD_BOT_PRESETS.ong;
  const state = buildAdminBotLeaderboardState(null, {
    accessCode: preset.code,
    rankLabelVi: preset.rank_label_vi,
    completedPacks: preset.completed_packs,
    coins: preset.coins,
    studentName: preset.student_name,
  });
  const view = publicProgressState(state);
  assert.equal(state.student_name, 'Ong');
  assert.equal(state.completed_packs, 19);
  assert.equal(state.coins, 475);
  assert.equal(view.rank_ladder.label_vi, 'Vàng III');
});

test('applyBotStatsToCode writes progress and marks code as bot', async () => {
  const code = LEADERBOARD_BOT_PRESETS.pilot.code;
  const records = new Map([
    [code, {
      parent_name: 'Bot Parent',
      is_test: true,
      student_profile: { student_name: 'Pilot', age: 10, level: 'L1' },
      progress: { student_name: 'Pilot', current_level: 'L1' },
    }],
  ]);
  const kv = {
    async get(key, options) {
      const value = records.get(key);
      if (!value) return null;
      return options?.type === 'json' ? value : JSON.stringify(value);
    },
    async put(key, value) {
      records.set(key, typeof value === 'string' ? JSON.parse(value) : value);
    },
    async delete(key) {
      records.delete(key);
    },
  };

  const result = await applyBotStatsToCode({ READ2LEAD_CODES: kv }, code, LEADERBOARD_BOT_PRESETS.pilot);
  assert.equal(result.ok, true);
  assert.equal(result.display_name, 'Pilot');
  assert.equal(result.rank_label_vi, 'Vàng II');
  assert.equal(result.completed_packs, 39);
  assert.equal(records.get(code).is_bot, true);
  assert.equal(records.get(`progress:${code}`).completed_packs, 39);
});

test('apply-bot-presets endpoint applies Pilot and Ong', async () => {
  const records = new Map();
  for (const preset of Object.values(LEADERBOARD_BOT_PRESETS)) {
    records.set(preset.code, {
      parent_name: 'Bot',
      is_test: true,
      student_profile: { student_name: preset.student_name, age: 10, level: 'L1' },
      progress: { student_name: preset.student_name, current_level: 'L1' },
    });
  }
  const kv = {
    async get(key, options) {
      const value = records.get(key);
      if (!value) return null;
      return options?.type === 'json' ? value : JSON.stringify(value);
    },
    async put(key, value) {
      records.set(key, typeof value === 'string' ? JSON.parse(value) : value);
    },
    async delete() {},
  };

  const response = await applyBotPresetsPost({
    request: new Request('https://example.com/api/admin/codes/apply-bot-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presets: ['pilot', 'ong'] }),
    }),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.applied, 2);
  assert.equal(records.get(LEADERBOARD_BOT_PRESETS.pilot.code).is_bot, true);
  assert.equal(records.get(LEADERBOARD_BOT_PRESETS.ong.code).is_bot, true);
});
