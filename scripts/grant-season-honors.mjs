#!/usr/bin/env node
/**
 * R2L Season Honors — the prize-grant script. Freezes a snapshot of the
 * "Amazing Summer" (2026-S1) podium/honor-roll/excluded list at KV key
 * `honors:2026-S1`, then pays each podium member their prize_diamonds.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written unless --apply is passed. This
 * is a PRODUCTION currency + medal write touching real children's balances
 * (same weight as convert-coins-to-diamonds.mjs) — the live --apply run
 * happens only on Phương's explicit OK, logged in _ops/AGENT_LOG.md (see
 * ~/.claude/rules/mcp-infra-use.md). Mark (this packet's author) built and
 * unit-tested this with MOCKED KV ONLY (tests/grant-season-honors.test.mjs)
 * and did not run it against any real KV namespace, and did not run wrangler.
 *
 * Reuse-first: ranking comes from buildHonorsRanking() in
 * functions/api/_read2lead-honors.js (already built + 12/12 tested); the
 * season scan reuses scanSeasonEntries()/SEASON_WINDOW from
 * scripts/season-census.mjs rather than duplicating the list/get loop — but
 * ONLY when there is no existing frozen snapshot yet (see freezeSeasonHonors
 * doc comment below: once frozen, live data must stop being re-read for
 * ranking purposes). Currency + medal writes go through the exact same
 * loadProgressState()/saveProgressState() the live Worker uses, same as
 * convert-coins-to-diamonds.mjs.
 *
 * Idempotency (the critical property): the paid-marker is a medal appended
 * to state.medals — {season_id:'2026-S1', kind:'honors', honors_rank, ...}.
 * Diamonds and the medal land in ONE saveProgressState() call, so money and
 * marker are never split by a crash mid-run. Before paying, a podium member
 * whose state.medals already carries that medal is skipped and reported
 * `already_paid`, contributing 0 — running --apply twice is safe.
 *
 * Usage:
 *   node scripts/grant-season-honors.mjs --namespace-id <id>              # dry run (default)
 *   node scripts/grant-season-honors.mjs --namespace-id <id> --apply      # live pay
 *   node scripts/grant-season-honors.mjs --namespace-id <id> --force --apply   # re-freeze (only if nothing paid yet)
 *   node scripts/grant-season-honors.mjs --namespace-id <id> --revoke --apply  # exact inverse of a payment
 *   READ2LEAD_KV_NAMESPACE_ID=<id> node scripts/grant-season-honors.mjs
 *
 * The KV namespace ID is REQUIRED and must come explicitly from
 * --namespace-id or the READ2LEAD_KV_NAMESPACE_ID env var — no hardcoded
 * default (same refusal contract as convert-coins-to-diamonds.mjs and
 * season-census.mjs).
 */
import {
  loadProgressState,
  saveProgressState,
  progressNamespace,
} from '../functions/api/_read2lead-v2-state.js';
import { buildHonorsRanking } from '../functions/api/_read2lead-honors.js';
import { scanSeasonEntries, SEASON_WINDOW } from './season-census.mjs';
import {
  makeRemoteKv,
  resolveKvNamespaceId as resolveKvNamespaceIdFor,
} from './_kv-remote.mjs';

export const SEASON_ID = '2026-S1';
export const SEASON_NAME_VI = 'Amazing Summer';
export const SEASON_EMOJI = '🌞';
export const HONORS_KV_KEY = `honors:${SEASON_ID}`;
export const HONORS_BASIS = 'lifetime_rp';
export const HONORS_BASIS_LABEL_VI = 'Điểm xếp hạng toàn thời gian';

export function resolveKvNamespaceId({ argv = process.argv, env = process.env } = {}) {
  return resolveKvNamespaceIdFor('READ2LEAD_KV_NAMESPACE_ID', { argv, env });
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function honorsError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

/**
 * Pure: turn a buildHonorsRanking() result into the frozen-snapshot shape
 * written to KV. Each podium row gets the payment-tracking fields
 * (paid_at/diamonds_before/diamonds_after) initialized to null — payFlow()
 * below is the only thing that fills them in.
 */
export function buildHonorsSnapshot(ranking, { seasonWindow = SEASON_WINDOW, nowIso = new Date().toISOString() } = {}) {
  return {
    season_id: SEASON_ID,
    season_name_vi: SEASON_NAME_VI,
    emoji: SEASON_EMOJI,
    window: { from: seasonWindow?.from ?? null, to: seasonWindow?.to ?? null },
    basis: HONORS_BASIS,
    basis_label_vi: HONORS_BASIS_LABEL_VI,
    frozen_at: nowIso,
    published: false,
    podium: ranking.podium.map((row) => ({ ...row, paid_at: null, diamonds_before: null, diamonds_after: null })),
    honor_roll: ranking.honor_roll,
    excluded: ranking.excluded,
    participants_count: ranking.participants_count,
  };
}

/**
 * Freeze (create) the honors:2026-S1 snapshot. This is the operation the
 * "refuses to overwrite" contract belongs to — it ALWAYS refuses to clobber
 * an existing snapshot unless `force` is passed, and refuses `force` itself
 * once any podium member has been paid. Exported (and called directly by
 * the bite tests) so the freeze-guard behavior is testable in isolation from
 * the pay flow, which handles a "not re-frozen this run" result gracefully
 * (see grantSeasonHonors below) rather than treating it as fatal.
 *
 * With `apply: false` this builds and returns the snapshot that WOULD be
 * frozen, but never calls kv.put — used for the dry-run report when no
 * snapshot exists yet.
 *
 * @throws {Error} code 'honors_already_frozen' — snapshot exists, no force.
 * @throws {Error} code 'honors_already_paid' — force requested, but the
 *   existing snapshot has at least one podium[].paid_at set.
 */
export async function freezeSeasonHonors(env, {
  seasonWindow = SEASON_WINDOW,
  nowIso = new Date().toISOString(),
  force = false,
  apply = true,
} = {}) {
  const kv = progressNamespace(env);
  if (!kv) throw new Error('READ2LEAD_PROGRESS or READ2LEAD_CODES binding missing');

  const existing = await kv.get(HONORS_KV_KEY, { type: 'json' });
  if (existing) {
    const anyPaid = Array.isArray(existing.podium) && existing.podium.some((row) => row.paid_at);
    if (force) {
      if (anyPaid) throw honorsError('honors_already_paid');
      // else: nothing paid yet, force permits a fresh re-scan + overwrite below.
    } else {
      throw honorsError('honors_already_frozen');
    }
  }

  const entries = await scanSeasonEntries(env);
  const ranking = buildHonorsRanking(entries, { seasonWindow });
  const snapshot = buildHonorsSnapshot(ranking, { seasonWindow, nowIso });

  if (apply) {
    await kv.put(HONORS_KV_KEY, JSON.stringify(snapshot));
  }
  return snapshot;
}

/**
 * Pay every podium member their prize_diamonds, using `snapshot.podium` for
 * who/how-much and each member's own KV progress record for idempotency
 * (state.medals) and the actual balance. Diamonds + the paid-marker medal
 * land in ONE saveProgressState() call per member — see module doc comment.
 */
async function payFlow(env, snapshot, { apply, freezeNote }) {
  const kv = progressNamespace(env);
  const rows = [];
  const updatedPodium = [];
  let totalDiamondsPaidNow = 0;

  for (const member of snapshot.podium) {
    // eslint-disable-next-line no-await-in-loop
    const state = await loadProgressState(env, member.access_code);
    const diamondsBefore = numberOrZero(state.diamonds);
    const alreadyPaid = Array.isArray(state.medals)
      && state.medals.some((medal) => medal.season_id === SEASON_ID && medal.kind === 'honors');

    if (alreadyPaid) {
      rows.push({
        access_code: member.access_code,
        masked_code: member.masked_code,
        student_name: member.student_name,
        rank: member.rank,
        prize_diamonds: member.prize_diamonds,
        diamonds_before: diamondsBefore,
        diamonds_after: diamondsBefore,
        status: 'already_paid',
      });
      updatedPodium.push(member);
      continue;
    }

    const nowTs = new Date().toISOString();
    const diamondsAfter = diamondsBefore + member.prize_diamonds;

    if (apply) {
      const medal = {
        season_id: SEASON_ID,
        name_vi: snapshot.season_name_vi,
        emoji: snapshot.emoji,
        kind: 'honors',
        honors_rank: member.rank,
        reward_diamonds: member.prize_diamonds,
        peak_label_vi: '',
        peak_tier_index: 0,
        ts: nowTs,
      };
      // eslint-disable-next-line no-await-in-loop
      await saveProgressState(env, member.access_code, {
        ...state,
        diamonds: diamondsAfter,
        medals: [...(Array.isArray(state.medals) ? state.medals : []), medal],
      });
      totalDiamondsPaidNow += member.prize_diamonds;
    }

    rows.push({
      access_code: member.access_code,
      masked_code: member.masked_code,
      student_name: member.student_name,
      rank: member.rank,
      prize_diamonds: member.prize_diamonds,
      diamonds_before: diamondsBefore,
      diamonds_after: apply ? diamondsAfter : diamondsBefore,
      status: apply ? 'paid' : 'dry_run',
    });
    updatedPodium.push({
      ...member,
      paid_at: apply ? nowTs : member.paid_at,
      diamonds_before: apply ? diamondsBefore : member.diamonds_before,
      diamonds_after: apply ? diamondsAfter : member.diamonds_after,
    });
  }

  if (apply) {
    await kv.put(HONORS_KV_KEY, JSON.stringify({ ...snapshot, podium: updatedPodium }));
  }

  return {
    ok: true,
    apply,
    action: 'grant',
    season_id: SEASON_ID,
    freeze_note: freezeNote,
    rows,
    total_diamonds_paid: totalDiamondsPaidNow,
    written: apply,
  };
}

/**
 * Exact inverse of payFlow(): for every podium member carrying the
 * 2026-S1 honors medal, subtract its reward_diamonds (clamped at 0), and
 * remove the medal — in one saveProgressState() call, same atomicity
 * guarantee as paying. Members never paid are reported `not_paid` and left
 * untouched.
 */
async function revokeFlow(env, snapshot, { apply }) {
  const kv = progressNamespace(env);
  const rows = [];
  const updatedPodium = [];

  for (const member of snapshot.podium) {
    // eslint-disable-next-line no-await-in-loop
    const state = await loadProgressState(env, member.access_code);
    const medals = Array.isArray(state.medals) ? state.medals : [];
    const medalIndex = medals.findIndex((medal) => medal.season_id === SEASON_ID && medal.kind === 'honors');
    const diamondsBefore = numberOrZero(state.diamonds);

    if (medalIndex === -1) {
      rows.push({
        access_code: member.access_code,
        masked_code: member.masked_code,
        student_name: member.student_name,
        rank: member.rank,
        prize_diamonds: member.prize_diamonds,
        diamonds_before: diamondsBefore,
        diamonds_after: diamondsBefore,
        status: 'not_paid',
      });
      updatedPodium.push(member);
      continue;
    }

    const medal = medals[medalIndex];
    const diamondsAfter = Math.max(0, diamondsBefore - numberOrZero(medal.reward_diamonds));

    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await saveProgressState(env, member.access_code, {
        ...state,
        diamonds: diamondsAfter,
        medals: medals.filter((_, index) => index !== medalIndex),
      });
    }

    rows.push({
      access_code: member.access_code,
      masked_code: member.masked_code,
      student_name: member.student_name,
      rank: member.rank,
      prize_diamonds: member.prize_diamonds,
      diamonds_before: diamondsBefore,
      diamonds_after: apply ? diamondsAfter : diamondsBefore,
      status: apply ? 'revoked' : 'dry_run_revoke',
    });
    updatedPodium.push({
      ...member,
      paid_at: apply ? null : member.paid_at,
      diamonds_before: apply ? null : member.diamonds_before,
      diamonds_after: apply ? null : member.diamonds_after,
    });
  }

  if (apply) {
    await kv.put(HONORS_KV_KEY, JSON.stringify({ ...snapshot, podium: updatedPodium }));
  }

  return {
    ok: true,
    apply,
    action: 'revoke',
    season_id: SEASON_ID,
    rows,
    written: apply,
  };
}

/**
 * Top-level orchestration used by the CLI. Freezes the snapshot if none
 * exists yet (or --force rebuilds one, refused if anything's already paid);
 * when a snapshot already exists and --force wasn't passed, freezing is
 * skipped (not fatal — freezeSeasonHonors's 'honors_already_frozen' is
 * swallowed here) and the existing frozen podium is reused as-is, which is
 * what makes running this twice with --apply safe (see BAD-2).
 *
 * @param {object} env - {READ2LEAD_CODES} (or READ2LEAD_PROGRESS), same
 *   shape loadProgressState/saveProgressState expect.
 * @param {{apply?: boolean, force?: boolean, revoke?: boolean, seasonWindow?: object, nowIso?: string}} [options]
 */
export async function grantSeasonHonors(env, {
  apply = false,
  force = false,
  revoke = false,
  seasonWindow = SEASON_WINDOW,
  nowIso = new Date().toISOString(),
} = {}) {
  const kv = progressNamespace(env);
  if (!kv) throw new Error('READ2LEAD_PROGRESS or READ2LEAD_CODES binding missing');

  if (revoke) {
    const existing = await kv.get(HONORS_KV_KEY, { type: 'json' });
    if (!existing) return { ok: false, error: 'honors_not_frozen' };
    return revokeFlow(env, existing, { apply });
  }

  let snapshot;
  let freezeNote = 'frozen_now';
  try {
    snapshot = await freezeSeasonHonors(env, { seasonWindow, nowIso, force, apply });
  } catch (err) {
    if (err.code === 'honors_already_paid') {
      return { ok: false, error: 'honors_already_paid' };
    }
    if (err.code === 'honors_already_frozen') {
      // Not fatal for the grant flow: reuse what's already frozen instead
      // of re-scanning (season-census.mjs's scanSeasonEntries() must not be
      // called again once a snapshot exists — it reads live, drifting data).
      snapshot = await kv.get(HONORS_KV_KEY, { type: 'json' });
      freezeNote = 'honors_already_frozen';
    } else {
      throw err;
    }
  }

  return payFlow(env, snapshot, { apply, freezeNote });
}

/**
 * CLI entry point, split out from main() so the namespace-ID refusal is
 * testable without touching real wrangler or process.exit.
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
  const force = argv.includes('--force');
  const revoke = argv.includes('--revoke');
  const cliEnv = { READ2LEAD_CODES: makeRemoteKv(namespaceId) };
  const result = await grantSeasonHonors(cliEnv, { apply, force, revoke, seasonWindow: SEASON_WINDOW });
  return { ok: true, namespace_id: namespaceId, result };
}

async function main() {
  const outcome = await runCli();
  if (!outcome.ok) {
    console.error('FAILED:', outcome.message);
    process.exitCode = 1;
    return;
  }
  const { result, namespace_id: namespaceId } = outcome;
  if (!result.ok) {
    console.error(`FAILED: ${result.error}`);
    if (result.error === 'honors_already_paid') {
      console.error('--force cannot re-freeze: at least one podium member has already been paid this season.');
    } else if (result.error === 'honors_not_frozen') {
      console.error('--revoke has nothing to undo: no honors:2026-S1 snapshot exists yet.');
    }
    process.exitCode = 1;
    return;
  }

  const label = result.action === 'revoke' ? 'REVOKE' : 'GRANT';
  console.log(`R2L Season Honors — ${label} (namespace ${namespaceId})`);
  console.log(result.apply ? 'LIVE RUN — writes applied.' : 'DRY RUN — no writes made. Pass --apply to write for real.');
  if (result.action === 'grant') {
    console.log(
      result.freeze_note === 'honors_already_frozen'
        ? `Snapshot ${HONORS_KV_KEY} already exists — reusing the frozen podium (did not re-scan).`
        : `Froze a new snapshot at ${HONORS_KV_KEY}.`,
    );
  }
  console.log('');

  for (const row of result.rows) {
    console.log(`  #${row.rank} ${row.student_name} (${row.masked_code}): ${row.status} — prize ${row.prize_diamonds}💎, current ${row.diamonds_before}💎 -> new ${row.diamonds_after}💎`);
  }

  console.log('');
  if (result.action === 'revoke') {
    const totalReclaimed = result.rows.reduce((sum, row) => sum + (row.diamonds_before - row.diamonds_after), 0);
    console.log(`Total diamonds reclaimed this run: ${totalReclaimed}`);
  } else {
    console.log(`Total diamonds paid this run: ${result.total_diamonds_paid}`);
  }
  console.log(result.written ? 'WRITES WERE APPLIED to KV.' : 'NOTHING WAS WRITTEN — this was a dry run.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
}
