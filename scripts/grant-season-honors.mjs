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
 *   node scripts/grant-season-honors.mjs --namespace-id <id> --podium <code1,code2,code3> --apply
 *     # founder-confirmed podium override (see PODIUM OVERRIDE below) — only
 *     # takes effect while freezing a NEW snapshot; ignored once one exists.
 *   READ2LEAD_KV_NAMESPACE_ID=<id> node scripts/grant-season-honors.mjs
 *
 * PODIUM OVERRIDE (added 2026-09-03): buildHonorsRanking() ranks by all-time
 * lifetime_rp, but the founder's actual instruction was "use the [app's own]
 * ranking" — the leaderboard the site already shows publicly, which orders
 * Percy/Hoang/Hieuenzo differently (see PODIUM_OVERRIDE_BASIS_NOTE below for
 * the full record). `--podium <code1,code2,code3>` (comma-separated, order
 * significant) freezes the snapshot's top-3 in that exact order instead,
 * still subject to the same KV-existence and exclusion checks
 * buildHonorsRanking() itself applies — see resolvePodiumOverride().
 * honor_roll and excluded are always computed from buildHonorsRanking() and
 * are unaffected by this flag. Without --podium, behaviour is unchanged.
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
import { buildHonorsRanking, honorsExclusionReason, HONORS_PRIZES } from '../functions/api/_read2lead-honors.js';
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

// Basis fields written to the snapshot when a podiumOverride is supplied —
// see grantSeasonHonors's podiumOverride option below. buildHonorsRanking()
// still computes honor_roll/excluded as always; only the top-3 podium order
// and its provenance fields differ from the default lifetime_rp-ranked path.
export const PODIUM_OVERRIDE_BASIS = 'app_leaderboard_order';
export const PODIUM_OVERRIDE_BASIS_LABEL_VI = 'Thứ hạng trên bảng xếp hạng';
export const PODIUM_OVERRIDE_BASIS_NOTE = 'Founder-confirmed 2026-09-03 against the app\'s '
  + 'displayed leaderboard order (Percy 1st, Hoang 2nd, Hieuenzo 3rd) — the site already shows '
  + 'this same trio as the Amazing Summer podium publicly. buildHonorsRanking()\'s all-time '
  + 'lifetime_rp order was NOT used to pick this podium: all three finished the season at the '
  + 'identical tier (Kim Cương III), and the ranking\'s own tiebreak among them (reward_coins) is '
  + 'dead code that normalizeMedals() no longer emits. See _ops/AGENT_LOG.md and the R2L Season '
  + 'Honors podium-override packet for the record.';

const PODIUM_ERROR_CODES = new Set([
  'podium_wrong_length',
  'podium_duplicate_code',
  'podium_code_not_found',
  'podium_code_excluded',
]);

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

/** Same shape as honorsError(), but carries the offending podium code/reason
 * for the caller to report — "refuse loudly, name the code", never a bare
 * boolean failure. */
function podiumError(code, { podiumCode = null, reason = null } = {}) {
  const detail = [podiumCode, reason ? `(${reason})` : null].filter(Boolean).join(' ');
  const err = new Error(detail ? `${code}: ${detail}` : code);
  err.code = code;
  if (podiumCode) err.podiumCode = podiumCode;
  if (reason) err.reason = reason;
  return err;
}

/**
 * Validate + resolve a founder-confirmed podiumOverride (an ordered array of
 * access codes) into podium rows carrying the exact same computed fields
 * buildHonorsRanking() itself produces (lifetime_rp, completed_packs,
 * completed_books, pronunciation_percent, ...) — but ordered and prized by
 * the override list's position instead of buildHonorsRanking()'s own
 * lifetime_rp sort. buildHonorsRanking()'s exclusion rules (bot/test/
 * shared/no-name) still apply: the founder confirming an order does not
 * bypass them.
 *
 * Refuses loudly on: wrong length, a duplicate code, a code with no
 * matching KV access-code record, or a code that fails
 * honorsExclusionReason(). Never silently drops or truncates the list.
 *
 * @param {string[]} podiumOverride
 * @param {{access_code: string, codeData: object, state: object}[]} entries
 * @param {{honor_roll: object[]}} ranking - buildHonorsRanking()'s result
 *   over the same `entries`, reused so the override's rows carry identical
 *   computed fields to the default ranked path.
 * @throws {Error} code one of podium_wrong_length / podium_duplicate_code /
 *   podium_code_not_found / podium_code_excluded (err.podiumCode / err.reason
 *   name the offending code/reason where applicable).
 */
function resolvePodiumOverride(podiumOverride, entries, ranking) {
  if (!Array.isArray(podiumOverride) || podiumOverride.length !== HONORS_PRIZES.length) {
    throw podiumError('podium_wrong_length');
  }

  const normalized = podiumOverride.map((code) => String(code || '').trim().toUpperCase());
  const seen = new Set();
  for (const code of normalized) {
    if (seen.has(code)) throw podiumError('podium_duplicate_code', { podiumCode: code });
    seen.add(code);
  }

  const entryByCode = new Map(
    entries.map((entry) => [String(entry.access_code || '').trim().toUpperCase(), entry]),
  );
  const honorRollByCode = new Map(ranking.honor_roll.map((row) => [row.access_code, row]));

  return normalized.map((code, index) => {
    const entry = entryByCode.get(code);
    if (!entry) throw podiumError('podium_code_not_found', { podiumCode: code });

    const reason = honorsExclusionReason(entry.codeData, entry.state);
    if (reason) throw podiumError('podium_code_excluded', { podiumCode: code, reason });

    // Not excluded, so buildHonorsRanking() must have this code in
    // honor_roll — pull its computed row rather than recomputing it.
    const row = honorRollByCode.get(code);
    return { ...row, rank: index + 1, prize_diamonds: HONORS_PRIZES[index] };
  });
}

/**
 * Pure: turn a buildHonorsRanking() result into the frozen-snapshot shape
 * written to KV. Each podium row gets the payment-tracking fields
 * (paid_at/diamonds_before/diamonds_after) initialized to null — payFlow()
 * below is the only thing that fills them in.
 *
 * `overridePodium`, when supplied (already-validated rows from
 * resolvePodiumOverride(), in founder-confirmed order), REPLACES
 * ranking.podium as the snapshot's podium and switches the basis/
 * basis_label_vi/basis_note provenance fields to the override values —
 * honor_roll and excluded still come from `ranking` unchanged either way.
 */
export function buildHonorsSnapshot(ranking, {
  seasonWindow = SEASON_WINDOW,
  nowIso = new Date().toISOString(),
  overridePodium = null,
} = {}) {
  const podiumRows = overridePodium ?? ranking.podium;
  return {
    season_id: SEASON_ID,
    season_name_vi: SEASON_NAME_VI,
    emoji: SEASON_EMOJI,
    window: { from: seasonWindow?.from ?? null, to: seasonWindow?.to ?? null },
    basis: overridePodium ? PODIUM_OVERRIDE_BASIS : HONORS_BASIS,
    basis_label_vi: overridePodium ? PODIUM_OVERRIDE_BASIS_LABEL_VI : HONORS_BASIS_LABEL_VI,
    ...(overridePodium ? { basis_note: PODIUM_OVERRIDE_BASIS_NOTE } : {}),
    frozen_at: nowIso,
    published: false,
    podium: podiumRows.map((row) => ({ ...row, paid_at: null, diamonds_before: null, diamonds_after: null })),
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
 * `podiumOverride`, when supplied, only takes effect for THIS freeze — an
 * ordered array of access codes (length must equal HONORS_PRIZES.length)
 * that replaces buildHonorsRanking()'s own top-3 order; see
 * resolvePodiumOverride() for the validation it goes through first (never
 * silently dropped). It has no effect when an existing snapshot is reused
 * (the honors_already_frozen path below) — once frozen, a podium is fixed.
 *
 * @throws {Error} code 'honors_already_frozen' — snapshot exists, no force.
 * @throws {Error} code 'honors_already_paid' — force requested, but the
 *   existing snapshot has at least one podium[].paid_at set.
 * @throws {Error} code one of podium_wrong_length / podium_duplicate_code /
 *   podium_code_not_found / podium_code_excluded — see resolvePodiumOverride().
 */
export async function freezeSeasonHonors(env, {
  seasonWindow = SEASON_WINDOW,
  nowIso = new Date().toISOString(),
  force = false,
  apply = true,
  podiumOverride = null,
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
  const overridePodium = podiumOverride
    ? resolvePodiumOverride(podiumOverride, entries, ranking)
    : null;
  const snapshot = buildHonorsSnapshot(ranking, { seasonWindow, nowIso, overridePodium });

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
 * `podiumOverride` (an ordered array of access codes, see
 * resolvePodiumOverride()/freezeSeasonHonors() above) is refused loudly and
 * returned as `{ ok: false, error: <podium_*>, podium_code, reason }` —
 * never thrown past this function and never lets a single bad code in the
 * list silently drop or reorder the rest. It only affects freezing a NEW
 * snapshot; a run that reuses an already-frozen one ignores it.
 *
 * @param {object} env - {READ2LEAD_CODES} (or READ2LEAD_PROGRESS), same
 *   shape loadProgressState/saveProgressState expect.
 * @param {{apply?: boolean, force?: boolean, revoke?: boolean, seasonWindow?: object, nowIso?: string, podiumOverride?: string[]}} [options]
 */
export async function grantSeasonHonors(env, {
  apply = false,
  force = false,
  revoke = false,
  seasonWindow = SEASON_WINDOW,
  nowIso = new Date().toISOString(),
  podiumOverride = null,
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
    snapshot = await freezeSeasonHonors(env, { seasonWindow, nowIso, force, apply, podiumOverride });
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
    } else if (PODIUM_ERROR_CODES.has(err.code)) {
      return {
        ok: false,
        error: err.code,
        podium_code: err.podiumCode ?? null,
        reason: err.reason ?? null,
      };
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
  const podiumFlagIndex = argv.indexOf('--podium');
  const podiumOverride = podiumFlagIndex !== -1 && argv[podiumFlagIndex + 1]
    ? argv[podiumFlagIndex + 1].split(',').map((code) => code.trim())
    : null;
  const cliEnv = { READ2LEAD_CODES: makeRemoteKv(namespaceId) };
  const result = await grantSeasonHonors(cliEnv, {
    apply, force, revoke, seasonWindow: SEASON_WINDOW, podiumOverride,
  });
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
    } else if (result.error === 'podium_wrong_length') {
      console.error(`--podium must name exactly ${HONORS_PRIZES.length} codes, in order.`);
    } else if (result.error === 'podium_duplicate_code') {
      console.error(`--podium has a duplicate code: ${result.podium_code}`);
    } else if (result.error === 'podium_code_not_found') {
      console.error(`--podium named a code with no matching KV record: ${result.podium_code}`);
    } else if (result.error === 'podium_code_excluded') {
      console.error(`--podium named an excluded code: ${result.podium_code} (${result.reason})`);
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
