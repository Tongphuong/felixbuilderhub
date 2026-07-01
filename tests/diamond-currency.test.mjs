import test from 'node:test';
import assert from 'node:assert/strict';

import { applyManualReward, DEFAULT_POSITIVE_PRESETS, DEFAULT_NEEDS_WORK_PRESETS } from '../functions/api/admin/_classes.js';
import { normalizeProgressState, publicProgressState } from '../functions/api/_read2lead-v2-state.js';

/**
 * Tests for the diamond currency system.
 *
 * Coaching rewards now use diamonds (💎) instead of XP (⭐).
 * Diamonds do NOT affect reading level progression — they are a
 * coaching-only prestige currency.
 */

function makeBaseState(overrides = {}) {
  return normalizeProgressState(null, {
    accessCode: 'R2L-TEST-DIA',
    codeData: { student_profile: { student_name: 'Test' } },
  });
}

test('applyManualReward adds diamonds without changing XP or level', () => {
  const state = makeBaseState();
  state.diamonds = 5;
  state.total_xp = 100;
  state.xp_in_level = 20;
  state.current_level = 'L1';

  const result = applyManualReward(state, { diamondDelta: 10, coinsDelta: 5 });

  assert.equal(result.diamonds, 15, 'diamonds should increase by 10');
  assert.equal(result.coins, 5, 'coins should increase by 5');
  assert.equal(result.total_xp, 100, 'total_xp must NOT change');
  assert.equal(result.xp_in_level, 20, 'xp_in_level must NOT change');
  assert.equal(result.current_level, 'L1', 'current_level must NOT change');
});

test('applyManualReward does not level up the student', () => {
  const state = makeBaseState();
  state.xp_in_level = 58;
  state.xp_to_next_level = 60;
  state.current_level = 'L1';

  const result = applyManualReward(state, { diamondDelta: 100, coinsDelta: 0 });

  assert.equal(result.current_level, 'L1', 'must NOT level up from coaching diamonds');
  assert.equal(result.xp_in_level, 58, 'xp_in_level must NOT change');
  assert.equal(result.total_xp, state.total_xp, 'total_xp must NOT change');
  assert.equal(result.diamonds, 100, 'diamonds should be 100');
});

test('applyManualReward handles negative diamond delta (needs_work)', () => {
  const state = makeBaseState();
  state.diamonds = 20;

  const result = applyManualReward(state, { diamondDelta: -5, coinsDelta: 0 });

  assert.equal(result.diamonds, 15, 'diamonds should decrease by 5');
});

test('applyManualReward clamps diamonds to zero (no negative balance)', () => {
  const state = makeBaseState();
  state.diamonds = 3;

  const result = applyManualReward(state, { diamondDelta: -10, coinsDelta: 0 });

  assert.equal(result.diamonds, 0, 'diamonds should not go below 0');
});

test('default presets use diamond_delta not xp_delta', () => {
  for (const preset of DEFAULT_POSITIVE_PRESETS) {
    assert.ok(preset.diamond_delta != null, `preset ${preset.id} should have diamond_delta`);
    assert.equal(preset.xp_delta, undefined, `preset ${preset.id} should NOT have xp_delta`);
  }
  for (const preset of DEFAULT_NEEDS_WORK_PRESETS) {
    assert.ok(preset.diamond_delta != null, `preset ${preset.id} should have diamond_delta`);
    assert.equal(preset.xp_delta, undefined, `preset ${preset.id} should NOT have xp_delta`);
  }
});

test('normalizeProgressState includes diamonds field', () => {
  const state = normalizeProgressState(
    { schema_version: 2, level_reset_version: 20260606, diamonds: 42 },
    { accessCode: 'R2L-DIA-TEST' },
  );
  assert.equal(state.diamonds, 42, 'stored diamonds should be preserved');
});

test('normalizeProgressState defaults diamonds to 0 for new students', () => {
  const state = makeBaseState();
  assert.equal(state.diamonds, 0, 'new students should have 0 diamonds');
});

test('publicProgressState exposes diamonds', () => {
  const state = makeBaseState();
  state.diamonds = 77;
  const pub = publicProgressState(state);
  assert.equal(pub.diamonds, 77, 'publicProgressState should expose diamonds');
});

test('publicProgressState defaults diamonds to 0', () => {
  const state = makeBaseState();
  const pub = publicProgressState(state);
  assert.equal(pub.diamonds, 0, 'publicProgressState should default to 0');
});