import { honorsExclusionReason } from '../../api/_read2lead-honors.js';
import { isAccessCodeKey, normalizeProgressState, progressKey } from '../../api/_read2lead-v2-state.js';
import { getClientIp, checkCodeRateLimit, rateLimitedResponse } from '../../api/_rate-limit.js';

export const STARS_CONFIG_KEY = 'config:learning-stars:v1';
export function starsEligible(account, state, now = new Date()) {
  if (!account || honorsExclusionReason(account, state)) return false;
  if (account.active === false || account.enabled === false || account.disabled === true || account.is_disabled === true || account.is_demo === true || account.demo === true || account.revoked_at || account.deactivated_at || account.deleted_at) return false;
  if (['disabled', 'inactive', 'deactivated', 'revoked', 'deleted', 'expired'].includes(account.status)) return false;
  if (account.expires_at && (!Number.isFinite(Date.parse(account.expires_at)) || Date.parse(account.expires_at) <= new Date(now).getTime())) return false;
  return true;
}

export const RANKS_VERSION = 'r2l-ranks-v2';
const metricValue = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0);

// All-time boards across every eligible real student: `xp` ranks lifetime total_xp,
// `diamonds` ranks the current diamond balance. No weekly window, no start date, no bots.
export function buildLearningBoards(entries, { now = new Date(), ownCode = '', limit = 50 } = {}) {
  const eligible = entries.filter(e => isAccessCodeKey(e.code) && starsEligible(e.account, e.state, now));
  const rows = eligible.map(e => ({ code: e.code, display_name: String(e.account.student_profile?.student_name || e.state.student_name || '').trim(),
    avatar: { monster: Object.fromEntries(['body','color','eyes','mouth','arms','detail','effects','frame','hat','pet','wings'].filter(key => typeof e.state.avatar?.monster?.[key] === 'string').map(key => [key, e.state.avatar.monster[key]])) }, totals: { xp: metricValue(e.state.total_xp), diamonds: metricValue(e.state.diamonds) } }));
  const boards = {};
  for (const metric of ['xp', 'diamonds']) {
    const sorted = rows.filter(r => r.totals[metric] > 0).sort((a, b) => b.totals[metric] - a.totals[metric] || a.display_name.localeCompare(b.display_name, 'vi') || a.code.localeCompare(b.code));
    let previous = null, rank = 0;
    const ranked = sorted.map((row, index) => {
      if (row.totals[metric] !== previous) rank = index + 1;
      previous = row.totals[metric];
      return { rank, display_name: row.display_name, avatar: row.avatar, total: row.totals[metric], is_self: row.code === ownCode };
    });
    const own = rows.find(r => r.code === ownCode);
    boards[metric] = { leaders: ranked.slice(0, Math.min(100, Math.max(1, limit))), participants: ranked.length,
      own: ranked.find(r => r.is_self) || (own ? { rank: null, display_name: own.display_name, avatar: own.avatar, total: 0, is_self: true } : null) };
  }
  return { ok: true, version: RANKS_VERSION, boards };
}

export async function learningStarsResponse({ request, env }) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'config_error' }, 500);
  try {
    const rate = await checkCodeRateLimit(env.READ2LEAD_CODES, getClientIp(request));
    if (rate.blocked) return rateLimitedResponse(rate.retryAfter);
    const now = new Date(), entries = [];
    let cursor;
    do {
      const page = await env.READ2LEAD_CODES.list({ limit: 100, cursor });
      for (const key of page.keys) {
        if (!isAccessCodeKey(key.name)) continue;
        const account = await env.READ2LEAD_CODES.get(key.name, { type: 'json' });
        if (!account || account.is_bot === true || account.is_test === true || account.is_shared === true) continue;
        const stored = await (env.READ2LEAD_PROGRESS || env.READ2LEAD_CODES).get(progressKey(key.name), { type: 'json' });
        try {
          const state = normalizeProgressState(stored, { accessCode: key.name, codeData: account, nowIso: now.toISOString() });
          entries.push({ code: key.name, account, state });
        } catch { /* One malformed record cannot hide valid learners. */ }
      }
      cursor = page.cursor;
    } while (cursor);
    const params = new URL(request.url).searchParams;
    const limit = Number.parseInt(params.get('limit') || '50', 10);
    // Never consult or populate the retired RP/bot cache. Eligibility is fresh on every read.
    return json(buildLearningBoards(entries, { now,
      ownCode: (params.get('code') || '').trim().toUpperCase(), limit: Number.isFinite(limit) ? limit : 50 }));
  } catch {
    return json({ ok: false, error: 'leaderboard_compute_failed', message: 'Chưa tải được bảng thành tích. Con thử lại nhé.' }, 503);
  }
}
