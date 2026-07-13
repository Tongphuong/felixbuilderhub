import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as giftsList } from '../functions/api/read2lead-gifts-list.js';
import { onRequestPost as giftsRedeem } from '../functions/api/read2lead-gifts-redeem.js';
import { onRequestPost as giftGoal } from '../functions/api/read2lead-gift-goal.js';
import { onRequestGet as redemptionsQueue } from '../functions/api/admin/gifts/redemptions.js';
import { onRequestPatch as redemptionPatch } from '../functions/api/admin/gifts/redemptions/[id].js';
import { loadProgressState, saveProgressState, progressKey } from '../functions/api/_read2lead-v2-state.js';
import { applyRedemptionStatus } from '../functions/api/_gifts-v2.js';
import { GIFT_STORE_KEY, loadGiftStore, saveGiftStore, normalizeGift } from '../functions/api/admin/_gifts.js';

const ACCESS_CODE = 'R2L-GIFT-W9';
const GIFT_QUEUE_KEY = 'admin:gift-redemptions:v1';

const CATALOG = [
  { id: 'sticker', name_vi: 'Sticker', emoji: '🌟', price_diamonds: 1000, limit_total: null, redeemed_count: 0, cost_vnd: 5000, active: true },
  { id: 'lego', name_vi: 'Bộ Lego', emoji: '🧱', price_diamonds: 20000, limit_total: 1, redeemed_count: 0, cost_vnd: 350000, active: true },
];

function makeEnv({ codeExists = true, progress = null, gifts = CATALOG, queue = [] } = {}) {
  const codeStore = new Map();
  codeStore.set(GIFT_STORE_KEY, JSON.stringify({ schema_version: 1, gifts }));
  codeStore.set(GIFT_QUEUE_KEY, JSON.stringify({ entries: queue }));

  const progressStore = new Map();
  if (progress) {
    progressStore.set(progressKey(ACCESS_CODE), JSON.stringify({
      schema_version: 2,
      level_reset_version: 20260606,
      rank_points: 9,
      ...progress,
    }));
  }

  const READ2LEAD_CODES = {
    async get(key, opts) {
      if (key === ACCESS_CODE) {
        if (!codeExists) return null;
        const data = { student_profile: { student_name: 'Linh' } };
        return opts?.type === 'json' ? data : JSON.stringify(data);
      }
      const raw = codeStore.get(key);
      if (!raw) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      codeStore.set(key, value);
    },
  };

  const READ2LEAD_PROGRESS = {
    async get(key, opts) {
      const raw = progressStore.get(key);
      if (!raw) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      progressStore.set(key, value);
    },
  };

  return { READ2LEAD_CODES, READ2LEAD_PROGRESS, __codeStore: codeStore, __progressStore: progressStore };
}

function post(handler, env, body) {
  return handler({
    request: new Request('https://example.com/api/read2lead-gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  });
}

function currentProgress(env) {
  return JSON.parse(env.__progressStore.get(progressKey(ACCESS_CODE)));
}

function currentGiftStore(env) {
  return JSON.parse(env.__codeStore.get(GIFT_STORE_KEY));
}

function currentQueue(env) {
  return JSON.parse(env.__codeStore.get(GIFT_QUEUE_KEY));
}

// Forces two "concurrent" progress-state loads to genuinely race: the first
// two get() calls for the access code's progress key both block until the
// second one arrives, so both handlers compute against the identical
// starting state — reproducing "two near-simultaneous redeems from the same
// kid both read the same starting state" without relying on incidental
// Promise-scheduling luck. Every read/write after that proceeds through
// real (unmodified) async KV timing.
function gateConcurrentProgressReads(env) {
  const kv = env.READ2LEAD_PROGRESS;
  const originalGet = kv.get.bind(kv);
  const targetKey = progressKey(ACCESS_CODE);
  let waiting = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  kv.get = async function gatedGet(key, opts) {
    if (key === targetKey) {
      waiting += 1;
      if (waiting >= 2) release();
      await gate;
    }
    return originalGet(key, opts);
  };
}

// --- gifts-list -------------------------------------------------------------

test('POST /gifts-list returns items + diamonds + redemptions + gift_goal, no cost_vnd', async () => {
  const env = makeEnv({ progress: { diamonds: 1500 } });
  const response = await post(giftsList, env, { code: ACCESS_CODE });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.diamonds, 1500);
  assert.deepEqual(payload.redemptions, []);
  assert.equal(payload.gift_goal, null);
  assert.ok(Array.isArray(payload.items));
  assert.equal(payload.items.length, 2);
  for (const item of payload.items) {
    assert.equal('cost_vnd' in item, false, 'cost_vnd must never reach the kid endpoint');
  }
  const sticker = payload.items.find((i) => i.id === 'sticker');
  assert.equal(sticker.can_afford, true);
  assert.equal(sticker.progress_percent, 100);
});

// --- gifts-redeem: validation -----------------------------------------------

test('POST /gifts-redeem 400 missing_code', async () => {
  const env = makeEnv();
  const response = await post(giftsRedeem, env, { gift_id: 'sticker' });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'missing_code');
});

test('POST /gifts-redeem 400 missing_gift_id', async () => {
  const env = makeEnv();
  const response = await post(giftsRedeem, env, { code: ACCESS_CODE });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'missing_gift_id');
});

test('POST /gifts-redeem 404 code_not_found', async () => {
  const env = makeEnv({ codeExists: false });
  const response = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' });
  const payload = await response.json();
  assert.equal(response.status, 404);
  assert.equal(payload.error, 'code_not_found');
});

test('POST /gifts-redeem 400 insufficient_diamonds', async () => {
  const env = makeEnv({ progress: { diamonds: 10 } });
  const response = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'insufficient_diamonds');
});

test('POST /gifts-redeem 400 gift_unavailable when the budget cap is reached (no inventory wording)', async () => {
  const env = makeEnv({
    progress: { diamonds: 999999 },
    gifts: [{ ...CATALOG[1], redeemed_count: 1 }], // limit_total 1, already at cap
  });
  const response = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'lego' });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'gift_unavailable');
  assert.match(payload.message, /tạm thời không đổi được/);
  assert.doesNotMatch(payload.message, /hết hàng|stock|kho/i);
});

test('POST /gifts-redeem success deducts diamonds, increments redeemed_count, queues an entry', async () => {
  const env = makeEnv({ progress: { diamonds: 1500 } });
  const response = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.diamonds, 500);
  assert.equal(payload.redemption.status, 'requested');
  assert.equal(payload.redemption.gift_id, 'sticker');

  const savedProgress = currentProgress(env);
  assert.equal(savedProgress.diamonds, 500);
  assert.equal(savedProgress.redemptions.length, 1);

  const savedGifts = currentGiftStore(env);
  assert.equal(savedGifts.gifts.find((g) => g.id === 'sticker').redeemed_count, 1);

  const queue = currentQueue(env);
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].code, ACCESS_CODE);
  assert.equal(queue.entries[0].gift_id, 'sticker');
  assert.equal(queue.entries[0].student_name, 'Linh');
  assert.equal(queue.entries[0].status, 'requested');
});

test('POST /gifts-redeem blocks a second pending request while one is outstanding', async () => {
  const env = makeEnv({ progress: { diamonds: 999999 } });
  const first = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' });
  assert.equal(first.status, 200);

  const second = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' });
  const payload = await second.json();
  assert.equal(second.status, 400);
  assert.equal(payload.error, 'pending_request_exists');

  // Diamonds must not have moved a second time.
  assert.equal(currentProgress(env).diamonds, 999999 - 1000);
});

// --- Fix 2: two near-simultaneous redeems off the same starting state -------

test('two concurrent redeems from one kid off the same starting state never leave the child debited with no queue entry the founder can see', async () => {
  // Exactly one sticker's price: a naive race (no fix) would let both
  // requests compute independently against diamonds=1000 and both succeed,
  // each thinking it's the only one.
  const env = makeEnv({ progress: { diamonds: 1000 } });
  gateConcurrentProgressReads(env);

  await Promise.all([
    post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' }),
    post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' }),
  ]);

  const finalProgress = currentProgress(env);
  const finalQueue = currentQueue(env);

  // Diamonds are never double-spent, and the ledger never ends up with two
  // redemptions from a single starting balance that could only afford one.
  assert.ok(
    finalProgress.diamonds === 0 || finalProgress.diamonds === 1000,
    `diamonds must reflect exactly zero or one debit, got ${finalProgress.diamonds}`,
  );
  assert.ok(finalProgress.redemptions.length <= 1, 'the ledger must not end up with two redemptions from one 1000-diamond balance');

  if (finalProgress.diamonds === 0) {
    // The child WAS debited for the one redemption that survived the race.
    // The invariant that matters: the founder must be able to see it.
    assert.equal(finalProgress.redemptions.length, 1);
    const survivingId = finalProgress.redemptions[0].id;
    assert.ok(
      finalQueue.entries.some((entry) => entry.redemption_id === survivingId),
      'a child must never be debited for a gift the founder cannot see in the queue',
    );
  }
});

test('Fix 2b write order: dying between the queue write and the diamond debit leaves the recoverable failure mode (queue entry, no debit) — not the unrecoverable one', async () => {
  const env = makeEnv({ progress: { diamonds: 1500 } });
  // Simulate the process dying the instant after the queue write lands,
  // before the progress-state (diamond debit) write is attempted.
  env.READ2LEAD_PROGRESS.put = async () => {
    throw new Error('simulated crash: died before the progress-state write landed');
  };

  await assert.rejects(post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' }));

  // The queue entry landed (it's written first)...
  const queue = currentQueue(env);
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].gift_id, 'sticker');
  assert.equal(queue.entries[0].status, 'requested');

  // ...but the child was never actually debited: the progress state in KV
  // is still exactly what it was before this request. This is the
  // recoverable failure mode — the founder finds a queue entry, discovers
  // (via Fix 3's ghost handling once loadProgressState no longer finds a
  // matching ledger entry) that nothing was actually taken, and clears it.
  const codeData = await env.READ2LEAD_CODES.get(ACCESS_CODE, { type: 'json' });
  const stateAfterCrash = await loadProgressState(env, ACCESS_CODE, codeData);
  assert.equal(stateAfterCrash.diamonds, 1500, 'no debit ever landed');
  assert.equal(stateAfterCrash.redemptions.length, 0, 'no ledger entry was ever written');
});

// --- full lifecycle: redeem -> preparing -> delivered -----------------------

test('lifecycle: redeem -> preparing -> delivered leaves diamonds spent, ledger + queue in sync', async () => {
  const env = makeEnv({ progress: { diamonds: 1500, rank_points: 9, total_xp: 100, coins: 42, unlocked_parts: ['a'] } });

  const redeemRes = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' });
  const redeemPayload = await redeemRes.json();
  assert.equal(redeemRes.status, 200);
  const redemptionId = redeemPayload.redemption.id;

  const preparingRes = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'preparing' }),
    }),
    env,
    params: { id: redemptionId },
  });
  const preparingPayload = await preparingRes.json();
  assert.equal(preparingRes.status, 200);
  assert.equal(preparingPayload.redemption.status, 'preparing');
  assert.equal(currentProgress(env).diamonds, 500, 'diamonds unchanged by preparing');

  const deliveredRes = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'delivered' }),
    }),
    env,
    params: { id: redemptionId },
  });
  const deliveredPayload = await deliveredRes.json();
  assert.equal(deliveredRes.status, 200);
  assert.equal(deliveredPayload.redemption.status, 'delivered');

  const finalProgress = currentProgress(env);
  assert.equal(finalProgress.diamonds, 500, 'diamonds stay spent — a delivered gift is a real purchase');
  assert.equal(finalProgress.redemptions[0].status, 'delivered');
  // The consumed budget-cap slot is NOT restored on delivery (real money was spent).
  assert.equal(currentGiftStore(env).gifts.find((g) => g.id === 'sticker').redeemed_count, 1);
  assert.equal(currentQueue(env).entries[0].status, 'delivered');

  // Diamonds are isolated from progression — untouched throughout.
  assert.equal(finalProgress.rank_points, 9);
  assert.equal(finalProgress.total_xp, 100);
  assert.equal(finalProgress.coins, 42);
  assert.deepEqual(finalProgress.unlocked_parts, ['a']);
});

// --- full lifecycle: redeem -> rejected -> refunded -------------------------

test('lifecycle: redeem -> rejected refunds diamonds exactly and restores the cap', async () => {
  const env = makeEnv({
    progress: { diamonds: 999999 },
    gifts: [{ ...CATALOG[1], redeemed_count: 0 }], // lego, limit_total 1
  });

  const redeemRes = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'lego' });
  const redeemPayload = await redeemRes.json();
  assert.equal(redeemRes.status, 200);
  assert.equal(currentProgress(env).diamonds, 999999 - 20000);
  assert.equal(currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count, 1);

  const redemptionId = redeemPayload.redemption.id;
  const rejectRes = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    }),
    env,
    params: { id: redemptionId },
  });
  const rejectPayload = await rejectRes.json();
  assert.equal(rejectRes.status, 200);
  assert.equal(rejectPayload.redemption.status, 'rejected');

  assert.equal(currentProgress(env).diamonds, 999999, 'exact refund, not an approximation');
  assert.equal(
    currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count,
    0,
    'the budget cap slot is restored',
  );
  assert.equal(currentQueue(env).entries[0].status, 'rejected');

  // A second reject attempt on an already-rejected redemption is now a safe,
  // idempotent no-op (Fix 3: the ledger already reflects 'rejected', so the
  // PATCH converges instead of 400ing) — it must still NOT double-refund or
  // double-restore. See the dedicated crash-recovery test below for why this
  // changed from a 400 to a converged 200.
  const secondReject = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    }),
    env,
    params: { id: redemptionId },
  });
  const secondPayload = await secondReject.json();
  assert.equal(secondReject.status, 200);
  assert.equal(secondPayload.ok, true);
  assert.equal(currentProgress(env).diamonds, 999999, 'no double refund');
  assert.equal(currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count, 0, 'no double restore');
});

// --- Fix 3: illegal transitions must still be refused ------------------------

test('PATCH redemption still refuses delivered -> rejected end-to-end and moves no diamonds (Fix 3 must not weaken this)', async () => {
  const env = makeEnv({ progress: { diamonds: 1500 } });
  const redeemPayload = await (await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' })).json();
  const redemptionId = redeemPayload.redemption.id;

  await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'preparing' }),
    }),
    env,
    params: { id: redemptionId },
  });
  await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'delivered' }),
    }),
    env,
    params: { id: redemptionId },
  });
  assert.equal(currentProgress(env).diamonds, 500, 'delivered — diamonds stay spent');

  const rejectAttempt = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    }),
    env,
    params: { id: redemptionId },
  });
  const payload = await rejectAttempt.json();
  assert.equal(rejectAttempt.status, 400, 'delivered -> rejected must still be refused');
  assert.equal(payload.error, 'invalid_transition');
  assert.equal(currentProgress(env).diamonds, 500, 'no diamonds move on a refused transition');
  assert.equal(
    currentGiftStore(env).gifts.find((g) => g.id === 'sticker').redeemed_count,
    1,
    'no redeemed_count restore on a refused transition',
  );
  assert.equal(currentQueue(env).entries[0].status, 'delivered', 'queue index unchanged by a refused transition');
});

// --- Fix 3: self-healing after a crash between the ledger write and the ------
// --- gift-store/queue-index writes that follow it ---------------------------

test('PATCH redemption converges (instead of 400ing) when retried after a crash between the ledger write and the gift-store/queue writes', async () => {
  const env = makeEnv({
    progress: { diamonds: 999999 },
    gifts: [{ ...CATALOG[1], redeemed_count: 0 }], // lego, limit_total 1
  });

  const redeemPayload = await (await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'lego' })).json();
  const redemptionId = redeemPayload.redemption.id;
  assert.equal(currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count, 1);

  // Simulate the crash: apply step 1 (the ledger transition + diamond
  // refund) exactly like the PATCH handler's own "fresh transition" branch
  // does, then stop — as if the process died right after this KV write
  // landed, before the gift-store restore or the queue-index update ran.
  const codeData = await env.READ2LEAD_CODES.get(ACCESS_CODE, { type: 'json' });
  const stateBeforeCrash = await loadProgressState(env, ACCESS_CODE, codeData);
  const { state: crashedState, error } = applyRedemptionStatus(stateBeforeCrash, redemptionId, 'rejected');
  assert.equal(error, undefined);
  await saveProgressState(env, ACCESS_CODE, crashedState);

  assert.equal(currentProgress(env).diamonds, 999999, 'step 1 already refunded the diamonds');
  assert.equal(
    currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count,
    1,
    'step 2 has NOT run yet — this is the simulated crash',
  );
  assert.equal(currentQueue(env).entries[0].status, 'requested', 'step 3 has NOT run yet either');

  // Retry: the same PATCH a client-side retry (or the founder clicking
  // again) would send.
  const retryRes = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    }),
    env,
    params: { id: redemptionId },
  });
  const retryPayload = await retryRes.json();
  assert.equal(retryRes.status, 200, 'must converge, not 400, when the ledger already reflects the requested status');
  assert.equal(retryPayload.ok, true);

  assert.equal(currentProgress(env).diamonds, 999999, 'diamonds must not move a second time');
  assert.equal(
    currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count,
    0,
    'the retry finishes the job: the redeemed_count restore the crash skipped',
  );
  assert.equal(currentQueue(env).entries[0].status, 'rejected', 'the queue index also converges');

  // A third call (now fully converged) must still be a safe no-op.
  const thirdRes = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    }),
    env,
    params: { id: redemptionId },
  });
  assert.equal(thirdRes.status, 200, 'a fully-converged retry must also succeed idempotently, not error');
  assert.equal(currentProgress(env).diamonds, 999999, 'still no double refund on a 3rd call');
  assert.equal(
    currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count,
    0,
    'still no double restore on a 3rd call',
  );
});

// --- Finding 1 (Buffet MEDIUM): redeemed_count restore must be idempotent --
// --- independent of the queue-index write, not just the ledger write ------

// Uses limit_total: 2 with BOTH slots consumed by two different kids, per
// Buffet's own repro: with only one redemption outstanding, Math.max(0, …)
// clamps a double-decrement (1 -> 0 -> 0) to the same value a single,
// correct decrement produces, silently hiding the bug. With two outstanding,
// a double-decrement (2 -> 0) is distinguishable from the correct single
// decrement (2 -> 1) that must leave the second kid's slot untouched.
test('PATCH redemption does not double-decrement redeemed_count when retried after a crash between the redeemed_count restore and the queue-index write (limit_total 2, two kids outstanding)', async () => {
  const KID_B_CODE = 'R2L-GIFT-KIDB';
  const env = makeEnv({
    progress: { diamonds: 999999 },
    gifts: [{ ...CATALOG[1], limit_total: 2, redeemed_count: 0 }], // lego, cap 2
  });
  env.__codeStore.set(KID_B_CODE, JSON.stringify({ student_profile: { student_name: 'Kid B' } }));
  env.__progressStore.set(progressKey(KID_B_CODE), JSON.stringify({
    schema_version: 2, level_reset_version: 20260606, diamonds: 999999,
  }));

  const kidAPayload = await (await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'lego' })).json();
  const kidARedemptionId = kidAPayload.redemption.id;
  await post(giftsRedeem, env, { code: KID_B_CODE, gift_id: 'lego' });
  assert.equal(currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count, 2, 'both slots consumed');
  // The queue is append-to-front (newest first), so kid A's row is NOT
  // entries[0] — look it up by redemption_id like the founder's admin UI
  // would, rather than assuming array position.
  const kidAQueueRow = () => currentQueue(env).entries.find((e) => e.redemption_id === kidARedemptionId);

  // Simulate the crash: apply everything a fully successful "reject" of
  // KID A's redemption does UP TO (but not including) the queue-index
  // write — the ledger transition + diamond refund + cap_restored stamp,
  // AND the redeemed_count decrement — then stop, as if the process died
  // right before the queue-index PUT (the write Buffet's finding calls out
  // as the documented failure point). Kid B's slot must never be touched.
  const codeData = await env.READ2LEAD_CODES.get(ACCESS_CODE, { type: 'json' });
  const stateBeforeCrash = await loadProgressState(env, ACCESS_CODE, codeData);
  const { state: transitioned, error } = applyRedemptionStatus(stateBeforeCrash, kidARedemptionId, 'rejected');
  assert.equal(error, undefined);

  const giftStoreBeforeCrash = await loadGiftStore(env);
  const decrementedGifts = giftStoreBeforeCrash.gifts.map((g) =>
    (g.id === 'lego' ? { ...g, redeemed_count: Math.max(0, (g.redeemed_count || 0) - 1) } : g));
  await saveGiftStore(env, { ...giftStoreBeforeCrash, gifts: decrementedGifts });

  const stampedRedemptions = transitioned.redemptions.map((r) =>
    (r.id === kidARedemptionId ? { ...r, cap_restored: true } : r));
  await saveProgressState(env, ACCESS_CODE, { ...transitioned, redemptions: stampedRedemptions });

  // Confirm the simulated crash state: refund + decrement + stamp all
  // landed for Kid A, but the queue index is still stuck on the pre-crash
  // status.
  assert.equal(currentProgress(env).diamonds, 999999, 'diamonds already refunded by the simulated crash');
  assert.equal(currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count, 1, 'kid A\'s slot already restored — kid B\'s is still outstanding');
  assert.equal(kidAQueueRow().status, 'requested', 'the queue-index write is the one thing that never ran');

  // Retry: the same PATCH a client-side retry (or the founder clicking
  // again) would send.
  const retryRes = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${kidARedemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    }),
    env,
    params: { id: kidARedemptionId },
  });
  assert.equal(retryRes.status, 200, 'must converge, not 400');
  assert.equal(currentProgress(env).diamonds, 999999, 'diamonds must not move a second time');
  assert.equal(
    currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count,
    1,
    'redeemed_count must land at exactly 1 (kid B still outstanding) — a double-decrement to 0 would wrongly free kid B\'s consumed slot too',
  );
  assert.equal(kidAQueueRow().status, 'rejected', 'the retry finishes the one thing the crash actually skipped');

  // A third call remains a safe no-op.
  const thirdRes = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${kidARedemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    }),
    env,
    params: { id: kidARedemptionId },
  });
  assert.equal(thirdRes.status, 200);
  assert.equal(currentProgress(env).diamonds, 999999, 'still no double refund on a 3rd call');
  assert.equal(currentGiftStore(env).gifts.find((g) => g.id === 'lego').redeemed_count, 1, 'still exactly 1 on a 3rd call');
});

test('PATCH redemption self-heals a ghost queue entry (no matching ledger entry) instead of 400ing forever', async () => {
  const env = makeEnv({ progress: { diamonds: 1500 } });
  const redeemPayload = await (await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' })).json();
  const redemptionId = redeemPayload.redemption.id;

  // Simulate the losing half of the Fix 2 race: the queue entry exists, but
  // this redemption id was never actually persisted into the child's
  // ledger (as if a concurrent redeem's progress-state write clobbered it).
  const progress = JSON.parse(env.__progressStore.get(progressKey(ACCESS_CODE)));
  progress.redemptions = [];
  env.__progressStore.set(progressKey(ACCESS_CODE), JSON.stringify(progress));

  const response = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'preparing' }),
    }),
    env,
    params: { id: redemptionId },
  });
  const payload = await response.json();
  assert.equal(response.status, 200, 'a ghost entry must not 400 forever');
  assert.equal(payload.ok, true);
  assert.equal(payload.ghost, true);

  // Nothing moves — there was never a real debit to refund or a real
  // redeemed_count slot to restore.
  assert.equal(currentProgress(env).diamonds, 500, 'unchanged — the diamonds were never actually refundable here');
  assert.equal(currentGiftStore(env).gifts.find((g) => g.id === 'sticker').redeemed_count, 1, 'unchanged');

  // The queue entry is marked so the founder can see and clear it, and a
  // retry converges rather than erroring again.
  assert.equal(currentQueue(env).entries[0].ledger_missing, true);
  const retry = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'preparing' }),
    }),
    env,
    params: { id: redemptionId },
  });
  assert.equal(retry.status, 200, 'retrying on an already-marked ghost must also converge, not error');
});

test('PATCH redemption 400 on an unknown status value', async () => {
  const env = makeEnv({ progress: { diamonds: 999999 } });
  const redeemRes = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' });
  const { redemption } = await redeemRes.json();
  const response = await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemption.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'shipped' }),
    }),
    env,
    params: { id: redemption.id },
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'invalid_status');
});

test('PATCH redemption 404 for an id not in the queue', async () => {
  const env = makeEnv();
  const response = await redemptionPatch({
    request: new Request('https://example.com/api/admin/gifts/redemptions/gr_ghost', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'delivered' }),
    }),
    env,
    params: { id: 'gr_ghost' },
  });
  const payload = await response.json();
  assert.equal(response.status, 404);
  assert.equal(payload.error, 'redemption_not_found');
});

// --- gift goal ---------------------------------------------------------------

test('POST /gift-goal sets and clears the chosen goal, and never wipes the redemption ledger', async () => {
  const env = makeEnv({ progress: { diamonds: 1500 } });

  // Redeem first so the ledger is non-empty.
  await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' });
  assert.equal(currentProgress(env).redemptions.length, 1);

  const setRes = await post(giftGoal, env, { code: ACCESS_CODE, gift_id: 'lego' });
  const setPayload = await setRes.json();
  assert.equal(setRes.status, 200);
  assert.equal(setPayload.gift_goal, 'lego');
  assert.equal(
    currentProgress(env).redemptions.length,
    1,
    'setting a gift goal must not silently drop the redemption ledger',
  );

  const clearRes = await post(giftGoal, env, { code: ACCESS_CODE, gift_id: null });
  const clearPayload = await clearRes.json();
  assert.equal(clearRes.status, 200);
  assert.equal(clearPayload.gift_goal, null);
  assert.equal(currentProgress(env).redemptions.length, 1);
});

test('POST /gift-goal 400 gift_not_found for an unknown gift id', async () => {
  const env = makeEnv({ progress: { diamonds: 0 } });
  const response = await post(giftGoal, env, { code: ACCESS_CODE, gift_id: 'not-a-real-gift' });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'gift_not_found');
});

// --- Finding 2 (Buffet HIGH, backend half): a child must never be able to --
// --- pin a gift goal they can never get ------------------------------------

test('POST /gift-goal 400 gift_unavailable for an inactive gift, and does not set the goal', async () => {
  const env = makeEnv({
    progress: { diamonds: 999999, gift_goal: null },
    gifts: [{ ...CATALOG[1], active: false }], // lego, toggled off
  });
  const response = await post(giftGoal, env, { code: ACCESS_CODE, gift_id: 'lego' });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'gift_unavailable');
  assert.match(payload.message, /chưa đổi được/);
  assert.equal(currentProgress(env).gift_goal, null, 'a rejected goal must never be persisted');
});

test('POST /gift-goal 400 gift_unavailable for a gift whose budget cap is exhausted', async () => {
  const env = makeEnv({
    progress: { diamonds: 999999, gift_goal: null },
    gifts: [{ ...CATALOG[1], limit_total: 1, redeemed_count: 1 }], // lego, cap reached
  });
  const response = await post(giftGoal, env, { code: ACCESS_CODE, gift_id: 'lego' });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'gift_unavailable');
  assert.equal(currentProgress(env).gift_goal, null);
});

test('POST /gift-goal succeeds for an available (active, uncapped) gift', async () => {
  const env = makeEnv({ progress: { diamonds: 999999 } });
  const response = await post(giftGoal, env, { code: ACCESS_CODE, gift_id: 'lego' });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.gift_goal, 'lego');
  assert.equal(currentProgress(env).gift_goal, 'lego');
});

test('POST /gift-goal rejecting a re-set of an already-pinned, now-unavailable goal leaves the stored goal untouched (never nulled)', async () => {
  // Goal set while the gift was still available.
  const env = makeEnv({ progress: { diamonds: 999999, gift_goal: 'lego' } });
  const giftStore = await loadGiftStore(env);
  const nextGifts = giftStore.gifts.map((g) => (g.id === 'lego' ? { ...g, active: false } : g));
  await saveGiftStore(env, { ...giftStore, gifts: nextGifts });

  // The child's client re-POSTs the same (now-unavailable) goal — this must
  // be refused like any other attempt to set an unavailable goal, and the
  // refusal must not silently wipe the goal already on record. Only Steve's
  // UI, acting on the child's own choice, may ever change it from here.
  const response = await post(giftGoal, env, { code: ACCESS_CODE, gift_id: 'lego' });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'gift_unavailable');
  assert.equal(currentProgress(env).gift_goal, 'lego', 'the existing pinned goal must survive a refused re-set, not be nulled');
});

// --- admin redemptions queue --------------------------------------------------

test('GET /admin/gifts/redemptions groups by status and totals this-month cost_vnd', async () => {
  const env = makeEnv({ progress: { diamonds: 1500 } });
  const redeemPayload = await (await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'sticker' })).json();
  const redemptionId = redeemPayload.redemption.id;

  await redemptionPatch({
    request: new Request(`https://example.com/api/admin/gifts/redemptions/${redemptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'preparing' }),
    }),
    env,
    params: { id: redemptionId },
  });

  const response = await redemptionsQueue({ env });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.groups.preparing.length, 1);
  assert.equal(payload.groups.requested.length, 0);
  assert.equal(payload.groups.preparing[0].cost_vnd, 5000);
  assert.ok(Number.isInteger(payload.groups.preparing[0].days_waiting));
  assert.equal(payload.total_cost_vnd_this_month, 5000);
});

/**
 * The admin queue index is written BEFORE the child's diamonds are debited, on
 * purpose: a queue row with no debit costs nobody anything, but a debit with no
 * queue row would mean a child paid for a gift the founder never learns to buy.
 *
 * The price of that choice is the phantom row — if the debit never lands, the
 * founder sees a request that looks exactly like a real one and goes out and
 * buys a football for a child who was never charged. So the queue must verify
 * every OPEN row against the child's own ledger (the source of truth) and tell
 * the founder which ones were actually paid for.
 */
test('the queue flags a phantom row the child was never charged for', async () => {
  const env = makeEnv({
    progress: { diamonds: 30000, redemptions: [] }, // ledger has NO redemption
    queue: [{
      redemption_id: 'gr_phantom', code: ACCESS_CODE, student_name: 'Linh',
      gift_id: 'lego', name_vi: 'Bộ Lego', price_diamonds: 20000,
      status: 'requested', ts: new Date().toISOString(),
    }],
  });

  const res = await redemptionsQueue({ env });
  const payload = await res.json();

  assert.equal(payload.ok, true);
  const row = payload.groups.requested[0];
  assert.equal(row.diamonds_taken, false, 'the founder must be warned before he buys a Lego nobody paid for');
});

test('a genuine request is not falsely flagged as unpaid', async () => {
  const env = makeEnv({ progress: { diamonds: 30000, redemptions: [] } });

  const redeemRes = await post(giftsRedeem, env, { code: ACCESS_CODE, gift_id: 'lego' });
  const redeemed = await redeemRes.json();
  assert.equal(redeemed.ok, true);

  const res = await redemptionsQueue({ env });
  const payload = await res.json();

  const row = payload.groups.requested.find((item) => item.redemption_id === redeemed.redemption.id);
  assert.equal(row.diamonds_taken, true, 'a real, paid-for redemption must never be flagged as a phantom');
  assert.equal(currentProgress(env).diamonds, 10000, 'and the child really was debited');
});

// --- Delete frees gift ids for reuse; a new gift must never inherit one -----
// Buffet, LOW-MEDIUM. While gifts could only ever be ADDED, deriving a new
// row's id from a slug of its name was harmless. Delete changes that: remove
// "Sticker" (id `sticker`) while a child's redemption for it is still in the
// queue, add a new gift also called "Sticker", and the old redemption's
// thumbnail — and its budget-cap restore on reject — would silently resolve
// against the NEW gift.
test('normalizeGift: a new row never inherits a deleted gift id from its name', () => {
  const readded = normalizeGift({ id: '', name_vi: 'Sticker', price_diamonds: 1000, active: true });
  assert.notEqual(readded.id, 'sticker', 'a re-added "Sticker" must not reclaim the id `sticker`');
  assert.match(readded.id, /^gift-/, 'it gets a fresh random id instead');
});

test('normalizeGift: a gift already in KV keeps its own id', () => {
  const seeded = normalizeGift({ id: 'sticker', name_vi: 'Sticker', price_diamonds: 1000, active: true });
  assert.equal(seeded.id, 'sticker', 'nothing already saved may be orphaned by the fix above');
});
