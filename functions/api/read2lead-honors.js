// R2L Season Honors — public read endpoint. No auth, read-only: reads ONLY
// the frozen `honors:<season>` KV snapshot (written by
// scripts/grant-season-honors.mjs / flipped by
// functions/api/admin/read2lead-honors.js) and reshapes it for public
// display. Never computes a ranking, never scans KV, never writes.
//
// Two traps this file exists to close (see the packet / buildPublicPodiumRow
// and buildPublicHonorRollRow below):
//   1. The frozen snapshot's podium/honor_roll rows carry `access_code` —
//      the child's login credential — plus payment-internal fields
//      (diamonds_before/diamonds_after/paid_at/lifetime_rp/
//      tiebreak_confidence), per-child skill data (`pronunciation_percent`,
//      `pronunciation_sample_count` — belongs on the private certificate
//      only, never a public wire payload), and the whole `excluded[]` list
//      (bot/test accounts, internal only). None of that may ever reach this
//      response — not the DOM, not the JSON body itself.
//   2. `honor_roll` is frozen in the OLD all-time lifetime_rp order, which
//      does not match the founder-confirmed, already-paid `podium` order
//      (see scripts/grant-season-honors.mjs's PODIUM_OVERRIDE_BASIS_NOTE).
//      Publishing honor_roll with its `rank` intact would publicly
//      contradict the prizes actually paid, so this shaper strips `rank`
//      from every honor_roll row and re-sorts it alphabetically by name —
//      order must never imply a ranking for anyone outside the podium.
import { getClientIp, checkCodeRateLimit, rateLimitedResponse } from './_rate-limit.js';
import { progressNamespace } from './_read2lead-v2-state.js';

// Same KV key scripts/grant-season-honors.mjs writes as HONORS_KV_KEY.
// Duplicated here rather than imported: that script (via
// scripts/_kv-remote.mjs) uses node:child_process/node:fs to talk to the
// Cloudflare API directly and must never be pulled into the Workers
// bundle — this packet's file scope doesn't include touching that script
// to split the constant out. Keep this string in sync with it by hand.
const HONORS_KV_KEY = 'honors:2026-S1';

const CACHE_CONTROL = 'public, max-age=60';

export async function onRequestGet(context) {
  const { request, env } = context;

  const clientIp = getClientIp(request);
  const rateLimit = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rateLimit.blocked) {
    return rateLimitedResponse(rateLimit.retryAfter);
  }

  const kv = progressNamespace(env);
  if (!kv) {
    // Config error (binding missing). Still degrades to "not announced yet"
    // rather than a 500 — the celebration UI should just render nothing.
    return json({ ok: true, published: false });
  }

  let snapshot;
  try {
    snapshot = await kv.get(HONORS_KV_KEY, { type: 'json' });
  } catch {
    return json({ ok: true, published: false });
  }

  return json(buildPublicHonorsPayload(snapshot));
}

/**
 * Pure: reshape a frozen honors snapshot (functions/api/admin/read2lead-honors.js's
 * full internal shape) into the public payload. Returns `{ok:true,
 * published:false}` for anything not safely publishable — not published,
 * missing, or malformed (podium/honor_roll not arrays) — so the caller
 * never has to special-case those.
 */
export function buildPublicHonorsPayload(snapshot) {
  if (!snapshot || snapshot.published !== true) {
    return { ok: true, published: false };
  }
  if (!Array.isArray(snapshot.podium) || !Array.isArray(snapshot.honor_roll)) {
    return { ok: true, published: false };
  }

  return {
    ok: true,
    published: true,
    season: {
      id: snapshot.season_id ?? null,
      name_vi: snapshot.season_name_vi ?? null,
      emoji: snapshot.emoji ?? null,
      window: snapshot.window ?? null,
    },
    frozen_at: snapshot.frozen_at ?? null,
    podium: snapshot.podium.map(buildPublicPodiumRow),
    honor_roll: sortHonorRollAlphabetically(snapshot.honor_roll.map(buildPublicHonorRollRow)),
    participants_count: numberOrZero(snapshot.participants_count),
  };
}

// Explicit allow-list — name every field copied out, never spread-then-strip.
// A future field added to the snapshot (podium or honor_roll) is invisible
// here by default; it must be deliberately added to one of these two
// functions to ever reach the public response.
// pronunciation_percent is deliberately NOT copied here — it belongs on the
// private certificate only (Trap 1, module doc comment above). A per-child
// skill assessment must never reach an unauthenticated public wire payload,
// even for the three podium children.
function buildPublicPodiumRow(row) {
  return {
    student_name: row?.student_name ?? '',
    masked_code: row?.masked_code ?? '',
    rank: row?.rank ?? null,
    prize_diamonds: row?.prize_diamonds ?? null,
    completed_books: numberOrZero(row?.completed_books),
    completed_packs: numberOrZero(row?.completed_packs),
  };
}

// Same allow-list shape as buildPublicPodiumRow, minus rank/prize_diamonds —
// honor_roll never carries a ranking publicly (see module doc comment, Trap 2).
// pronunciation_percent excluded for the same reason as buildPublicPodiumRow.
function buildPublicHonorRollRow(row) {
  return {
    student_name: row?.student_name ?? '',
    masked_code: row?.masked_code ?? '',
    completed_books: numberOrZero(row?.completed_books),
    completed_packs: numberOrZero(row?.completed_packs),
  };
}

// Alphabetical by student_name, locale-aware for Vietnamese diacritics —
// NOT by any score, so the array order can never read as a ranking.
function sortHonorRollAlphabetically(rows) {
  return [...rows].sort((a, b) => (a.student_name || '').localeCompare(b.student_name || '', 'vi'));
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': CACHE_CONTROL,
    },
  });
}
