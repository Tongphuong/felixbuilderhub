import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEASON_ID,
  HONORS_KV_KEY,
  freezeSeasonHonors,
  grantSeasonHonors,
  resolveKvNamespaceId,
  runCli,
} from '../scripts/grant-season-honors.mjs';
import { SEASON_WINDOW } from '../scripts/season-census.mjs';
import { progressKey, normalizeProgressState } from '../functions/api/_read2lead-v2-state.js';

/**
 * MOCKED KV ONLY — per the packet, this grant/pay script is never run
 * against production, a real KV namespace, or wrangler in this test file.
 * This in-memory Map stands in for READ2LEAD_CODES, exercising exactly the
 * list/get/put contract the script uses.
 */
function makeMockKv(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(key, options) {
      const raw = store.get(key);
      if (raw == null) return null;
      return options?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async list() {
      return {
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
        cursor: null,
      };
    },
    __store: store,
  };
}

/** Same mock, but put() throws — proves a dry run never writes anything. */
function makeThrowingPutKv(initialEntries = {}) {
  const kv = makeMockKv(initialEntries);
  kv.put = async () => {
    throw new Error('put() must never be called during a dry run');
  };
  return kv;
}

function seedCode(kv, accessCode, {
  studentName = 'Kid',
  lifetimeRp = 0,
  diamonds = 0,
  medals = [],
  isTest = false,
} = {}) {
  kv.__store.set(accessCode, JSON.stringify({
    ...(isTest ? { is_test: true } : {}),
    student_profile: { student_name: studentName },
  }));
  kv.__store.set(progressKey(accessCode), JSON.stringify({
    schema_version: 2,
    level_reset_version: 20260606,
    lifetime_rp: lifetimeRp,
    diamonds,
    medals,
  }));
}

/** Three podium-worthy kids with a clean rank order by lifetime_rp. */
function seedPodium(kv) {
  seedCode(kv, 'R2L-GOLD-0001', { studentName: 'Gold Kid', lifetimeRp: 90, diamonds: 10 });
  seedCode(kv, 'R2L-SILVER-0002', { studentName: 'Silver Kid', lifetimeRp: 60, diamonds: 5 });
  seedCode(kv, 'R2L-BRONZE-0003', { studentName: 'Bronze Kid', lifetimeRp: 30, diamonds: 0 });
  // Excluded, so it must never displace a real podium spot even though its
  // fake lifetime_rp would otherwise win rank 1.
  seedCode(kv, 'R2L-BOT-9999', { studentName: 'Bot', lifetimeRp: 99999, isTest: true });
}

test('SEASON_ID and HONORS_KV_KEY are the founder-approved 2026-S1 values', () => {
  assert.equal(SEASON_ID, '2026-S1');
  assert.equal(HONORS_KV_KEY, 'honors:2026-S1');
});

test('resolveKvNamespaceId: no hardcoded default, argv wins over env', () => {
  assert.equal(resolveKvNamespaceId({ argv: ['node', 'x.mjs'], env: {} }), null);
  assert.equal(
    resolveKvNamespaceId({ argv: ['node', 'x.mjs', '--namespace-id', 'abc'], env: { READ2LEAD_KV_NAMESPACE_ID: 'env-id' } }),
    'abc',
  );
  assert.equal(
    resolveKvNamespaceId({ argv: ['node', 'x.mjs'], env: { READ2LEAD_KV_NAMESPACE_ID: 'env-id' } }),
    'env-id',
  );
});

test('runCli REFUSES (no wrangler call, no write) when no namespace ID is supplied, even with --apply', async () => {
  const dry = await runCli({ argv: ['node', 'x.mjs'], env: {} });
  assert.equal(dry.ok, false);
  assert.equal(dry.error, 'missing_namespace_id');

  const withApply = await runCli({ argv: ['node', 'x.mjs', '--apply'], env: {} });
  assert.equal(withApply.ok, false);
  assert.equal(withApply.error, 'missing_namespace_id');
});

test('a first --apply run freezes the snapshot and pays exactly the podium (excluded kid never paid)', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const result = await grantSeasonHonors(env, { apply: true, seasonWindow: SEASON_WINDOW });

  assert.equal(result.ok, true);
  assert.equal(result.freeze_note, 'frozen_now');
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map((r) => r.masked_code), ['R2L-***0001', 'R2L-***0002', 'R2L-***0003']);
  assert.deepEqual(result.rows.map((r) => r.status), ['paid', 'paid', 'paid']);
  assert.deepEqual(result.rows.map((r) => r.prize_diamonds), [10000, 5000, 2000]);
  assert.equal(result.total_diamonds_paid, 10000 + 5000 + 2000);

  const gold = JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001')));
  assert.equal(gold.diamonds, 10 + 10000);
  assert.equal(gold.medals.length, 1);
  assert.equal(gold.medals[0].season_id, SEASON_ID);
  assert.equal(gold.medals[0].kind, 'honors');
  assert.equal(gold.medals[0].honors_rank, 1);
  assert.equal(gold.medals[0].reward_diamonds, 10000);

  // Snapshot was written and frozen, not published.
  const snapshot = JSON.parse(kv.__store.get(HONORS_KV_KEY));
  assert.equal(snapshot.season_id, SEASON_ID);
  assert.equal(snapshot.published, false);
  assert.equal(snapshot.podium.length, 3);
  assert.ok(snapshot.podium[0].paid_at, 'podium row must record paid_at once paid');
  assert.equal(snapshot.podium[0].diamonds_before, 10);
  assert.equal(snapshot.podium[0].diamonds_after, 10 + 10000);

  // The bot never got paid at all.
  const bot = JSON.parse(kv.__store.get(progressKey('R2L-BOT-9999')));
  assert.equal(bot.diamonds, 0);
  assert.equal((bot.medals || []).length, 0);
});

test('BAD-2 (double pay): running --apply twice reports already_paid the second time and the balance is numerically identical, not just unchanged-looking', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const first = await grantSeasonHonors(env, { apply: true, seasonWindow: SEASON_WINDOW });
  assert.equal(first.ok, true);
  const balancesAfterFirst = {
    gold: JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001'))).diamonds,
    silver: JSON.parse(kv.__store.get(progressKey('R2L-SILVER-0002'))).diamonds,
    bronze: JSON.parse(kv.__store.get(progressKey('R2L-BRONZE-0003'))).diamonds,
  };

  const second = await grantSeasonHonors(env, { apply: true, seasonWindow: SEASON_WINDOW });
  assert.equal(second.ok, true);
  assert.equal(second.freeze_note, 'honors_already_frozen', 'second run must not re-freeze — it reuses the existing snapshot');
  assert.deepEqual(second.rows.map((r) => r.status), ['already_paid', 'already_paid', 'already_paid']);
  assert.equal(second.total_diamonds_paid, 0, 'nothing new should be paid on the second run');

  const balancesAfterSecond = {
    gold: JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001'))).diamonds,
    silver: JSON.parse(kv.__store.get(progressKey('R2L-SILVER-0002'))).diamonds,
    bronze: JSON.parse(kv.__store.get(progressKey('R2L-BRONZE-0003'))).diamonds,
  };

  assert.equal(balancesAfterSecond.gold, balancesAfterFirst.gold, 'gold balance must be numerically equal across runs');
  assert.equal(balancesAfterSecond.silver, balancesAfterFirst.silver);
  assert.equal(balancesAfterSecond.bronze, balancesAfterFirst.bronze);
  // And each medal array still holds exactly one honors medal, not two.
  const gold = JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001')));
  assert.equal(gold.medals.filter((m) => m.season_id === SEASON_ID && m.kind === 'honors').length, 1);
});

test('BAD-3 (allow-list survival): the honors medal a live grant saved survives a normalizeProgressState() round-trip with kind and honors_rank intact', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  await grantSeasonHonors(env, { apply: true, seasonWindow: SEASON_WINDOW });

  const savedRaw = JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001')));
  const roundTripped = normalizeProgressState(savedRaw, { accessCode: 'R2L-GOLD-0001' });

  const honorsMedal = roundTripped.medals.find((m) => m.season_id === SEASON_ID && m.kind === 'honors');
  assert.ok(honorsMedal, 'honors medal must survive normalizeProgressState()');
  assert.equal(honorsMedal.kind, 'honors');
  assert.equal(honorsMedal.honors_rank, 1);
  assert.equal(honorsMedal.reward_diamonds, 10000);

  // NOTE (manual verification performed, not left in the committed code):
  // temporarily removed the `...(entry.kind === 'honors' ? { kind: 'honors' } : {})`
  // and `...(Number.isFinite(Number(entry.honors_rank)) ? { honors_rank: ... } : {})`
  // passthroughs from normalizeMedals() in functions/api/_read2lead-v2-state.js
  // and re-ran this exact test — it FAILED (`honorsMedal` was undefined,
  // since normalizeMedals() stripped kind/honors_rank on the round-trip).
  // Restoring the passthrough (git checkout of that file) made it pass
  // again. See the report to Elon for the full before/after output.
});

test('BAD-5 (freeze guards): freezing twice without --force returns exactly honors_already_frozen; --force after any paid_at is set returns exactly honors_already_paid', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  await freezeSeasonHonors(env, { seasonWindow: SEASON_WINDOW });
  await assert.rejects(
    () => freezeSeasonHonors(env, { seasonWindow: SEASON_WINDOW }),
    (err) => err.message === 'honors_already_frozen' && err.code === 'honors_already_frozen',
  );

  // force is fine while nothing has been paid yet.
  await assert.doesNotReject(() => freezeSeasonHonors(env, { seasonWindow: SEASON_WINDOW, force: true }));

  // Now actually pay, then force-refreezing must be refused.
  await grantSeasonHonors(env, { apply: true, seasonWindow: SEASON_WINDOW });
  await assert.rejects(
    () => freezeSeasonHonors(env, { seasonWindow: SEASON_WINDOW, force: true }),
    (err) => err.message === 'honors_already_paid' && err.code === 'honors_already_paid',
  );
});

test('BAD-6 (revoke is exact): pay then revoke returns the balance to the exact starting number and removes the medal', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const startingGold = JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001'))).diamonds;
  assert.equal(startingGold, 10);

  await grantSeasonHonors(env, { apply: true, seasonWindow: SEASON_WINDOW });
  const paidGold = JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001')));
  assert.equal(paidGold.diamonds, 10 + 10000);

  const revoked = await grantSeasonHonors(env, { apply: true, revoke: true, seasonWindow: SEASON_WINDOW });
  assert.equal(revoked.ok, true);
  assert.equal(revoked.action, 'revoke');
  assert.deepEqual(revoked.rows.map((r) => r.status), ['revoked', 'revoked', 'revoked']);

  const revokedGold = JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001')));
  assert.equal(revokedGold.diamonds, startingGold, 'diamonds must return to the exact starting number');
  assert.equal(revokedGold.medals.filter((m) => m.season_id === SEASON_ID && m.kind === 'honors').length, 0, 'the honors medal must be gone');
});

test('BAD-6b: revoke clamps at 0 rather than going negative when the kid already spent the prize', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  await grantSeasonHonors(env, { apply: true, seasonWindow: SEASON_WINDOW });

  // Bronze kid spent everything down to 1 diamond after being paid 2000.
  const bronze = JSON.parse(kv.__store.get(progressKey('R2L-BRONZE-0003')));
  bronze.diamonds = 1;
  kv.__store.set(progressKey('R2L-BRONZE-0003'), JSON.stringify(bronze));

  const revoked = await grantSeasonHonors(env, { apply: true, revoke: true, seasonWindow: SEASON_WINDOW });
  const bronzeRow = revoked.rows.find((r) => r.masked_code === 'R2L-***0003');
  assert.equal(bronzeRow.status, 'revoked');
  assert.equal(bronzeRow.diamonds_after, 0);

  const bronzeAfter = JSON.parse(kv.__store.get(progressKey('R2L-BRONZE-0003')));
  assert.equal(bronzeAfter.diamonds, 0, 'must clamp at 0, never go negative');
});

test('revoking a snapshot that was never paid reports not_paid and leaves diamonds untouched', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  await freezeSeasonHonors(env, { seasonWindow: SEASON_WINDOW }); // freeze only, no pay

  const revoked = await grantSeasonHonors(env, { apply: true, revoke: true, seasonWindow: SEASON_WINDOW });
  assert.deepEqual(revoked.rows.map((r) => r.status), ['not_paid', 'not_paid', 'not_paid']);
  const gold = JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001')));
  assert.equal(gold.diamonds, 10);
});

test('revoking with no snapshot at all reports honors_not_frozen and touches nothing', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const revoked = await grantSeasonHonors(env, { apply: true, revoke: true, seasonWindow: SEASON_WINDOW });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.error, 'honors_not_frozen');
});

test('BAD-7 (dry run writes nothing): the default (no apply) run against a KV whose put() throws still completes and produces a report', async () => {
  const kv = makeThrowingPutKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const result = await grantSeasonHonors(env, { seasonWindow: SEASON_WINDOW }); // apply defaults to false

  assert.equal(result.ok, true);
  assert.equal(result.apply, false);
  assert.equal(result.written, false);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map((r) => r.status), ['dry_run', 'dry_run', 'dry_run']);
  assert.deepEqual(result.rows.map((r) => r.diamonds_after), [10, 5, 0], 'dry run must report the balance UNCHANGED (no write happened)');

  // Nothing was actually persisted — no snapshot key exists in the store.
  assert.equal(kv.__store.has(HONORS_KV_KEY), false);
  const gold = JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001')));
  assert.equal(gold.diamonds, 10, 'dry run must not mutate a real diamond balance');
  assert.equal((gold.medals || []).length, 0);
});

test('BAD-7b: dry run against an ALREADY-frozen snapshot (from a prior apply run) also never calls put()', async () => {
  const applyKv = makeMockKv();
  seedPodium(applyKv);
  await grantSeasonHonors({ READ2LEAD_CODES: applyKv }, { apply: true, seasonWindow: SEASON_WINDOW });

  // Rehydrate a throwing-put KV from the applied store's contents, so the
  // snapshot + paid medals already exist, then run a plain dry run over it.
  const seeded = Object.fromEntries([...applyKv.__store.entries()].map(([k, v]) => [k, JSON.parse(v)]));
  const throwingKv = makeThrowingPutKv(seeded);
  const env = { READ2LEAD_CODES: throwingKv };

  const result = await grantSeasonHonors(env, { seasonWindow: SEASON_WINDOW }); // apply defaults to false
  assert.equal(result.ok, true);
  assert.equal(result.written, false);
  assert.deepEqual(result.rows.map((r) => r.status), ['already_paid', 'already_paid', 'already_paid']);
});

test('dry run report reads the way a non-technical founder can follow: per-winner prize + before/after, a total, and an explicit written/not-written line', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const result = await grantSeasonHonors(env, { seasonWindow: SEASON_WINDOW });
  for (const row of result.rows) {
    assert.ok(row.student_name, 'each row must carry a readable student name');
    assert.ok(row.masked_code.startsWith('R2L-***'), 'each row must carry a masked (not raw) code');
    assert.equal(typeof row.prize_diamonds, 'number');
    assert.equal(typeof row.diamonds_before, 'number');
    assert.equal(typeof row.diamonds_after, 'number');
  }
  assert.equal(result.written, false);
});

// --- podiumOverride (founder-confirmed podium, 2026-09-03 packet) ---------

test('BAD-8 (podium override refuses an excluded code): naming a bot/test/shared code is refused with exact podium_code_excluded and nothing is written', async () => {
  const kv = makeThrowingPutKv();
  seedPodium(kv); // R2L-BOT-9999 is seeded with is_test: true
  const env = { READ2LEAD_CODES: kv };

  const result = await grantSeasonHonors(env, {
    apply: true,
    seasonWindow: SEASON_WINDOW,
    podiumOverride: ['R2L-BOT-9999', 'R2L-GOLD-0001', 'R2L-SILVER-0002'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'podium_code_excluded');
  assert.equal(result.podium_code, 'R2L-BOT-9999');
  assert.equal(result.reason, 'is_test');
  // makeThrowingPutKv() proves this: if grantSeasonHonors had called put()
  // anywhere before refusing, this test would already have thrown.
});

test('BAD-9 (podium override refuses a nonexistent code): a code with no matching KV record is refused with exact podium_code_not_found', async () => {
  const kv = makeThrowingPutKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const result = await grantSeasonHonors(env, {
    apply: true,
    seasonWindow: SEASON_WINDOW,
    podiumOverride: ['R2L-GHOST-0000', 'R2L-GOLD-0001', 'R2L-SILVER-0002'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'podium_code_not_found');
  assert.equal(result.podium_code, 'R2L-GHOST-0000');
});

test('BAD-10 (podium override length/duplicate guards): wrong length is refused with exact podium_wrong_length; a duplicated code with exact podium_duplicate_code', async () => {
  const kv = makeThrowingPutKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const tooShort = await grantSeasonHonors(env, {
    apply: true,
    seasonWindow: SEASON_WINDOW,
    podiumOverride: ['R2L-GOLD-0001', 'R2L-SILVER-0002'],
  });
  assert.equal(tooShort.ok, false);
  assert.equal(tooShort.error, 'podium_wrong_length');

  const tooLong = await grantSeasonHonors(env, {
    apply: true,
    seasonWindow: SEASON_WINDOW,
    podiumOverride: ['R2L-GOLD-0001', 'R2L-SILVER-0002', 'R2L-BRONZE-0003', 'R2L-BOT-9999'],
  });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.error, 'podium_wrong_length');

  const duplicated = await grantSeasonHonors(env, {
    apply: true,
    seasonWindow: SEASON_WINDOW,
    podiumOverride: ['R2L-GOLD-0001', 'R2L-GOLD-0001', 'R2L-SILVER-0002'],
  });
  assert.equal(duplicated.ok, false);
  assert.equal(duplicated.error, 'podium_duplicate_code');
  assert.equal(duplicated.podium_code, 'R2L-GOLD-0001');
});

test('BAD-11 (the point of the packet): a valid override whose order DIFFERS from buildHonorsRanking\'s own order wins — podium follows the override, prizes map 10000/5000/2000 to positions 1/2/3', async () => {
  const kv = makeMockKv();
  seedPodium(kv); // natural lifetime_rp order is Gold(90) > Silver(60) > Bronze(30)
  const env = { READ2LEAD_CODES: kv };

  // Deliberately NOT the natural rp order — Bronze first, Gold second, Silver third.
  const result = await grantSeasonHonors(env, {
    apply: true,
    seasonWindow: SEASON_WINDOW,
    podiumOverride: ['R2L-BRONZE-0003', 'R2L-GOLD-0001', 'R2L-SILVER-0002'],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.rows.map((r) => [r.masked_code, r.prize_diamonds]),
    [
      ['R2L-***0003', 10000],
      ['R2L-***0001', 5000],
      ['R2L-***0002', 2000],
    ],
    'podium must follow the override order, not the lifetime_rp order',
  );
  assert.deepEqual(result.rows.map((r) => r.rank), [1, 2, 3]);

  // The paid balances/medals must match the override prizes, not the
  // default ranked prizes (which would have paid Gold 10000, not 5000).
  const gold = JSON.parse(kv.__store.get(progressKey('R2L-GOLD-0001')));
  assert.equal(gold.diamonds, 10 + 5000);
  assert.equal(gold.medals[0].honors_rank, 2);
  const bronze = JSON.parse(kv.__store.get(progressKey('R2L-BRONZE-0003')));
  assert.equal(bronze.diamonds, 0 + 10000);
  assert.equal(bronze.medals[0].honors_rank, 1);

  // Snapshot provenance is auditable: basis switches to the override value,
  // and honor_roll/excluded are still buildHonorsRanking()'s own output.
  const snapshot = JSON.parse(kv.__store.get(HONORS_KV_KEY));
  assert.equal(snapshot.basis, 'app_leaderboard_order');
  assert.equal(snapshot.basis_label_vi, 'Thứ hạng trên bảng xếp hạng');
  assert.ok(snapshot.basis_note && snapshot.basis_note.length > 0, 'basis_note must explain the override');
  assert.equal(snapshot.honor_roll.length, 3, 'honor_roll still comes from buildHonorsRanking() (3 real kids — the excluded bot is NOT in honor_roll)');
  assert.equal(snapshot.excluded.length, 1, 'excluded still comes from buildHonorsRanking() unchanged');
  // Each podium row still carries the computed fields for the record.
  for (const row of snapshot.podium) {
    assert.equal(typeof row.lifetime_rp, 'number');
    assert.equal(typeof row.completed_packs, 'number');
    assert.equal(typeof row.completed_books, 'number');
    assert.ok('pronunciation_percent' in row);
  }
});

test('BAD-12 (podium override dry run writes nothing): a valid override with apply:false still writes nothing (put throws if called)', async () => {
  const kv = makeThrowingPutKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const result = await grantSeasonHonors(env, {
    seasonWindow: SEASON_WINDOW, // apply defaults to false
    podiumOverride: ['R2L-BRONZE-0003', 'R2L-GOLD-0001', 'R2L-SILVER-0002'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.apply, false);
  assert.equal(result.written, false);
  assert.deepEqual(
    result.rows.map((r) => [r.masked_code, r.prize_diamonds]),
    [
      ['R2L-***0003', 10000],
      ['R2L-***0001', 5000],
      ['R2L-***0002', 2000],
    ],
  );
});

test('without podiumOverride, behaviour is exactly as today: ranked by buildHonorsRanking, default basis fields, no basis_note', async () => {
  const kv = makeMockKv();
  seedPodium(kv);
  const env = { READ2LEAD_CODES: kv };

  const result = await grantSeasonHonors(env, { apply: true, seasonWindow: SEASON_WINDOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((r) => r.masked_code), ['R2L-***0001', 'R2L-***0002', 'R2L-***0003']);
  assert.deepEqual(result.rows.map((r) => r.prize_diamonds), [10000, 5000, 2000]);

  const snapshot = JSON.parse(kv.__store.get(HONORS_KV_KEY));
  assert.equal(snapshot.basis, 'lifetime_rp');
  assert.equal(snapshot.basis_label_vi, 'Điểm xếp hạng toàn thời gian');
  assert.equal('basis_note' in snapshot, false, 'the default path must not gain a basis_note field');
});
