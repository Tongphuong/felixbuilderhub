import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRemoteKv, resolveKvNamespaceId, wrangler } from '../scripts/_kv-remote.mjs';

/**
 * Bite tests for the kvGet-missing-key fix (2026-09-03).
 *
 * Bug: Cloudflare's API answers a request for a NONEXISTENT KV key with
 * `401: Unauthorized`, not 404 — verified live against a real namespace
 * (grant-season-honors.mjs died reading the not-yet-created honors:2026-S1
 * snapshot). The naive fix — add `|| message.includes('401')` to the
 * existing catch — is a trap: an expired/revoked/wrong-scoped token ALSO
 * returns 401 for every key, so a dead credential would make the WHOLE
 * namespace read as empty and the caller would never know.
 *
 * These tests inject a fake `wranglerFn` (via `makeRemoteKv(id, { wranglerFn })`)
 * instead of touching real wrangler or any real KV namespace — no live
 * Cloudflare call is made anywhere in this file.
 */

function fakeWranglerAllUnauthorized() {
  const err = new Error('command failed');
  err.stderr = 'Unauthorized: 401: Unauthorized';
  throw err;
}

/**
 * A realistic fake: `kv key list` succeeds (proving the token/namespace
 * work), but `kv key get` on a specific key fails with the given failure
 * mode (401 or 404/'not found'), while a second, present key still reads
 * back its value. Records every call's args so tests can assert call counts.
 */
function makeFakeWrangler({ presentKeys = {}, missingKeyName, missingKeyFailure = '401: Unauthorized' } = {}) {
  const calls = [];
  function fakeWrangler(args) {
    calls.push(args);
    const [group, noun, verb] = args;
    if (group === 'kv' && noun === 'key' && verb === 'list') {
      return JSON.stringify(Object.keys(presentKeys).map((name) => ({ name })));
    }
    if (group === 'kv' && noun === 'key' && verb === 'get') {
      const key = JSON.parse(args[3]);
      if (key === missingKeyName) {
        const err = new Error('command failed');
        err.stderr = missingKeyFailure;
        throw err;
      }
      if (Object.prototype.hasOwnProperty.call(presentKeys, key)) {
        return JSON.stringify(presentKeys[key]);
      }
      throw new Error(`unexpected fake wrangler get for key ${key}`);
    }
    throw new Error(`unexpected fake wrangler call: ${args.join(' ')}`);
  }
  fakeWrangler.calls = calls;
  fakeWrangler.listCallCount = () => calls.filter((a) => a[0] === 'kv' && a[1] === 'key' && a[2] === 'list').length;
  return fakeWrangler;
}

// --- BAD-A: the whole point of this fix -----------------------------------

test('BAD-A: a dead token (401 on EVERY call, including the reachability probe) makes the adapter THROW kv_unreachable, never null', async () => {
  const kv = makeRemoteKv('ns-dead-token', { wranglerFn: fakeWranglerAllUnauthorized });

  await assert.rejects(
    () => kv.get('honors:2026-S1', { type: 'json' }),
    (err) => {
      assert.equal(err.code, 'kv_unreachable', 'must throw the distinct kv_unreachable error code');
      assert.match(err.message, /kv_unreachable/);
      assert.match(err.message, /NOT that the.*namespace is empty/s, 'error must explicitly disclaim "namespace is empty"');
      return true;
    },
  );
});

test('BAD-A: an unreachable namespace also throws on list() and put(), never silently degrades', async () => {
  const kv1 = makeRemoteKv('ns-dead-token', { wranglerFn: fakeWranglerAllUnauthorized });
  await assert.rejects(() => kv1.list(), { code: 'kv_unreachable' });

  const kv2 = makeRemoteKv('ns-dead-token', { wranglerFn: fakeWranglerAllUnauthorized });
  await assert.rejects(() => kv2.put('some-key', { a: 1 }), { code: 'kv_unreachable' });
});

// --- BAD-B: probe succeeds, one key 401s, another key still reads ---------

test('BAD-B: reachability probe succeeds, then a specific key 401s -> null for that key, present key unaffected', async () => {
  const fake = makeFakeWrangler({
    presentKeys: { 'R2L-ALICE001': { student_profile: { student_name: 'Alice' } } },
    missingKeyName: 'honors:2026-S1',
    missingKeyFailure: '401: Unauthorized',
  });
  const kv = makeRemoteKv('ns-live', { wranglerFn: fake });

  const missing = await kv.get('honors:2026-S1', { type: 'json' });
  assert.equal(missing, null, 'a single missing key that 401s must read back as null, not throw');

  const present = await kv.get('R2L-ALICE001', { type: 'json' });
  assert.deepEqual(present, { student_profile: { student_name: 'Alice' } }, 'a present key in the same session must still return its real value');
});

// --- BAD-C: same, but 404 / 'not found' phrasing (no regression) ----------

test('BAD-C: a specific key failing with 404/"not found" (the original behaviour) still reads back as null', async () => {
  const fake404 = makeFakeWrangler({
    presentKeys: { 'R2L-BOB00002': { student_profile: { student_name: 'Bob' } } },
    missingKeyName: 'zzz-does-not-exist-xyz',
    missingKeyFailure: 'Error 404: key not found',
  });
  const kv404 = makeRemoteKv('ns-live', { wranglerFn: fake404 });
  assert.equal(await kv404.get('zzz-does-not-exist-xyz', { type: 'json' }), null);
  assert.deepEqual(await kv404.get('R2L-BOB00002', { type: 'json' }), { student_profile: { student_name: 'Bob' } });

  const fakeNotFound = makeFakeWrangler({
    presentKeys: { 'R2L-CARL00003': { ok: true } },
    missingKeyName: 'some-missing-key',
    missingKeyFailure: 'Value not found for that key',
  });
  const kvNotFound = makeRemoteKv('ns-live', { wranglerFn: fakeNotFound });
  assert.equal(await kvNotFound.get('some-missing-key', { type: 'json' }), null);
  assert.deepEqual(await kvNotFound.get('R2L-CARL00003', { type: 'json' }), { ok: true });
});

// --- BAD-D: the probe is cached, not repeated per key ----------------------

test('BAD-D: the reachability probe runs at most ONCE across many get() calls on the same adapter', async () => {
  const fake = makeFakeWrangler({
    presentKeys: {
      'R2L-K1': { n: 1 },
      'R2L-K2': { n: 2 },
      'R2L-K3': { n: 3 },
      'R2L-K4': { n: 4 },
      'R2L-K5': { n: 5 },
    },
  });
  const kv = makeRemoteKv('ns-live', { wranglerFn: fake });

  await kv.get('R2L-K1', { type: 'json' });
  await kv.get('R2L-K2', { type: 'json' });
  await kv.get('R2L-K3', { type: 'json' });
  await kv.get('R2L-K4', { type: 'json' });
  await kv.get('R2L-K5', { type: 'json' });

  assert.equal(fake.listCallCount(), 1, 'exactly one kv key list probe call across 5 gets, not one per key');
});

test('BAD-D: concurrent get() calls (Promise.all) still only probe once (the cache is a shared promise, not a boolean set after the fact)', async () => {
  const fake = makeFakeWrangler({
    presentKeys: { 'R2L-K1': { n: 1 }, 'R2L-K2': { n: 2 }, 'R2L-K3': { n: 3 } },
  });
  const kv = makeRemoteKv('ns-live', { wranglerFn: fake });

  await Promise.all([
    kv.get('R2L-K1', { type: 'json' }),
    kv.get('R2L-K2', { type: 'json' }),
    kv.get('R2L-K3', { type: 'json' }),
  ]);

  assert.equal(fake.listCallCount(), 1, 'concurrent gets must share one in-flight probe, not fire one each');
});

// --- Source-compatibility: existing single-argument call shape -------------

test('makeRemoteKv(namespaceId) — single-argument call (every existing caller in this repo) still returns a get/put/list adapter', () => {
  const kv = makeRemoteKv('some-namespace-id');
  assert.equal(typeof kv.get, 'function');
  assert.equal(typeof kv.put, 'function');
  assert.equal(typeof kv.list, 'function');
});

test('resolveKvNamespaceId and wrangler are still exported unchanged (consumer import surface)', () => {
  assert.equal(typeof resolveKvNamespaceId, 'function');
  assert.equal(typeof wrangler, 'function');
});
