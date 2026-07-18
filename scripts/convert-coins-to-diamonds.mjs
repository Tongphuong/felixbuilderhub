#!/usr/bin/env node
/**
 * One-time migration: fold every kid's coin balance into diamonds.
 *
 * SPEC_R2L_REWARDS_REDESIGN.md §3.3 Step 1 / §5 Phase 3: `diamonds += floor(coins / 2)`,
 * then `coins = 0`. Idempotent — a record with coins already at 0 contributes nothing on
 * a re-run, so running this twice (or interrupting and resuming) is safe.
 *
 * Safety:
 *   - DRY RUN IS THE DEFAULT. Nothing is written unless --apply is passed.
 *   - This is a PRODUCTION currency rewrite touching real children's balances — the live
 *     --apply run happens only on Phương's explicit OK, logged in _ops/AGENT_LOG.md
 *     (see ~/.claude/rules/mcp-infra-use.md: a KV write to live student data carries the
 *     same weight as a source change and is Elon-gated, not something a worker runs).
 *   - Mark (this packet's author) built and unit-tested this with MOCKED KV ONLY
 *     (tests/convert-coins-to-diamonds.test.mjs) and did not run it against any real
 *     KV namespace.
 *
 * Reuse-first: iterates access-code records with the product's own isAccessCodeKey()
 * filter, and reads/writes each kid's currency through the exact same
 * loadProgressState()/saveProgressState() helpers the live Worker uses — no bespoke KV
 * key parsing or state normalization. `env` here only wires READ2LEAD_CODES (matching
 * scripts/apply-leaderboard-bots.mjs's established pattern), which is safe because
 * progressNamespace() falls back to READ2LEAD_CODES when READ2LEAD_PROGRESS isn't a
 * separate binding (this repo's wrangler config does not define one).
 *
 * Usage:
 *   node scripts/convert-coins-to-diamonds.mjs              # dry run (default)
 *   node scripts/convert-coins-to-diamonds.mjs --apply       # live write
 *   READ2LEAD_KV_NAMESPACE_ID=<id> node scripts/convert-coins-to-diamonds.mjs --apply
 */
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isAccessCodeKey,
  loadProgressState,
  saveProgressState,
} from '../functions/api/_read2lead-v2-state.js';

const KV_NAMESPACE_ID = process.env.READ2LEAD_KV_NAMESPACE_ID || 'c630107ee28148de901455d35ce35e67';
const APPLY = process.argv.includes('--apply');

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

function kvListAllKeys() {
  const raw = wrangler(['kv', 'key', 'list', '--namespace-id', KV_NAMESPACE_ID, '--remote']);
  return JSON.parse(raw).map((entry) => entry.name);
}

/** Real Cloudflare KV, driven through `wrangler kv` (mirrors apply-leaderboard-bots.mjs). */
const remoteKv = {
  async get(key, options) {
    const value = kvGet(key);
    if (value == null) return null;
    return options?.type === 'json' ? value : JSON.stringify(value);
  },
  async put(key, value) {
    await kvPut(key, typeof value === 'string' ? JSON.parse(value) : value);
  },
  async list() {
    return { keys: kvListAllKeys().map((name) => ({ name })), list_complete: true, cursor: null };
  },
};

/**
 * Core migration logic — takes a Workers-`env`-shaped object exposing
 * `READ2LEAD_CODES` (list/get/put), so it can be driven by either the mocked
 * in-memory KV in tests or the `remoteKv` wrangler adapter above.
 *
 * @param {{READ2LEAD_CODES: {list: Function, get: Function, put: Function}}} env
 * @param {{apply?: boolean}} [options]
 */
export async function convertCoinsToDiamonds(env, { apply = false } = {}) {
  const kv = env?.READ2LEAD_CODES;
  if (!kv) throw new Error('READ2LEAD_CODES binding missing');

  let cursor;
  let recordsScanned = 0;
  let recordsTouched = 0;
  let totalCoinsConverted = 0;
  let totalDiamondsAwarded = 0;
  const perCode = [];

  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await kv.list(cursor ? { cursor } : {});
    for (const entry of page.keys || []) {
      const accessCode = entry.name;
      if (!isAccessCodeKey(accessCode)) continue;
      recordsScanned += 1;

      // eslint-disable-next-line no-await-in-loop
      const codeData = await kv.get(accessCode, { type: 'json' });
      if (!codeData) continue;

      // eslint-disable-next-line no-await-in-loop
      const state = await loadProgressState(env, accessCode, codeData);
      const coins = Number(state.coins) || 0;
      if (coins <= 0) continue; // idempotent: nothing to convert (already 0, or never had coins)

      const bonus = Math.floor(coins / 2);
      const newDiamonds = (Number(state.diamonds) || 0) + bonus;
      recordsTouched += 1;
      totalCoinsConverted += coins;
      totalDiamondsAwarded += bonus;
      perCode.push({
        access_code: accessCode,
        coins_converted: coins,
        diamonds_added: bonus,
        new_diamonds: newDiamonds,
      });

      if (apply) {
        // eslint-disable-next-line no-await-in-loop
        await saveProgressState(env, accessCode, { ...state, coins: 0, diamonds: newDiamonds });
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  return {
    apply,
    records_scanned: recordsScanned,
    records_touched: recordsTouched,
    total_coins_converted: totalCoinsConverted,
    total_diamonds_awarded: totalDiamondsAwarded,
    per_code: perCode,
  };
}

async function main() {
  const env = { READ2LEAD_CODES: remoteKv };
  const result = await convertCoinsToDiamonds(env, { apply: APPLY });

  console.log(APPLY ? 'LIVE RUN — writes applied.' : 'DRY RUN — no writes made. Pass --apply to write for real.');
  console.log(`Scanned ${result.records_scanned} access-code records.`);
  console.log(`Records with coins to convert: ${result.records_touched}`);
  console.log(`Total coins converted: ${result.total_coins_converted}`);
  console.log(`Total diamonds awarded: ${result.total_diamonds_awarded}`);
  for (const row of result.per_code) {
    console.log(`  ${row.access_code}: ${row.coins_converted} xu -> +${row.diamonds_added}💎 (new balance ${row.new_diamonds}💎)`);
  }
  if (!result.records_touched) {
    console.log('Nothing to convert — every scanned record already has 0 coins.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
}
