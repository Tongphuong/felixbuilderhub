import test from 'node:test';
import assert from 'node:assert/strict';

import { applyManualReward, DEFAULT_POSITIVE_PRESETS, DEFAULT_NEEDS_WORK_PRESETS } from '../functions/api/admin/_classes.js';
import { normalizeProgressState, publicProgressState, progressKey } from '../functions/api/_read2lead-v2-state.js';
import { onRequestPost as giftsRedeem } from '../functions/api/read2lead-gifts-redeem.js';

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

/**
 * clampDelta() in admin/_classes.js caps a single manual award. The founder
 * awards up to 1000💎 per class; the old ±500 cap silently halved that.
 * R2L-REAL-GIFTS raised the cap to ±2000 — see functions/api/admin/_classes.js.
 */
test('a 1,000💎 manual award now lands as 1,000 (not silently halved to 500)', () => {
  const state = makeBaseState();
  const result = applyManualReward(state, { diamondDelta: 1000, coinsDelta: 0 });
  assert.equal(result.diamonds, 1000);
});

test('clampDelta still caps at the new ±2000 bound (does not become unbounded)', () => {
  const state = makeBaseState();
  const result = applyManualReward(state, { diamondDelta: 5000, coinsDelta: -9999 });
  assert.equal(result.diamonds, 2000);
  assert.equal(result.coins, 0, 'a -2000 clamp floored at 0 coins from a 0 starting balance');
});

/**
 * Real-gift redemption is the highest-risk new path in R2L-REAL-GIFTS:
 * it must NEVER touch rank_points, total_xp, coins, or unlocked_parts. See
 * the comment at functions/api/admin/_classes.js applyManualReward and the
 * matching invariant in functions/api/_gifts-v2.js.
 */
test('redeeming a real gift leaves rank_points, total_xp, coins, and unlocked_parts byte-identical', async () => {
  const ACCESS_CODE = 'R2L-DIA-GIFT';
  const initialProgress = {
    schema_version: 2,
    level_reset_version: 20260606,
    diamonds: 5000,
    rank_points: 7,
    total_xp: 340,
    xp_in_level: 40,
    coins: 88,
    unlocked_parts: ['png-default-detail-blue-horn-small'],
  };
  const codeStore = new Map();
  codeStore.set('config:gifts:v1', JSON.stringify({
    schema_version: 1,
    gifts: [{ id: 'sticker', name_vi: 'Sticker', emoji: '🌟', price_diamonds: 1000, limit_total: null, redeemed_count: 0, cost_vnd: 0, active: true }],
  }));
  const progressStore = new Map();
  progressStore.set(progressKey(ACCESS_CODE), JSON.stringify(initialProgress));

  const env = {
    READ2LEAD_CODES: {
      async get(key, opts) {
        if (key === ACCESS_CODE) {
          const data = { student_profile: { student_name: 'Test' } };
          return opts?.type === 'json' ? data : JSON.stringify(data);
        }
        const raw = codeStore.get(key);
        if (!raw) return null;
        return opts?.type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key, value) {
        codeStore.set(key, value);
      },
    },
    READ2LEAD_PROGRESS: {
      async get(key, opts) {
        const raw = progressStore.get(key);
        if (!raw) return null;
        return opts?.type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key, value) {
        progressStore.set(key, value);
      },
    },
  };

  const response = await giftsRedeem({
    request: new Request('https://example.com/api/read2lead-gifts-redeem', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE, gift_id: 'sticker' }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));

  const saved = JSON.parse(progressStore.get(progressKey(ACCESS_CODE)));
  assert.equal(saved.diamonds, 4000, 'diamonds must be debited by the gift price');
  assert.equal(saved.rank_points, initialProgress.rank_points, 'rank_points must be byte-identical');
  assert.equal(saved.total_xp, initialProgress.total_xp, 'total_xp must be byte-identical');
  assert.equal(saved.xp_in_level, initialProgress.xp_in_level, 'xp_in_level must be byte-identical');
  assert.equal(saved.coins, initialProgress.coins, 'coins must be byte-identical');
  assert.deepEqual(saved.unlocked_parts, initialProgress.unlocked_parts, 'unlocked_parts must be byte-identical');
});