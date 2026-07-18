import test from 'node:test';
import assert from 'node:assert/strict';

import {
  convertCoinsToDiamonds,
  resolveKvNamespaceId,
  runCli,
} from '../scripts/convert-coins-to-diamonds.mjs';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

/**
 * MOCKED KV ONLY — per the packet, this migration script is never run against
 * production or any real KV namespace here. This in-memory Map stands in for
 * the READ2LEAD_CODES namespace, exercising exactly the list/get/put contract
 * the script uses.
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

function seedCode(kv, accessCode, { coins = 0, diamonds = 0, studentName = 'Kid' } = {}) {
  kv.__store.set(accessCode, JSON.stringify({ student_profile: { student_name: studentName } }));
  kv.__store.set(progressKey(accessCode), JSON.stringify({
    schema_version: 2,
    level_reset_version: 20260606,
    coins,
    diamonds,
  }));
}

test('dry run (default) computes correct totals and writes nothing', async () => {
  const kv = makeMockKv();
  seedCode(kv, 'R2L-ALICE001', { coins: 100, diamonds: 5 });
  seedCode(kv, 'R2L-BOB00002', { coins: 7, diamonds: 0 });
  const env = { READ2LEAD_CODES: kv };

  const result = await convertCoinsToDiamonds(env, { apply: false });

  assert.equal(result.apply, false);
  assert.equal(result.records_touched, 2);
  assert.equal(result.total_coins_converted, 107);
  assert.equal(result.total_diamonds_awarded, 50 + 3); // floor(100/2)=50, floor(7/2)=3

  // Nothing written — progress records unchanged.
  const alice = JSON.parse(kv.__store.get(progressKey('R2L-ALICE001')));
  const bob = JSON.parse(kv.__store.get(progressKey('R2L-BOB00002')));
  assert.equal(alice.coins, 100, 'dry run must not mutate coins');
  assert.equal(alice.diamonds, 5, 'dry run must not mutate diamonds');
  assert.equal(bob.coins, 7);
  assert.equal(bob.diamonds, 0);
});

test('--apply live run converts coins to diamonds and zeroes coins', async () => {
  const kv = makeMockKv();
  seedCode(kv, 'R2L-ALICE001', { coins: 100, diamonds: 5 });
  const env = { READ2LEAD_CODES: kv };

  const result = await convertCoinsToDiamonds(env, { apply: true });

  assert.equal(result.records_touched, 1);
  assert.equal(result.total_coins_converted, 100);
  assert.equal(result.total_diamonds_awarded, 50);

  const alice = JSON.parse(kv.__store.get(progressKey('R2L-ALICE001')));
  assert.equal(alice.coins, 0, 'coins must be zeroed after live conversion');
  assert.equal(alice.diamonds, 55, 'diamonds = existing 5 + floor(100/2)=50');
});

test('odd coin amounts round down (floor), never up', async () => {
  const kv = makeMockKv();
  seedCode(kv, 'R2L-ODD000001', { coins: 3, diamonds: 0 }); // floor(3/2) = 1, not 2
  const env = { READ2LEAD_CODES: kv };

  const result = await convertCoinsToDiamonds(env, { apply: true });

  assert.equal(result.total_diamonds_awarded, 1);
  const saved = JSON.parse(kv.__store.get(progressKey('R2L-ODD000001')));
  assert.equal(saved.diamonds, 1);
});

test('a kid with 0 coins is left completely alone (existing diamonds unchanged, not counted as touched)', async () => {
  const kv = makeMockKv();
  seedCode(kv, 'R2L-ZERO00001', { coins: 0, diamonds: 42 });
  const env = { READ2LEAD_CODES: kv };

  const result = await convertCoinsToDiamonds(env, { apply: true });

  assert.equal(result.records_touched, 0);
  assert.equal(result.total_coins_converted, 0);
  const saved = JSON.parse(kv.__store.get(progressKey('R2L-ZERO00001')));
  assert.equal(saved.diamonds, 42, 'diamonds must stay unchanged when there were no coins to convert');
});

test('idempotent: running --apply twice in a row only converts once', async () => {
  const kv = makeMockKv();
  seedCode(kv, 'R2L-ALICE001', { coins: 100, diamonds: 5 });
  const env = { READ2LEAD_CODES: kv };

  const first = await convertCoinsToDiamonds(env, { apply: true });
  assert.equal(first.records_touched, 1);
  assert.equal(first.total_diamonds_awarded, 50);

  const second = await convertCoinsToDiamonds(env, { apply: true });
  assert.equal(second.records_touched, 0, 'coins already 0 — second run has nothing to convert');
  assert.equal(second.total_coins_converted, 0);
  assert.equal(second.total_diamonds_awarded, 0);

  const alice = JSON.parse(kv.__store.get(progressKey('R2L-ALICE001')));
  assert.equal(alice.diamonds, 55, 'diamonds must not double-count across runs');
  assert.equal(alice.coins, 0);
});

test('non-access-code keys (progress:, task:, rl:, debug:, config) are never treated as kid records', async () => {
  const kv = makeMockKv();
  seedCode(kv, 'R2L-REAL000001', { coins: 20, diamonds: 0 });
  // Pollute the namespace with non-code keys a real KV would also hold.
  kv.__store.set('task:some-job', JSON.stringify({ coins: 999 }));
  kv.__store.set('rl:some-ip', JSON.stringify({ coins: 999 }));
  kv.__store.set('debug:speaking-errors', JSON.stringify({ coins: 999 }));
  kv.__store.set('leaderboard-cache', JSON.stringify({ coins: 999 }));
  const env = { READ2LEAD_CODES: kv };

  const result = await convertCoinsToDiamonds(env, { apply: false });

  assert.equal(result.records_scanned, 1, 'only the one real R2L- access code should be scanned');
  assert.equal(result.total_coins_converted, 20);
});

test('multiple kids: totals sum correctly and each per-code row is reported', async () => {
  const kv = makeMockKv();
  seedCode(kv, 'R2L-KID0000001', { coins: 10, diamonds: 0 });
  seedCode(kv, 'R2L-KID0000002', { coins: 25, diamonds: 3 });
  seedCode(kv, 'R2L-KID0000003', { coins: 0, diamonds: 8 });
  const env = { READ2LEAD_CODES: kv };

  const result = await convertCoinsToDiamonds(env, { apply: true });

  assert.equal(result.records_scanned, 3);
  assert.equal(result.records_touched, 2, 'only the two kids with coins > 0 count as touched');
  assert.equal(result.total_coins_converted, 35);
  assert.equal(result.total_diamonds_awarded, 5 + 12); // floor(10/2)=5, floor(25/2)=12
  assert.equal(result.per_code.length, 2);

  const kid1 = JSON.parse(kv.__store.get(progressKey('R2L-KID0000001')));
  const kid2 = JSON.parse(kv.__store.get(progressKey('R2L-KID0000002')));
  const kid3 = JSON.parse(kv.__store.get(progressKey('R2L-KID0000003')));
  assert.equal(kid1.diamonds, 5);
  assert.equal(kid2.diamonds, 3 + 12);
  assert.equal(kid3.diamonds, 8, 'kid with 0 coins keeps their existing diamonds untouched');
});

/**
 * Buffet fix round (2026-07-18, spec §11.10): the KV namespace ID must be
 * supplied explicitly — no hardcoded default. A hardcoded namespace ID is
 * exactly the kind of thing that silently survives a copy-paste into the
 * wrong environment and rewrites the wrong namespace's currency.
 */
test('resolveKvNamespaceId returns null when neither --namespace-id nor the env var is set', () => {
  assert.equal(resolveKvNamespaceId({ argv: ['node', 'script.mjs'], env: {} }), null);
});

test('resolveKvNamespaceId reads --namespace-id from argv', () => {
  assert.equal(
    resolveKvNamespaceId({ argv: ['node', 'script.mjs', '--namespace-id', 'abc123'], env: {} }),
    'abc123',
  );
});

test('resolveKvNamespaceId falls back to READ2LEAD_KV_NAMESPACE_ID env var', () => {
  assert.equal(
    resolveKvNamespaceId({ argv: ['node', 'script.mjs'], env: { READ2LEAD_KV_NAMESPACE_ID: 'env-ns-id' } }),
    'env-ns-id',
  );
});

test('--namespace-id argv takes priority over the env var', () => {
  assert.equal(
    resolveKvNamespaceId({
      argv: ['node', 'script.mjs', '--namespace-id', 'flag-wins'],
      env: { READ2LEAD_KV_NAMESPACE_ID: 'env-loses' },
    }),
    'flag-wins',
  );
});

test('runCli REFUSES to run (no wrangler call, no write) when no namespace ID is supplied', async () => {
  const outcome = await runCli({ argv: ['node', 'script.mjs'], env: {} });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, 'missing_namespace_id');
  assert.match(outcome.message, /Refusing to run/);
});

test('runCli REFUSES even with --apply when no namespace ID is supplied (never silently no-ops into a write)', async () => {
  const outcome = await runCli({ argv: ['node', 'script.mjs', '--apply'], env: {} });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, 'missing_namespace_id');
});
