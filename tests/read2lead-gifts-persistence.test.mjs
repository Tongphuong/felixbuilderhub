import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProgressState, publicProgressState } from '../functions/api/_read2lead-v2-state.js';
import { executeRedeem, applyRedemptionStatus } from '../functions/api/_gifts-v2.js';

/**
 * Regression: the real-gift ledger must survive the shared progress state.
 *
 * `normalizeProgressState()` rebuilds its return value from an explicit field
 * whitelist, and `saveProgressState()` writes back whatever it is handed. So a
 * field that is NOT on the whitelist is written to KV once, then silently
 * dropped the next time ANY endpoint does load -> mutate -> save.
 *
 * Before `gift_goal` / `redemptions` were whitelisted, a child could redeem a
 * 30.000 diamond football and then lose the entire redemption by simply
 * finishing one reading lesson: submit-read2lead-lesson.js loads the state
 * (ledger already stripped), adds coins, and saves the object back over the
 * top. The redemption vanished, the "one pending request" guard stopped
 * firing, and — worst — rejecting the request could no longer refund the
 * child, because the refund path finds the redemption by id inside
 * `state.redemptions`.
 *
 * These tests pin that down. They interleave a lesson-shaped save between the
 * gift calls, which is exactly what the gift endpoint tests do not do.
 */

const ACCESS_CODE = 'R2L-GIFT-PERSIST';

const CATALOG = [
  { id: 'sticker', name_vi: 'Sticker', emoji: '🌟', price_diamonds: 1000, limit_total: null, redeemed_count: 0, active: true },
  { id: 'football', name_vi: 'Quả bóng đá', emoji: '⚽', price_diamonds: 30000, limit_total: null, redeemed_count: 0, active: true },
];

function load(raw) {
  return normalizeProgressState(raw, { accessCode: ACCESS_CODE });
}

/** What every non-gift endpoint does: load, mutate something unrelated, save. */
function simulateLessonSubmit(rawInKv, { coinsEarned = 25 } = {}) {
  const state = load(rawInKv);
  const next = { ...state, coins: (state.coins || 0) + coinsEarned };
  return next; // saveProgressState writes this object verbatim
}

test('gift_goal survives a lesson submit', () => {
  const afterGoal = { ...load({ diamonds: 500 }), gift_goal: 'football' };

  const afterLesson = simulateLessonSubmit(afterGoal);

  assert.equal(afterLesson.gift_goal, 'football', 'the child\'s chosen goal must not be wiped by reading a lesson');
});

test('a pending redemption survives a lesson submit', () => {
  const start = { ...load({ diamonds: 30000 }), redemptions: [] };
  const { state: afterRedeem, redemption } = executeRedeem(start, CATALOG, 'football');
  assert.equal(afterRedeem.diamonds, 0);

  const afterLesson = simulateLessonSubmit(afterRedeem);

  assert.equal(afterLesson.redemptions.length, 1, 'the redemption ledger must not be wiped by reading a lesson');
  assert.equal(afterLesson.redemptions[0].id, redemption.id);
  assert.equal(afterLesson.redemptions[0].status, 'requested');
});

test('a rejection still refunds the child after a lesson submit', () => {
  const start = { ...load({ diamonds: 30000 }), redemptions: [] };
  const { state: afterRedeem, redemption } = executeRedeem(start, CATALOG, 'football');

  // The child reads a lesson while waiting for the teacher to act.
  const afterLesson = simulateLessonSubmit(afterRedeem);

  // The teacher can't source the football and rejects it.
  const { state: afterReject, error } = applyRedemptionStatus(afterLesson, redemption.id, 'rejected');

  assert.equal(error, undefined, 'reject must not fail — this is how a child gets their diamonds back');
  assert.equal(afterReject.diamonds, 30000, 'the child must be refunded in full');
  assert.equal(afterReject.redemptions[0].status, 'rejected');
});

test('the pending-request guard still fires after a lesson submit', () => {
  const start = { ...load({ diamonds: 40000 }), redemptions: [] };
  const { state: afterRedeem } = executeRedeem(start, CATALOG, 'football');

  const afterLesson = simulateLessonSubmit(afterRedeem);

  const { error } = executeRedeem(afterLesson, CATALOG, 'sticker');
  assert.equal(error, 'pending_request_exists', 'a child with a pending gift must not be able to redeem another');
});

test('redeeming leaves rank, xp and coins byte-identical', () => {
  const before = load({
    diamonds: 30000, coins: 1187, total_xp: 540, rank_points: 20, unlocked_parts: ['body-bluea'],
  });
  const { state: after } = executeRedeem({ ...before, redemptions: [] }, CATALOG, 'football');

  assert.equal(after.coins, before.coins, 'spending diamonds must never touch coins');
  assert.equal(after.total_xp, before.total_xp, 'spending diamonds must never touch XP');
  assert.equal(after.rank_points, before.rank_points, 'spending diamonds must never touch rank');
  assert.deepEqual(after.unlocked_parts, before.unlocked_parts, 'spending diamonds must never touch the monster shop');
  assert.equal(after.diamonds, 0);
});

test('the ledger and goal reach the client via publicProgressState', () => {
  const state = {
    ...load({ diamonds: 1000 }),
    gift_goal: 'sticker',
    redemptions: [{ id: 'gr_x', gift_id: 'sticker', name_vi: 'Sticker', price_diamonds: 1000, status: 'preparing', ts: '2026-07-13' }],
  };

  const publicState = publicProgressState(state);

  assert.equal(publicState.gift_goal, 'sticker', 'the UI needs the goal to draw the progress bar');
  assert.equal(publicState.redemptions.length, 1);
  assert.equal(publicState.redemptions[0].status, 'preparing');
});
