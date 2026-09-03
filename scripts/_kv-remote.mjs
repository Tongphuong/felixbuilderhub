#!/usr/bin/env node
/**
 * Shared wrangler-KV adapter, extracted from scripts/convert-coins-to-diamonds.mjs
 * so scripts/grant-season-honors.mjs and scripts/season-census.mjs can reuse the
 * exact same read/write path instead of duplicating it (reuse-first).
 *
 * Behaviour is unchanged from the original inline copy in
 * convert-coins-to-diamonds.mjs — this file only moves the code, it does not
 * alter it. convert-coins-to-diamonds.mjs now imports from here and re-exports
 * its own resolveKvNamespaceId({ argv, env }) wrapper (fixed to
 * READ2LEAD_KV_NAMESPACE_ID) so tests/convert-coins-to-diamonds.test.mjs keeps
 * passing unmodified.
 *
 * Fix (2026-09-03, Mark): Cloudflare's API answers a request for a
 * NONEXISTENT KV key with `401: Unauthorized`, not 404 — discovered when
 * grant-season-honors.mjs died reading the not-yet-created `honors:2026-S1`
 * snapshot on its very first real run. The naive fix (treat every 401 as
 * "key absent") is a trap: an expired/revoked/wrong-scoped wrangler token
 * ALSO returns 401 for every key, so a dead credential would make the whole
 * namespace silently read as empty (buildHonorsRanking would then freeze a
 * podium computed from zero students and the script would report success —
 * exactly the "a dead check reads like a healthy one" failure mode, AGENTS.md
 * rule 28). So `makeRemoteKv` now proves the namespace is reachable (one
 * `kv key list` probe, cached per adapter instance — one extra call per run,
 * not one per key) BEFORE it will ever translate a per-key 401/404/'not
 * found' into `null`. If the probe itself fails, every operation on the
 * adapter throws a distinct `kv_unreachable` error instead of degrading to
 * null — never silently "the namespace is empty".
 */
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the KV namespace ID from --namespace-id or a named env var only —
 * no hardcoded fallback. Returns null (never throws) so callers can decide
 * how to report the refusal.
 *
 * @param {string} envVarName - the env var to fall back to (e.g. READ2LEAD_KV_NAMESPACE_ID)
 * @param {{argv?: string[], env?: object}} [options]
 */
export function resolveKvNamespaceId(envVarName, { argv = process.argv, env = process.env } = {}) {
  const flagIndex = argv.indexOf('--namespace-id');
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  return env[envVarName] || null;
}

export function wrangler(args) {
  const cmd = ['npx', 'wrangler@latest', ...args].join(' ');
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
}

/**
 * Translates a per-KEY 401/404/'not found' into `null` (absent). Callers
 * must only reach this AFTER reachability of the namespace itself has been
 * proven (see ensureReachable/kvUnreachableError below) — on its own this
 * function cannot distinguish "this key doesn't exist" from "every key
 * 401s because the token is dead", which is exactly the trap.
 */
function kvGet(namespaceId, key, wranglerFn) {
  try {
    const raw = wranglerFn([
      'kv', 'key', 'get', JSON.stringify(key),
      '--namespace-id', namespaceId,
      '--remote',
    ]).trim();
    if (!raw || raw === 'Value not found') return null;
    return JSON.parse(raw);
  } catch (error) {
    const message = String(error.stderr || error.stdout || error.message || '');
    // Cloudflare answers a request for a NONEXISTENT key with 401, not 404 —
    // safe to treat as "absent" here only because ensureReachable() already
    // proved this namespace/token can read a key that IS present.
    if (message.includes('not found') || message.includes('404') || message.includes('401')) return null;
    throw error;
  }
}

function kvPut(namespaceId, key, value, wranglerFn) {
  const file = join(tmpdir(), `r2l-kv-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(value));
  try {
    wranglerFn([
      'kv', 'key', 'put', JSON.stringify(key),
      '--namespace-id', namespaceId,
      '--remote',
      '--path', JSON.stringify(file),
    ]);
  } finally {
    unlinkSync(file);
  }
}

function kvListAllKeys(namespaceId, wranglerFn) {
  const raw = wranglerFn(['kv', 'key', 'list', '--namespace-id', namespaceId, '--remote']);
  return JSON.parse(raw).map((entry) => entry.name);
}

function kvUnreachableError(namespaceId, cause) {
  const causeMessage = String(cause?.stderr || cause?.stdout || cause?.message || cause || '');
  const err = new Error(
    `kv_unreachable: reachability probe ('kv key list') failed for namespace ${namespaceId}. `
    + 'This usually means an expired/revoked/wrong-scoped wrangler token — NOT that the '
    + 'namespace is empty. Refusing to treat any key as absent until reachability is '
    + `confirmed. Cause: ${causeMessage}`,
  );
  err.code = 'kv_unreachable';
  err.namespaceId = namespaceId;
  err.cause = cause;
  return err;
}

/**
 * Real Cloudflare KV, driven through `wrangler kv` (mirrors
 * apply-leaderboard-bots.mjs). `wranglerFn` defaults to the exported
 * `wrangler()` above and exists only so tests can inject a fake — every
 * caller in this repo keeps calling `makeRemoteKv(namespaceId)` unchanged.
 *
 * Reachability contract: the FIRST call to get/put/list on the returned
 * adapter runs one `kv key list` probe and caches it (a shared promise) for
 * the lifetime of this adapter instance — one extra call per run, not one
 * per key. If that probe fails, every operation throws a `kv_unreachable`
 * error; nothing is ever silently read back as an empty/absent namespace.
 * Only once the probe has succeeded does `kvGet` get to translate a
 * per-key 401/404/'not found' into `null`.
 */
export function makeRemoteKv(namespaceId, { wranglerFn = wrangler } = {}) {
  let reachabilityProbe = null;

  function ensureReachable() {
    if (!reachabilityProbe) {
      reachabilityProbe = Promise.resolve().then(() => {
        try {
          kvListAllKeys(namespaceId, wranglerFn);
        } catch (error) {
          throw kvUnreachableError(namespaceId, error);
        }
      });
    }
    return reachabilityProbe;
  }

  return {
    async get(key, options) {
      await ensureReachable();
      const value = kvGet(namespaceId, key, wranglerFn);
      if (value == null) return null;
      return options?.type === 'json' ? value : JSON.stringify(value);
    },
    async put(key, value) {
      await ensureReachable();
      await kvPut(namespaceId, key, typeof value === 'string' ? JSON.parse(value) : value, wranglerFn);
    },
    async list() {
      await ensureReachable();
      return { keys: kvListAllKeys(namespaceId, wranglerFn).map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}
