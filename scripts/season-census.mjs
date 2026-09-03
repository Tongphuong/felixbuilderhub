#!/usr/bin/env node
/**
 * R2L Season Honors — read-only census. Scans every access-code record,
 * ranks them exactly the way scripts/grant-season-honors.mjs will (reusing
 * the same buildHonorsRanking() from functions/api/_read2lead-honors.js),
 * and prints who's in, who's excluded and why, and whether the ranking is
 * dangerously close near the podium cutoff.
 *
 * NEVER WRITES. This script only reads KV — see grant-season-honors.mjs for
 * the script that actually pays out.
 *
 * Reuse-first: same list({limit:100, cursor}) paging shape as
 * functions/api/read2lead-leaderboard.js's computeLeaders(), same
 * isAccessCodeKey()/loadProgressState() read path as
 * scripts/convert-coins-to-diamonds.mjs, same wrangler KV adapter
 * (scripts/_kv-remote.mjs) as every other remote-KV script in this repo.
 *
 * Usage:
 *   node scripts/season-census.mjs --namespace-id <id>            # table output
 *   node scripts/season-census.mjs --namespace-id <id> --json      # machine output
 *   READ2LEAD_KV_NAMESPACE_ID=<id> node scripts/season-census.mjs
 *
 * The KV namespace ID is REQUIRED and must come explicitly from
 * --namespace-id or the READ2LEAD_KV_NAMESPACE_ID env var — no hardcoded
 * default (same refusal contract as convert-coins-to-diamonds.mjs).
 */
import { isAccessCodeKey, loadProgressState } from '../functions/api/_read2lead-v2-state.js';
import { buildHonorsRanking } from '../functions/api/_read2lead-honors.js';
import {
  makeRemoteKv,
  resolveKvNamespaceId as resolveKvNamespaceIdFor,
} from './_kv-remote.mjs';

// The "Amazing Summer" season window (founder-approved, packet: R2L Season
// Honors — Blocks A+B). Shared with scripts/grant-season-honors.mjs, which
// imports this constant rather than redefining it, so the census report and
// the actual payout are always ranked over the identical window.
export const SEASON_WINDOW = { from: '2026-07-01', to: '2026-08-31' };

// A #3/#4 gap this small (or smaller) in lifetime_rp means the podium cutoff
// is close enough that a founder should eyeball it before real diamonds move
// — this script only warns, it never decides.
const CLOSE_GAP_THRESHOLD_RP = 2;

export function resolveKvNamespaceId({ argv = process.argv, env = process.env } = {}) {
  return resolveKvNamespaceIdFor('READ2LEAD_KV_NAMESPACE_ID', { argv, env });
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Scan every R2L-* access-code record and load its v2 progress state.
 * Exported so grant-season-honors.mjs reuses the exact same scan instead of
 * duplicating the list/get/loadProgressState loop — used ONLY there to
 * compute a snapshot the very first time it's frozen. Once a snapshot
 * exists, grant-season-honors.mjs must NOT call this again (see its own
 * doc comment): the whole point of freezing is that this scan reads live,
 * drifting data (kids are still completing lessons; lifetime_rp moves).
 *
 * @param {{READ2LEAD_CODES: {list: Function, get: Function}}} env
 * @returns {Promise<{access_code: string, codeData: object, state: object}[]>}
 */
export async function scanSeasonEntries(env) {
  const kv = env?.READ2LEAD_CODES;
  if (!kv) throw new Error('READ2LEAD_CODES binding missing');

  const entries = [];
  let cursor;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await kv.list(cursor ? { limit: 100, cursor } : { limit: 100 });
    for (const key of page.keys || []) {
      if (!isAccessCodeKey(key.name)) continue;
      // eslint-disable-next-line no-await-in-loop
      const codeData = await kv.get(key.name, { type: 'json' });
      if (!codeData) continue;
      // eslint-disable-next-line no-await-in-loop
      const state = await loadProgressState(env, key.name, codeData);
      entries.push({ access_code: key.name, codeData, state });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  return entries;
}

/**
 * Build the full census: the ranking (reusing buildHonorsRanking(), the
 * exact function grant-season-honors.mjs pays from) plus each honor_roll
 * row's current diamond balance (not part of buildHonorsRanking()'s public
 * shape, since that module only knows about ranking fields) and a warning
 * flag when the #3/#4 lifetime_rp gap is uncomfortably small.
 *
 * @param {object} env
 * @param {{seasonWindow?: {from?: string, to?: string}}} [options]
 */
export async function buildSeasonCensus(env, { seasonWindow = SEASON_WINDOW } = {}) {
  const entries = await scanSeasonEntries(env);
  const ranking = buildHonorsRanking(entries, { seasonWindow });

  const diamondsByCode = new Map(
    entries.map((entry) => [
      String(entry.access_code || '').trim().toUpperCase(),
      numberOrZero(entry.state?.diamonds),
    ]),
  );
  const honorRoll = ranking.honor_roll.map((row) => ({
    ...row,
    diamonds: diamondsByCode.get(row.access_code) ?? 0,
  }));

  let gapWarning = null;
  if (honorRoll.length >= 4) {
    const gap = honorRoll[2].lifetime_rp - honorRoll[3].lifetime_rp;
    if (gap <= CLOSE_GAP_THRESHOLD_RP) {
      gapWarning = `#3 and #4 are within ${CLOSE_GAP_THRESHOLD_RP} rank points — founder ruling required before paying.`;
    }
  }

  return {
    honor_roll: honorRoll,
    podium: ranking.podium,
    excluded: ranking.excluded,
    participants_count: ranking.participants_count,
    excluded_count: ranking.excluded.length,
    gap_warning: gapWarning,
  };
}

export async function runCli({ argv = process.argv, env = process.env } = {}) {
  const namespaceId = resolveKvNamespaceId({ argv, env });
  if (!namespaceId) {
    return {
      ok: false,
      error: 'missing_namespace_id',
      message: 'Refusing to run: no KV namespace ID provided. Pass --namespace-id <id> or set READ2LEAD_KV_NAMESPACE_ID.',
    };
  }
  const cliEnv = { READ2LEAD_CODES: makeRemoteKv(namespaceId) };
  const census = await buildSeasonCensus(cliEnv, { seasonWindow: SEASON_WINDOW });
  return { ok: true, namespace_id: namespaceId, census };
}

function padCell(value, width) {
  return String(value).slice(0, width).padEnd(width);
}

function printTable(rows) {
  const columns = [
    ['rank', 'Rank', 5],
    ['student_name', 'Name', 20],
    ['masked_code', 'Code', 16],
    ['lifetime_rp', 'RP', 6],
    ['completed_packs', 'Packs', 6],
    ['completed_books', 'Books', 6],
    ['pronunciation_percent', 'Pron%', 6],
    ['diamonds', 'Diamonds', 9],
  ];
  console.log(columns.map(([, label, width]) => padCell(label, width)).join(' '));
  console.log(columns.map(([, , width]) => '-'.repeat(width)).join(' '));
  for (const row of rows) {
    console.log(
      columns
        .map(([key, , width]) => padCell(key === 'pronunciation_percent' && row[key] == null ? '—' : row[key], width))
        .join(' '),
    );
  }
}

async function main() {
  const outcome = await runCli();
  if (!outcome.ok) {
    console.error('FAILED:', outcome.message);
    process.exitCode = 1;
    return;
  }

  const { census, namespace_id: namespaceId } = outcome;
  const asJson = process.argv.includes('--json');

  if (asJson) {
    console.log(JSON.stringify(census, null, 2));
    return;
  }

  console.log(`R2L Season Honors — census (namespace ${namespaceId})`);
  console.log('READ-ONLY. Nothing was written.\n');

  console.log('== Ranking ==');
  printTable(census.honor_roll);

  console.log('\n== Excluded ==');
  if (census.excluded.length === 0) {
    console.log('(none)');
  } else {
    for (const row of census.excluded) {
      console.log(`  ${row.masked_code}: ${row.reason}`);
    }
  }

  console.log(`\n${census.participants_count} real students, ${census.excluded_count} excluded.`);

  if (census.gap_warning) {
    console.log(`\n⚠️ ${census.gap_warning}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
}
