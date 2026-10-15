#!/usr/bin/env node
/**
 * Apply fixed Pilot/Ong bot stats directly to production KV via wrangler.
 * Usage: node scripts/apply-leaderboard-bots.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LEADERBOARD_BOT_PRESETS } from '../functions/api/_read2lead-v2-state.js';
import { applyBotStatsToCode } from '../functions/api/admin/codes/_apply-bot-stats.js';

const KV_NAMESPACE_ID = process.env.READ2LEAD_KV_NAMESPACE_ID || 'c630107ee28148de901455d35ce35e67';

function wrangler(args) {
  const cmd = ['npx', 'wrangler@latest', ...args].join(' ');
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
}

function kvGet(key) {
  try {
    const raw = wrangler([
      'kv', 'key', 'get', JSON.stringify(key),
      '--namespace-id', KV_NAMESPACE_ID,
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

function kvPut(key, value) {
  const file = join(tmpdir(), `r2l-kv-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(value));
  try {
    wrangler([
      'kv', 'key', 'put', JSON.stringify(key),
      '--namespace-id', KV_NAMESPACE_ID,
      '--remote',
      '--path', JSON.stringify(file),
    ]);
  } finally {
    unlinkSync(file);
  }
}

function kvDelete(key) {
  try {
    wrangler([
      'kv', 'key', 'delete', JSON.stringify(key),
      '--namespace-id', KV_NAMESPACE_ID,
      '--remote',
    ]);
  } catch {
    // Best-effort.
  }
}

const remoteKv = {
  async get(key, options) {
    const value = kvGet(key);
    if (!value) return null;
    return options?.type === 'json' ? value : JSON.stringify(value);
  },
  async put(key, value) {
    kvPut(key, typeof value === 'string' ? JSON.parse(value) : value);
  },
  async delete(key) {
    kvDelete(key);
  },
};

const env = { READ2LEAD_CODES: remoteKv };

const presets = ['pilot', 'ong'];
const results = [];
for (const name of presets) {
  const preset = { key: name, ...LEADERBOARD_BOT_PRESETS[name] };
  // eslint-disable-next-line no-await-in-loop
  const result = await applyBotStatsToCode(env, preset.code, preset);
  results.push(result);
  console.log(result.ok
    ? `✓ ${result.display_name}: ${result.rank_label_vi} · ${result.completed_packs} bài · ${result.coins} xu · RP ${result.season_rp}`
    : `✗ ${preset.code}: ${result.error}`);
}

const failed = results.filter((row) => !row.ok);
process.exit(failed.length ? 1 : 0);
