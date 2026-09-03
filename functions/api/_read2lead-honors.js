/**
 * R2L Season Honors — pure ranking/exclusion logic. No KV, no I/O, fully
 * unit-testable (tests/read2lead-honors.test.mjs).
 *
 * Founder-approved payout for the "Amazing Summer" season
 * (SPEC/packet: R2L Season Honors — Blocks A+B): Top 1 = 10,000💎,
 * Top 2 = 5,000💎, Top 3 = 2,000💎, ranked by all-time rank points
 * (`lifetime_rp`).
 *
 * Reuse-first: pronunciation scoring reuses activityScore()/PROFILE_SKILLS
 * from _read2lead-profile-quality.js (both exported) rather than
 * reimplementing score normalization.
 */
import { activityScore, PROFILE_SKILLS } from './_read2lead-profile-quality.js';

export const HONORS_PRIZES = [10000, 5000, 2000]; // diamonds for rank 1, 2, 3

// The 'pronunciation' skill's activity types, read from the shared
// PROFILE_SKILLS table (functions/api/_read2lead-profile-quality.js) so this
// stays in sync with the rest of the profile-quality system automatically.
const PRONUNCIATION_TYPES =
  PROFILE_SKILLS.find((skill) => skill.key === 'pronunciation')?.types || [];

/**
 * True if `value` is a finite number after coercion, using `fallback`
 * (default 0) otherwise. Local helper — functions/api/_read2lead-v2-state.js
 * has an equivalent `numberOrZero` but does not export it.
 */
function numberOrZero(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * First value in `values` that coerces to a finite number, else `fallback`.
 */
function firstFiniteNumber(values, fallback = 0) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Same masking format as functions/api/read2lead-leaderboard.js's private
 * maskCode() (kept in sync by tests/read2lead-honors.test.mjs asserting both
 * produce the same string for the same input) — duplicated rather than
 * imported because the packet scope does not include editing
 * read2lead-leaderboard.js to export it.
 */
export function maskCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  const last = clean.slice(-4) || '----';
  if (clean.startsWith('R2L-')) return `R2L-***${last}`;
  return `***${last}`;
}

/**
 * Real student name for a record, same fallback chain
 * normalizeProgressState() uses when it builds state.student_name:
 * student_profile.student_name -> progress.student_name -> state.student_name.
 */
function resolveStudentName(codeData, state) {
  return String(
    codeData?.student_profile?.student_name
    || codeData?.progress?.student_name
    || state?.student_name
    || '',
  ).trim();
}

/**
 * Why a code is excluded from Season Honors ranking/prizes, or null if it's
 * eligible. Strict `=== true` checks match how is_test/is_shared are read in
 * functions/api/read2lead-progress.js (lines 68-69, 149) and is_bot in
 * functions/api/admin/codes/[code]/set-bot-stats.js (line 27).
 *
 * `state` is optional: honorsExclusionReason(codeData) alone still classifies
 * is_bot/is_test/is_shared and any no_name case resolvable from codeData's
 * own student_profile/progress fields. Pass `state` too (as
 * buildHonorsRanking does) to also catch the state.student_name fallback.
 */
export function honorsExclusionReason(codeData, state = null) {
  if (codeData?.is_bot === true) return 'is_bot';
  if (codeData?.is_test === true) return 'is_test';
  if (codeData?.is_shared === true) return 'is_shared';
  if (!resolveStudentName(codeData, state)) return 'no_name';
  return null;
}

/**
 * Season-windowed pronunciation average for one student, from their
 * pack_history. Reuses activityScore() to normalize each pack_history
 * activity_scores entry (they are already {type, score_percent} shaped by
 * compactActivityScores() at save time, so this re-derivation is a no-op
 * pass-through — see activityScore()'s `explicit` branch) and filters to the
 * 'pronunciation' skill's types (listen_and_speak, read_aloud).
 *
 * Date bounds are inclusive; a plain YYYY-MM-DD `toIso` is treated as
 * end-of-day so the season's last calendar day counts in full.
 *
 * @returns {{percent: number|null, sample_count: number}} percent is null
 *   when sample_count < 3 (too few samples to be meaningful).
 */
export function buildSeasonPronunciation({ packHistory = [], fromIso = null, toIso = null } = {}) {
  const fromMs = fromIso ? Date.parse(fromIso) : -Infinity;
  const toMs = toIso
    ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(toIso) ? `${toIso}T23:59:59.999Z` : toIso)
    : Infinity;

  const scores = [];
  for (const entry of Array.isArray(packHistory) ? packHistory : []) {
    const completedMs = Date.parse(entry?.completed_at || '');
    if (!Number.isFinite(completedMs) || completedMs < fromMs || completedMs > toMs) continue;
    for (const raw of Array.isArray(entry?.activity_scores) ? entry.activity_scores : []) {
      const scored = activityScore(raw);
      if (!scored || !PRONUNCIATION_TYPES.includes(scored.type)) continue;
      scores.push(scored.score_percent);
    }
  }

  const sampleCount = scores.length;
  const percent = sampleCount >= 3
    ? Math.round(scores.reduce((sum, value) => sum + value, 0) / sampleCount)
    : null;
  return { percent, sample_count: sampleCount };
}

/**
 * Build one ranking row (still carrying the raw access_code, needed
 * internally for the final access-code tiebreak and by
 * scripts/grant-season-honors.mjs to know which KV record to pay — stripped
 * before the row is handed back to a caller that only wants the public
 * shape, see buildHonorsRanking()).
 */
function buildHonorsRow(entry, seasonWindow) {
  const { access_code: accessCode, codeData, state } = entry;
  const completedBooks = Array.isArray(codeData?.completed_books) ? codeData.completed_books : [];
  const pronunciation = buildSeasonPronunciation({
    packHistory: state?.pack_history,
    fromIso: seasonWindow?.from,
    toIso: seasonWindow?.to,
  });
  const packHistoryLength = Array.isArray(state?.pack_history) ? state.pack_history.length : 0;

  return {
    access_code: String(accessCode || '').trim().toUpperCase(),
    masked_code: maskCode(accessCode),
    student_name: resolveStudentName(codeData, state),
    lifetime_rp: firstFiniteNumber([state?.lifetime_rp, state?.rank_points], 0),
    completed_packs: numberOrZero(state?.completed_packs),
    completed_books: completedBooks.length,
    pronunciation_percent: pronunciation.percent,
    pronunciation_sample_count: pronunciation.sample_count,
    // pack_history is capped at 50 entries (LEARNING_HISTORY_LIMIT in
    // _read2lead-v2-state.js), so a student who has completed 50+ packs may
    // be missing their earliest ones from the tiebreak inputs above.
    tiebreak_confidence: packHistoryLength >= 50 ? 'partial' : 'full',
  };
}

/**
 * DESC by lifetime_rp -> season pronunciation % -> completed_packs ->
 * completed_books count -> access_code ASC (final deterministic tiebreak, so
 * two runs over the same data always produce the same order). A null
 * pronunciation_percent (fewer than 3 samples) sorts below any real
 * percentage, including 0%.
 */
function compareHonorsRows(a, b) {
  if (b.lifetime_rp !== a.lifetime_rp) return b.lifetime_rp - a.lifetime_rp;
  const aPct = a.pronunciation_percent ?? -1;
  const bPct = b.pronunciation_percent ?? -1;
  if (bPct !== aPct) return bPct - aPct;
  if (b.completed_packs !== a.completed_packs) return b.completed_packs - a.completed_packs;
  if (b.completed_books !== a.completed_books) return b.completed_books - a.completed_books;
  if (a.access_code < b.access_code) return -1;
  if (a.access_code > b.access_code) return 1;
  return 0;
}

/**
 * Build the full Season Honors ranking from access-code entries.
 *
 * Exclusion runs FIRST, before any sorting or tiebreaking — an excluded
 * entry (bot/test/shared/no-name) never reaches the comparator, so it can
 * never win a podium spot by tiebreak luck even if it would otherwise sort
 * to the top.
 *
 * @param {{access_code: string, codeData: object, state: object}[]} entries
 * @param {{seasonId?: string, seasonWindow?: {from?: string, to?: string}}} [options]
 */
export function buildHonorsRanking(entries, { seasonWindow = null } = {}) {
  const included = [];
  const excluded = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const reason = honorsExclusionReason(entry?.codeData, entry?.state);
    if (reason) {
      excluded.push({ masked_code: maskCode(entry?.access_code), reason });
      continue;
    }
    included.push(entry);
  }

  const rows = included
    .map((entry) => buildHonorsRow(entry, seasonWindow))
    .sort(compareHonorsRows);

  const honorRoll = rows.map((row, index) => ({ ...row, rank: index + 1 }));
  const podium = honorRoll.slice(0, 3).map((row) => ({
    ...row,
    prize_diamonds: HONORS_PRIZES[row.rank - 1],
  }));

  return {
    podium,
    honor_roll: honorRoll,
    excluded,
    participants_count: honorRoll.length,
  };
}
