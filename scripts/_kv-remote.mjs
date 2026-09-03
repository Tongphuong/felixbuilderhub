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

function kvGet(namespaceId, key) {
  try {
    const raw = wrangler([
      'kv', 'key', 'get', JSON.stringify(key),
      '--namespace-id', namespaceId,
      '--remote',
    ]).trim();
    if (!raw || raw === 'Value not found') return null;
    return JSON.parse(raw);
  } catch (error) {
    const message = String(error.stderr || error.stdout || error.message || '');
    if (message.includes('not found') || message.includes('404')) return null;
    throw error;
  }
}

function kvPut(namespaceId, key, value) {
  const file = join(tmpdir(), `r2l-kv-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(value));
  try {
    wrangler([
      'kv', 'key', 'put', JSON.stringify(key),
      '--namespace-id', namespaceId,
      '--remote',
      '--path', JSON.stringify(file),
    ]);
  } finally {
    unlinkSync(file);
  }
}

function kvListAllKeys(namespaceId) {
  const raw = wrangler(['kv', 'key', 'list', '--namespace-id', namespaceId, '--remote']);
  return JSON.parse(raw).map((entry) => entry.name);
}

/** Real Cloudflare KV, driven through `wrangler kv` (mirrors apply-leaderboard-bots.mjs). */
export function makeRemoteKv(namespaceId) {
  return {
    async get(key, options) {
      const value = kvGet(namespaceId, key);
      if (value == null) return null;
      return options?.type === 'json' ? value : JSON.stringify(value);
    },
    async put(key, value) {
      await kvPut(namespaceId, key, typeof value === 'string' ? JSON.parse(value) : value);
    },
    async list() {
      return { keys: kvListAllKeys(namespaceId).map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}
