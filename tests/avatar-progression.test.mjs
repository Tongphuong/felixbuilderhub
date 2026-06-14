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

test('L1 defaults to egg stage', () => {
  const state = normalizeProgressState(null, { accessCode: 'EGG-L1' });
  assert.equal(state.avatar_stage, 'egg');
});

test('L2 defaults to basic stage', () => {
  const state = normalizeProgressState(rawAtLevel('L2'), { accessCode: 'BASIC-L2' });
  assert.equal(state.avatar_stage, 'basic');
});

test('levels above L2 default to basic stage', () => {
  for (const level of ['L3', 'L4', 'L5']) {
    const state = normalizeProgressState(rawAtLevel(level), { accessCode: `BASIC-${level}` });
    assert.equal(state.avatar_stage, 'basic');
  }
});

test('persisted custom stage survives normalization', () => {
  const state = normalizeProgressState(
    rawAtLevel('L3', { avatar_stage: 'custom' }),
    { accessCode: 'CUSTOM-PERSIST' },
  );
  assert.equal(state.avatar_stage, 'custom');
});

test('persisted egg advances to basic after reaching L2', () => {
  const state = normalizeProgressState(
    rawAtLevel('L2', { avatar_stage: 'egg' }),
    { accessCode: 'EGG-HATCH' },
  );
  assert.equal(state.avatar_stage, 'basic');
});

test('basic stage receives the frozen white monster defaults', () => {
  const state = normalizeProgressState(rawAtLevel('L2'), { accessCode: 'WHITE-BASIC' });
  assert.deepEqual(state.avatar.monster, BASIC_MONSTER_CONFIG);
  assert.equal(state.avatar.monster.detail, '');
});

test('first saved customization transitions basic to custom', () => {
  const state = normalizeProgressState(rawAtLevel('L2'), { accessCode: 'FIRST-CUSTOM' });
  const saved = saveAvatarMonster(
    state,
    { ...BASIC_MONSTER_CONFIG, color: 'sky' },
    'FIRST-CUSTOM',
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.state.avatar_stage, 'custom');
});

test('custom stage persists through normalize after state write', () => {
  const state = normalizeProgressState(rawAtLevel('L2'), { accessCode: 'WRITE-CUSTOM' });
  const saved = saveAvatarMonster(state, BASIC_MONSTER_CONFIG, 'WRITE-CUSTOM');
  const reread = normalizeProgressState(saved.state, { accessCode: 'WRITE-CUSTOM' });
  assert.equal(reread.avatar_stage, 'custom');
});

test('public progress exposes stage and independent basic defaults', () => {
  const state = normalizeProgressState(rawAtLevel('L2'), { accessCode: 'PUBLIC-BASIC' });
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
