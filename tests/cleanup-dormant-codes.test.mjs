// R2L-OPEN-ACCESS acceptance criterion 5: cleanup-dormant-codes.mjs must find
// (dry-run) and delete (--apply) ONLY dormant self-serve codes — never
// admin-created codes, never a self-serve code that ever got used, and never
// one still inside the 30-day grace window.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findDormantCodes,
  cleanupDormantCodes,
  resolveKvNamespaceId,
  runCli,
} from '../scripts/cleanup-dormant-codes.mjs';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

function makeMockKv(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries).map(([k, v]) => [k, JSON.stringify(v)]));
  const deleted = [];
  return {
    store,
    deleted,
    async get(key, options) {
      const raw = store.get(key);
      if (raw == null) return null;
      return options?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async delete(key) {
      deleted.push(key);
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function selfServeRecord({ issuedAt, packsCreated = 0, studentName = 'Kid' }) {
  return {
    parent_name: '', parent_zalo: '', notes: '',
    student_profile: { student_name: studentName, age: 8, level: 'L1', child_gender: 'boy' },
    progress: { student_name: studentName, age: 8, child_gender: 'boy', current_level: 'L1', packs_created: packsCreated, current_pack: null, badges: [], review_history: [] },
    issued_at: issuedAt,
    expires_at: isoDaysAgo(-90), // 90 days in the future — not exercised by the cleanup logic
    uses_total: 3, uses_remaining: 3, last_used_at: null,
    is_test: false, is_shared: false,
    origin: 'self_serve',
  };
}

function adminRecord({ issuedAt, studentName = 'AdminKid' }) {
  const r = selfServeRecord({ issuedAt, studentName });
  delete r.origin;
  return r;
}

const NOW = new Date();

test('dry run finds a truly dormant self-serve code (>30d old, 0 packs, no progress: key)', async () => {
  const code = 'R2L-KID001-AAAA';
  const kv = makeMockKv({ [code]: selfServeRecord({ issuedAt: isoDaysAgo(45) }) });
  const result = await findDormantCodes({ READ2LEAD_CODES: kv }, { now: NOW });

  assert.equal(result.scanned, 1);
  assert.equal(result.self_serve_scanned, 1);
  assert.equal(result.dormant.length, 1);
  assert.equal(result.dormant[0].code, code);
});

test('a self-serve code younger than 30 days is NEVER listed, even with 0 packs', async () => {
  const code = 'R2L-KID002-AAAA';
  const kv = makeMockKv({ [code]: selfServeRecord({ issuedAt: isoDaysAgo(5) }) });
  const result = await findDormantCodes({ READ2LEAD_CODES: kv }, { now: NOW });
  assert.equal(result.dormant.length, 0);
});

test('a self-serve code with packs_created > 0 is NEVER listed, however old', async () => {
  const code = 'R2L-KID003-AAAA';
  const kv = makeMockKv({ [code]: selfServeRecord({ issuedAt: isoDaysAgo(200), packsCreated: 2 }) });
  const result = await findDormantCodes({ READ2LEAD_CODES: kv }, { now: NOW });
  assert.equal(result.dormant.length, 0);
});

test('a self-serve code WITH a progress: state is NEVER listed, even at 0 packs_created and old', async () => {
  const code = 'R2L-KID004-AAAA';
  const kv = makeMockKv({
    [code]: selfServeRecord({ issuedAt: isoDaysAgo(200), packsCreated: 0 }),
    [progressKey(code)]: { schema_version: 2, level_reset_version: 1, current_level: 'L0', completed_packs: 0 },
  });
  const result = await findDormantCodes({ READ2LEAD_CODES: kv }, { now: NOW });
  assert.equal(result.dormant.length, 0, 'a code with any v2 progress state must never be treated as dormant');
});

test('admin-created codes (no origin field) are NEVER listed, however old and unused', async () => {
  const code = 'R2L-ADMIN01-AAAA';
  const kv = makeMockKv({ [code]: adminRecord({ issuedAt: isoDaysAgo(500) }) });
  const result = await findDormantCodes({ READ2LEAD_CODES: kv }, { now: NOW });
  assert.equal(result.scanned, 1);
  assert.equal(result.self_serve_scanned, 0, 'admin records must not even count as self-serve');
  assert.equal(result.dormant.length, 0);
});

test('non-access-code KV keys (progress:, rl:, config:, rl-signup:, signup-global:, debug:) are never scanned as codes', async () => {
  const code = 'R2L-REAL01-AAAA';
  const kv = makeMockKv({
    [code]: selfServeRecord({ issuedAt: isoDaysAgo(45) }),
    'config:signup_enabled': true,
    'rl-signup:1.2.3.4': { count: 3, first_at: 0 },
    'signup-global:2026-08-01': 12,
    'rl:9.9.9.9': { count: 1 },
    'debug:speaking-errors': [],
    'leaderboard-cache': { leaders: [] },
  });
  const result = await findDormantCodes({ READ2LEAD_CODES: kv }, { now: NOW });
  assert.equal(result.scanned, 1, 'only the one real R2L- code should ever be scanned');
  assert.equal(result.dormant.length, 1);
  assert.equal(result.dormant[0].code, code);
});

test('a mix of codes: dry run reports exactly the dormant ones and writes nothing', async () => {
  const dormantCode = 'R2L-DORMANT1-AAAA';
  const recentCode = 'R2L-RECENT01-AAAA';
  const usedCode = 'R2L-USED0001-AAAA';
  const adminCode = 'R2L-ADMINX01-AAAA';

  const kv = makeMockKv({
    [dormantCode]: selfServeRecord({ issuedAt: isoDaysAgo(60) }),
    [recentCode]: selfServeRecord({ issuedAt: isoDaysAgo(2) }),
    [usedCode]: selfServeRecord({ issuedAt: isoDaysAgo(60), packsCreated: 1 }),
    [adminCode]: adminRecord({ issuedAt: isoDaysAgo(60) }),
  });

  const result = await cleanupDormantCodes({ READ2LEAD_CODES: kv }, { apply: false, now: NOW });

  assert.equal(result.apply, false);
  assert.equal(result.dormant_count, 1);
  assert.equal(result.dormant[0].code, dormantCode);
  assert.equal(kv.deleted.length, 0, 'dry run must never call delete()');
  // Everything must still be present in the store.
  assert.ok(kv.store.has(dormantCode));
  assert.ok(kv.store.has(recentCode));
  assert.ok(kv.store.has(usedCode));
  assert.ok(kv.store.has(adminCode));
});

test('--apply deletes exactly the dormant codes and nothing else', async () => {
  const dormantCode = 'R2L-DORMANT2-AAAA';
  const recentCode = 'R2L-RECENT02-AAAA';
  const usedCode = 'R2L-USED0002-AAAA';
  const adminCode = 'R2L-ADMINX02-AAAA';

  const kv = makeMockKv({
    [dormantCode]: selfServeRecord({ issuedAt: isoDaysAgo(60) }),
    [recentCode]: selfServeRecord({ issuedAt: isoDaysAgo(2) }),
    [usedCode]: selfServeRecord({ issuedAt: isoDaysAgo(60), packsCreated: 1 }),
    [adminCode]: adminRecord({ issuedAt: isoDaysAgo(60) }),
  });

  const result = await cleanupDormantCodes({ READ2LEAD_CODES: kv }, { apply: true, now: NOW });

  assert.equal(result.apply, true);
  assert.equal(result.dormant_count, 1);
  assert.deepEqual(kv.deleted, [dormantCode]);
  assert.equal(kv.store.has(dormantCode), false, 'the dormant code must be gone');
  assert.ok(kv.store.has(recentCode), 'a recent self-serve code must survive');
  assert.ok(kv.store.has(usedCode), 'a self-serve code with a pack must survive');
  assert.ok(kv.store.has(adminCode), 'an admin-created code must survive, regardless of age');
});

test('a self-serve code with progress AND old age still survives --apply', async () => {
  const code = 'R2L-SURVIVE1-AAAA';
  const kv = makeMockKv({
    [code]: selfServeRecord({ issuedAt: isoDaysAgo(365), packsCreated: 0 }),
    [progressKey(code)]: { schema_version: 2, level_reset_version: 1, current_level: 'L0' },
  });
  const result = await cleanupDormantCodes({ READ2LEAD_CODES: kv }, { apply: true, now: NOW });
  assert.equal(result.dormant_count, 0);
  assert.ok(kv.store.has(code));
  assert.ok(kv.store.has(progressKey(code)));
});

// ---------------------------------------------------------------------------
// CLI namespace-ID refusal (mirrors convert-coins-to-diamonds.mjs's contract).
// ---------------------------------------------------------------------------

test('resolveKvNamespaceId returns null with neither --namespace-id nor the env var', () => {
  assert.equal(resolveKvNamespaceId({ argv: ['node', 'script.mjs'], env: {} }), null);
});

test('resolveKvNamespaceId reads --namespace-id from argv, taking priority over the env var', () => {
  assert.equal(
    resolveKvNamespaceId({ argv: ['node', 'script.mjs', '--namespace-id', 'flag-id'], env: { READ2LEAD_KV_NAMESPACE_ID: 'env-id' } }),
    'flag-id',
  );
});

test('resolveKvNamespaceId falls back to READ2LEAD_KV_NAMESPACE_ID', () => {
  assert.equal(
    resolveKvNamespaceId({ argv: ['node', 'script.mjs'], env: { READ2LEAD_KV_NAMESPACE_ID: 'env-id' } }),
    'env-id',
  );
});

test('runCli REFUSES (no wrangler call, no delete) when no namespace ID is supplied, dry run or --apply', async () => {
  const dryRun = await runCli({ argv: ['node', 'script.mjs'], env: {} });
  assert.equal(dryRun.ok, false);
  assert.equal(dryRun.error, 'missing_namespace_id');

  const applyRun = await runCli({ argv: ['node', 'script.mjs', '--apply'], env: {} });
  assert.equal(applyRun.ok, false);
  assert.equal(applyRun.error, 'missing_namespace_id');
});
