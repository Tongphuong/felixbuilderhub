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
 *   node scripts/convert-coins-to-diamonds.mjs --namespace-id <id>            # dry run (default)
 *   node scripts/convert-coins-to-diamonds.mjs --namespace-id <id> --apply    # live write
 *   READ2LEAD_KV_NAMESPACE_ID=<id> node scripts/convert-coins-to-diamonds.mjs --apply
 *
 * The KV namespace ID is REQUIRED and must come explicitly from --namespace-id
 * or the READ2LEAD_KV_NAMESPACE_ID env var — there is no hardcoded default.
 * A hardcoded namespace ID is exactly the kind of thing that silently survives
 * a copy-paste into the wrong environment and rewrites the wrong namespace's
 * currency; the script refuses to run at all without one supplied explicitly.
 */
import {
  isAccessCodeKey,
  loadProgressState,
  saveProgressState,
} from '../functions/api/_read2lead-v2-state.js';
import {
  makeRemoteKv,
  resolveKvNamespaceId as resolveKvNamespaceIdFor,
} from './_kv-remote.mjs';

/**
 * Resolve the KV namespace ID from --namespace-id or READ2LEAD_KV_NAMESPACE_ID
 * only — no hardcoded fallback. Returns null (never throws) so callers can
 * decide how to report the refusal. Thin wrapper over the shared
 * _kv-remote.mjs resolver, fixed to this script's env var name so the
 * existing ({ argv, env }) call shape and tests are unaffected.
 */
export function resolveKvNamespaceId({ argv = process.argv, env = process.env } = {}) {
  return resolveKvNamespaceIdFor('READ2LEAD_KV_NAMESPACE_ID', { argv, env });
}

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

/**
 * CLI entry point, split out from main() so the namespace-ID refusal is
 * testable without touching real wrangler or process.exit — returns a result
 * object instead of exiting directly.
 */
export async function runCli({ argv = process.argv, env = process.env } = {}) {
  const namespaceId = resolveKvNamespaceId({ argv, env });
  if (!namespaceId) {
    return {
      ok: false,
      error: 'missing_namespace_id',
      message: 'Refusing to run: no KV namespace ID provided. Pass --namespace-id <id> or set READ2LEAD_KV_NAMESPACE_ID.',
    };
  }
  const apply = argv.includes('--apply');
  const cliEnv = { READ2LEAD_CODES: makeRemoteKv(namespaceId) };
  const result = await convertCoinsToDiamonds(cliEnv, { apply });
  return { ok: true, namespace_id: namespaceId, result };
}

async function main() {
  const outcome = await runCli();
  if (!outcome.ok) {
    console.error('FAILED:', outcome.message);
    process.exitCode = 1;
    return;
  }
  const { result } = outcome;

  console.log(result.apply ? 'LIVE RUN — writes applied.' : 'DRY RUN — no writes made. Pass --apply to write for real.');
  console.log(`Namespace: ${outcome.namespace_id}`);
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
