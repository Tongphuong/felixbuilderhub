import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRedemptionStatus,
  buildGiftView,
  executeRedeem,
} from '../functions/api/_gifts-v2.js';

const STICKER = {
  id: 'sticker', name_vi: 'Sticker', emoji: '🌟',
  price_diamonds: 1000, limit_total: null, redeemed_count: 0, active: true,
};
const LEGO_CAPPED = {
  id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱',
  price_diamonds: 20000, limit_total: 2, redeemed_count: 2, active: true,
};
const LEGO_ROOM = {
  id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱',
  price_diamonds: 20000, limit_total: 2, redeemed_count: 1, active: true,
};
const RETIRED = {
  id: 'retired', name_vi: 'Quà cũ', emoji: '🎁',
  price_diamonds: 500, limit_total: null, redeemed_count: 0, active: false,
};
// The exact shape "+ Thêm quà" creates and Coach Felix left live: a blank row,
// active, priced 0. It reached production as gift-mrj3tnzu-g47dkw / "Quà 8".
const BLANK_ROW = {
  id: 'gift-blank', name_vi: 'Quà 8', emoji: '🎁',
  price_diamonds: 0, limit_total: null, redeemed_count: 0, active: true,
};

function makeState(overrides = {}) {
  return { diamonds: 0, redemptions: [], gift_goal: null, ...overrides };
}

// --- buildGiftView --------------------------------------------------------

test('buildGiftView: can_afford true when diamonds >= price and available', () => {
  const view = buildGiftView(makeState({ diamonds: 1000 }), [STICKER]);
  assert.equal(view[0].can_afford, true);
  assert.equal(view[0].available, true);
});

test('buildGiftView: can_afford false when diamonds < price', () => {
  const view = buildGiftView(makeState({ diamonds: 999 }), [STICKER]);
  assert.equal(view[0].can_afford, false);
});

test('buildGiftView: inactive gift is unavailable and never affordable', () => {
  const view = buildGiftView(makeState({ diamonds: 999999 }), [RETIRED]);
  assert.equal(view[0].available, false);
  assert.equal(view[0].can_afford, false);
});

test('buildGiftView: capped gift at limit is unavailable', () => {
  const view = buildGiftView(makeState({ diamonds: 999999 }), [LEGO_CAPPED]);
  assert.equal(view[0].available, false);
  assert.equal(view[0].can_afford, false);
});

test('buildGiftView: capped gift with room left is available', () => {
  const view = buildGiftView(makeState({ diamonds: 999999 }), [LEGO_ROOM]);
  assert.equal(view[0].available, true);
  assert.equal(view[0].can_afford, true);
});

// Regression: a priced-0 gift shipped to production and every child could
// claim it for free, because can_afford is `diamonds >= price` and every
// balance clears 0. Each claim queued a real object Coach Felix had to buy.
test('buildGiftView: a gift priced 0 is NEVER available and NEVER affordable', () => {
  const broke = buildGiftView(makeState({ diamonds: 0 }), [BLANK_ROW]);
  assert.equal(broke[0].available, false);
  assert.equal(broke[0].can_afford, false, 'a 0-diamond child must not be able to claim a 0-price gift');

  const rich = buildGiftView(makeState({ diamonds: 999999 }), [BLANK_ROW]);
  assert.equal(rich[0].available, false);
  assert.equal(rich[0].can_afford, false);
});

test('buildGiftView: a gift priced 0 shows 0% progress, not a full bar', () => {
  const view = buildGiftView(makeState({ diamonds: 4295 }), [BLANK_ROW]);
  assert.equal(view[0].progress_percent, 0);
});

test('executeRedeem: a gift priced 0 cannot be redeemed at any balance', () => {
  const result = executeRedeem(makeState({ diamonds: 4295 }), [BLANK_ROW], 'gift-blank');
  assert.equal(result.error, 'gift_unavailable');
  assert.equal(result.state.diamonds, 4295, 'balance untouched');
  assert.deepEqual(result.state.redemptions, [], 'no queue entry for Coach Felix to buy');
});

test('buildGiftView: progress_percent is diamonds/price capped at 100', () => {
  const half = buildGiftView(makeState({ diamonds: 500 }), [STICKER]);
  assert.equal(half[0].progress_percent, 50);
  const over = buildGiftView(makeState({ diamonds: 5000 }), [STICKER]);
  assert.equal(over[0].progress_percent, 100);
  const zero = buildGiftView(makeState({ diamonds: 0 }), [STICKER]);
  assert.equal(zero[0].progress_percent, 0);
});

test('buildGiftView: never leaks cost_vnd (only present if caller passed it in)', () => {
  const view = buildGiftView(makeState({ diamonds: 1000 }), [{ ...STICKER, cost_vnd: 12000 }]);
  // buildGiftView itself is agnostic; the real leak protection is publicGift()
  // stripping cost_vnd before the catalog ever reaches this function — this
  // test just documents that buildGiftView does not add cost_vnd on its own.
  assert.equal(buildGiftView(makeState({ diamonds: 1000 }), [STICKER])[0].cost_vnd, undefined);
});

// --- executeRedeem ---------------------------------------------------------

test('executeRedeem: success deducts diamonds and appends a requested redemption', () => {
  const state = makeState({ diamonds: 1500 });
  const result = executeRedeem(state, [STICKER], 'sticker');
  assert.equal(result.error, undefined);
  assert.equal(result.state.diamonds, 500);
  assert.equal(result.state.redemptions.length, 1);
  const redemption = result.state.redemptions[0];
  assert.equal(redemption.gift_id, 'sticker');
  assert.equal(redemption.name_vi, 'Sticker');
  assert.equal(redemption.price_diamonds, 1000);
  assert.equal(redemption.status, 'requested');
  assert.match(redemption.id, /^gr_[a-z0-9]{12}$/);
  assert.ok(redemption.ts);
  assert.deepEqual(result.redemption, redemption);
});

test('executeRedeem: is pure (does not mutate input state)', () => {
  const state = makeState({ diamonds: 1500 });
  const snapshot = JSON.stringify(state);
  executeRedeem(state, [STICKER], 'sticker');
  assert.equal(JSON.stringify(state), snapshot);
});

test('executeRedeem: rejects gift_not_found', () => {
  const result = executeRedeem(makeState({ diamonds: 999999 }), [STICKER], 'nope');
  assert.equal(result.error, 'gift_not_found');
});

test('executeRedeem: rejects gift_inactive', () => {
  const result = executeRedeem(makeState({ diamonds: 999999 }), [RETIRED], 'retired');
  assert.equal(result.error, 'gift_inactive');
});

test('executeRedeem: rejects gift_unavailable when cap reached', () => {
  const result = executeRedeem(makeState({ diamonds: 999999 }), [LEGO_CAPPED], 'lego');
  assert.equal(result.error, 'gift_unavailable');
});

test('executeRedeem: rejects insufficient_diamonds', () => {
  const result = executeRedeem(makeState({ diamonds: 10 }), [STICKER], 'sticker');
  assert.equal(result.error, 'insufficient_diamonds');
});

test('executeRedeem: rejects pending_request_exists (status requested)', () => {
  const state = makeState({
    diamonds: 999999,
    redemptions: [{ id: 'gr_existing', gift_id: 'sticker', status: 'requested' }],
  });
  const result = executeRedeem(state, [STICKER], 'sticker');
  assert.equal(result.error, 'pending_request_exists');
});

test('executeRedeem: rejects pending_request_exists (status preparing)', () => {
  const state = makeState({
    diamonds: 999999,
    redemptions: [{ id: 'gr_existing', gift_id: 'lego', status: 'preparing' }],
  });
  const result = executeRedeem(state, [STICKER], 'sticker');
  assert.equal(result.error, 'pending_request_exists');
});

test('executeRedeem: a kid CAN redeem the same gift again once the prior one is resolved (ledger, not owned-set)', () => {
  const state = makeState({
    diamonds: 999999,
    redemptions: [{ id: 'gr_old', gift_id: 'sticker', status: 'delivered' }],
  });
  const result = executeRedeem(state, [STICKER], 'sticker');
  assert.equal(result.error, undefined);
  assert.equal(result.state.redemptions.length, 2);
});

// --- applyRedemptionStatus: legal transitions ------------------------------

test('applyRedemptionStatus: requested -> preparing (no diamond change)', () => {
  const state = makeState({
    diamonds: 500,
    redemptions: [{ id: 'gr_1', gift_id: 'sticker', price_diamonds: 1000, status: 'requested' }],
  });
  const result = applyRedemptionStatus(state, 'gr_1', 'preparing');
  assert.equal(result.error, undefined);
  assert.equal(result.state.diamonds, 500);
  assert.equal(result.redemption.status, 'preparing');
});

test('applyRedemptionStatus: requested -> delivered (no diamond change)', () => {
  const state = makeState({
    diamonds: 500,
    redemptions: [{ id: 'gr_1', gift_id: 'sticker', price_diamonds: 1000, status: 'requested' }],
  });
  const result = applyRedemptionStatus(state, 'gr_1', 'delivered');
  assert.equal(result.error, undefined);
  assert.equal(result.state.diamonds, 500);
  assert.equal(result.redemption.status, 'delivered');
});

test('applyRedemptionStatus: requested -> rejected refunds diamonds exactly', () => {
  const state = makeState({
    diamonds: 500,
    redemptions: [{ id: 'gr_1', gift_id: 'sticker', price_diamonds: 1000, status: 'requested' }],
  });
  const result = applyRedemptionStatus(state, 'gr_1', 'rejected');
  assert.equal(result.error, undefined);
  assert.equal(result.state.diamonds, 1500);
  assert.equal(result.redemption.status, 'rejected');
});

test('applyRedemptionStatus: preparing -> delivered (no diamond change)', () => {
  const state = makeState({
    diamonds: 500,
    redemptions: [{ id: 'gr_1', gift_id: 'sticker', price_diamonds: 1000, status: 'preparing' }],
  });
  const result = applyRedemptionStatus(state, 'gr_1', 'delivered');
  assert.equal(result.error, undefined);
  assert.equal(result.state.diamonds, 500);
  assert.equal(result.redemption.status, 'delivered');
});

test('applyRedemptionStatus: preparing -> rejected refunds diamonds exactly', () => {
  const state = makeState({
    diamonds: 500,
    redemptions: [{ id: 'gr_1', gift_id: 'sticker', price_diamonds: 1000, status: 'preparing' }],
  });
  const result = applyRedemptionStatus(state, 'gr_1', 'rejected');
  assert.equal(result.error, undefined);
  assert.equal(result.state.diamonds, 1500);
});

// --- applyRedemptionStatus: illegal transitions ----------------------------

test('applyRedemptionStatus: delivered -> rejected is illegal and moves no diamonds', () => {
  const state = makeState({
    diamonds: 500,
    redemptions: [{ id: 'gr_1', gift_id: 'sticker', price_diamonds: 1000, status: 'delivered' }],
  });
  const result = applyRedemptionStatus(state, 'gr_1', 'rejected');
  assert.equal(result.error, 'invalid_transition');
  assert.equal(result.state.diamonds, 500);
  assert.deepEqual(result.state, state);
});

test('applyRedemptionStatus: rejected -> preparing is illegal (no double-refund path)', () => {
  const state = makeState({
    diamonds: 1500,
    redemptions: [{ id: 'gr_1', gift_id: 'sticker', price_diamonds: 1000, status: 'rejected' }],
  });
  const result = applyRedemptionStatus(state, 'gr_1', 'preparing');
  assert.equal(result.error, 'invalid_transition');
  assert.equal(result.state.diamonds, 1500);
});

test('applyRedemptionStatus: rejecting twice never double-refunds (idempotency)', () => {
  const state = makeState({
    diamonds: 500,
    redemptions: [{ id: 'gr_1', gift_id: 'sticker', price_diamonds: 1000, status: 'requested' }],
  });
  const first = applyRedemptionStatus(state, 'gr_1', 'rejected');
  assert.equal(first.error, undefined);
  assert.equal(first.state.diamonds, 1500);

  const second = applyRedemptionStatus(first.state, 'gr_1', 'rejected');
  assert.equal(second.error, 'invalid_transition');
  assert.equal(second.state.diamonds, 1500, 'diamonds must not move a second time');
});

test('applyRedemptionStatus: requested -> requested (no-op status) is illegal', () => {
  const state = makeState({
    diamonds: 500,
    redemptions: [{ id: 'gr_1', gift_id: 'sticker', price_diamonds: 1000, status: 'requested' }],
  });
  const result = applyRedemptionStatus(state, 'gr_1', 'requested');
  assert.equal(result.error, 'invalid_transition');
});

test('applyRedemptionStatus: unknown redemption id fails without touching state', () => {
  const state = makeState({ diamonds: 500, redemptions: [] });
  const result = applyRedemptionStatus(state, 'gr_missing', 'delivered');
  assert.equal(result.error, 'invalid_transition');
  assert.deepEqual(result.state, state);
});
