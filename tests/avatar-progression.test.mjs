import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASIC_MONSTER_CONFIG,
  getEggOrMonsterView,
  normalizeProgressState,
  publicProgressState,
  saveAvatarMonster,
} from '../functions/api/_read2lead-v2-state.js';

const RESET_VERSION = 20260606;

function rawAtLevel(level, extra = {}) {
  return {
    schema_version: 2,
    level_reset_version: RESET_VERSION,
    current_level: level,
    initial_level: 'L1',
    ...extra,
  };
}

test('tier 0 defaults to egg stage', () => {
  const state = normalizeProgressState(null, { accessCode: 'EGG-L1' });
  assert.equal(state.avatar_stage, 'egg');
});

test('learning level no longer hatches a tier 0 egg', () => {
  const state = normalizeProgressState(rawAtLevel('L2'), { accessCode: 'BASIC-L2' });
  assert.equal(state.avatar_stage, 'egg');
});

test('tier index 1 hatches to basic even at L1', () => {
  const state = normalizeProgressState(
    rawAtLevel('L1', { rank_points: 9 }),
    { accessCode: 'BASIC-SILVER' },
  );
  assert.equal(state.rank_points, 9);
  assert.equal(state.avatar_stage, 'basic');
});

test('persisted custom without purchases reverts to egg below Silver', () => {
  const state = normalizeProgressState(
    rawAtLevel('L3', { avatar_stage: 'custom' }),
    { accessCode: 'CUSTOM-PERSIST' },
  );
  assert.equal(state.avatar_stage, 'egg');
});

test('persisted basic without purchases reverts to egg below Silver', () => {
  const state = normalizeProgressState(
    rawAtLevel('L2', { avatar_stage: 'basic' }),
    { accessCode: 'BASIC-REVERT' },
  );
  assert.equal(state.avatar_stage, 'egg');
});

test('persisted egg advances to basic after reaching Silver', () => {
  const state = normalizeProgressState(
    rawAtLevel('L1', { avatar_stage: 'egg', rank_points: 9 }),
    { accessCode: 'EGG-HATCH' },
  );
  assert.equal(state.avatar_stage, 'basic');
});

test('unlocked purchases preserve custom below Silver', () => {
  const state = normalizeProgressState(
    rawAtLevel('L1', {
      avatar_stage: 'basic',
      unlocked_parts: ['png-default-detail-blue-horn-small'],
    }),
    { accessCode: 'PURCHASE-PRESERVE' },
  );
  assert.equal(state.avatar_stage, 'custom');
});

test('persisted custom with purchases stays custom below Silver', () => {
  const state = normalizeProgressState(
    rawAtLevel('L1', {
      avatar_stage: 'custom',
      unlocked_parts: ['png-default-detail-blue-horn-small'],
    }),
    { accessCode: 'CUSTOM-PURCHASE-PRESERVE' },
  );
  assert.equal(state.avatar_stage, 'custom');
});

test('basic stage receives the frozen white monster defaults', () => {
  const state = normalizeProgressState(
    rawAtLevel('L2', { rank_points: 9 }),
    { accessCode: 'WHITE-BASIC' },
  );
  assert.deepEqual(state.avatar.monster, BASIC_MONSTER_CONFIG);
  assert.equal(state.avatar.monster.detail, '');
});

test('saving free common choices keeps the locked basic stage', () => {
  const state = normalizeProgressState(
    rawAtLevel('L2', { rank_points: 9 }),
    { accessCode: 'FIRST-CUSTOM' },
  );
  const saved = saveAvatarMonster(
    state,
    { ...BASIC_MONSTER_CONFIG, body: 'png-default-body-bluea' },
    'FIRST-CUSTOM',
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.state.avatar_stage, 'basic');
  assert.equal(saved.state.avatar.monster.body, BASIC_MONSTER_CONFIG.body);
});

test('pending ceremony is normalized and exposed publicly', () => {
  const pending = {
    part_id: 'png-default-detail-blue-horn-small',
    rarity: 'rare',
    ts: '2026-06-14T10:00:00.000Z',
  };
  const state = normalizeProgressState(
    rawAtLevel('L2', { rank_points: 9, pending_ceremony: pending }),
    { accessCode: 'CEREMONY-PUBLIC' },
  );
  assert.deepEqual(state.pending_ceremony, pending);
  assert.deepEqual(publicProgressState(state).pending_ceremony, pending);
});

test('public progress exposes stage and independent basic defaults', () => {
  const state = normalizeProgressState(
    rawAtLevel('L2', { rank_points: 9 }),
    { accessCode: 'PUBLIC-BASIC' },
  );
  const view = publicProgressState(state);
  assert.equal(view.avatar_stage, 'basic');
  assert.deepEqual(view.monster_basic_defaults, BASIC_MONSTER_CONFIG);
  assert.notEqual(view.monster_basic_defaults, BASIC_MONSTER_CONFIG);
});

test('getEggOrMonsterView returns egg data without monster config', () => {
  const state = normalizeProgressState(
    { student_name: 'Linh', xp_in_level: 40 },
    { accessCode: 'EGG-VIEW' },
  );
  const view = getEggOrMonsterView(state);
  assert.equal(view.stage, 'egg');
  assert.equal(view.name, 'Linh');
  assert.equal(view.level, 'L1');
  assert.equal('monster' in view, false);
});
