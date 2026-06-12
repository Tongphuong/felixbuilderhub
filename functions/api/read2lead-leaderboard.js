import { getClientIp, checkCodeRateLimit, rateLimitedResponse } from './_rate-limit.js';
import { loadProgressState, publicProgressState, RANK_ASSETS, RANK_TITLES } from './_read2lead-v2-state.js';
import { PRE_SEASON, SEASONS as SEASON_CONFIG } from './_read2lead-seasons.js';

const LEADERBOARD_CACHE_KEY = 'leaderboard-cache';
const LEADERBOARD_CACHE_TTL_SECONDS = 5 * 60;
// Single source of truth for seasons lives in _read2lead-seasons.js — this is
// just the board's view of it (ends_at naming kept for the cached payload).
const SEASONS = [PRE_SEASON, ...SEASON_CONFIG].map((season) => ({
  id: season.id,
  name_vi: season.name_vi,
  emoji: season.emoji,
  starts: season.starts || null,
  ends_at: season.ends || null,
}));
const PODIUM_MEDALS = ['🥇', '🥈', '🥉'];

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chua cau hinh bang xep hang.' }, 500);
  }

  const clientIp = getClientIp(request);
  const rateLimit = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rateLimit.blocked) {
    return rateLimitedResponse(rateLimit.retryAfter);
  }

  const url = new URL(request.url);
  const requestedLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;

  const cached = await env.READ2LEAD_CODES.get(LEADERBOARD_CACHE_KEY, { type: 'json' });
  if (cached?.leaders && cached?.updated_at) {
    return json({
      ok: true,
      updated_at: cached.updated_at,
      season: cached.season || null,
      previous_season_podium: cached.previous_season_podium || [],
      leaders: sliceLeaders(cached.leaders, limit),
    });
  }

  const leaders = await computeLeaders(context);
  const season = leaderboardSeason(leaders);
  const previousSeasonId = previousSeasonIdFor(season?.id);
  const medalRows = leaders.flatMap((leader) =>
    leader.medals.map((medal) => ({
      ...medal,
      display_name: leader.display_name,
      masked_code: leader.masked_code,
      season_name_vi: medal.name_vi,
    })),
  );
  const previousSeasonPodium = buildPreviousSeasonPodium(medalRows, previousSeasonId);
  const updatedAt = new Date().toISOString();
  const payload = {
    updated_at: updatedAt,
    season,
    previous_season_podium: previousSeasonPodium,
    leaders,
  };

  try {
    await env.READ2LEAD_CODES.put(
      LEADERBOARD_CACHE_KEY,
      JSON.stringify(payload),
      { expirationTtl: LEADERBOARD_CACHE_TTL_SECONDS },
    );
  } catch {
    // Cache write is best-effort; still return fresh data.
  }

  return json({
    ok: true,
    ...payload,
    leaders: sliceLeaders(leaders, limit),
  });
}

async function computeLeaders(context) {
  const leaders = [];
  let cursor;

  do {
    const list = await context.env.READ2LEAD_CODES.list({ limit: 100, cursor });
    cursor = list.cursor;

    const records = await Promise.all(
      list.keys.map(async (key) => {
        if (key.name.startsWith('task:') || key.name.startsWith('progress:')) return null;
        if (key.name.startsWith('rl:') || key.name.startsWith('debug:') || key.name === LEADERBOARD_CACHE_KEY) return null;
        const value = await context.env.READ2LEAD_CODES.get(key.name, { type: 'json' });
        return value ? publicLeader(context, key.name, value) : null;
      }),
    );

    for (const record of records) {
      if (record) leaders.push(record);
    }
  } while (cursor);

  leaders.sort(compareLeadersBySeasonRp);

  return leaders;
}

export function compareLeadersBySeasonRp(a, b) {
  if (b.season_rp !== a.season_rp) return b.season_rp - a.season_rp;
  const tierDifference =
    numberOrZero(b.rank_ladder?.tier_index) - numberOrZero(a.rank_ladder?.tier_index);
  if (tierDifference !== 0) return tierDifference;
  if (b.completed_packs !== a.completed_packs) return b.completed_packs - a.completed_packs;
  return Date.parse(b.last_reviewed_at || 0) - Date.parse(a.last_reviewed_at || 0);
}

export function seasonRpForLeader(season, publicState, rawState) {
  return firstValidNumber(
    season?.rp,
    publicState?.season?.rp,
    rawState?.season?.rp,
    publicState?.rank_ladder?.rank_points,
    rawState?.rank_points,
  );
}

export function buildPreviousSeasonPodium(rows, previousSeasonId) {
  if (!previousSeasonId) return [];
  const latestByStudent = new Map();

  for (const row of rows) {
    if (!row || row.season_id !== previousSeasonId) continue;
    const studentKey = row.masked_code || row.display_name;
    if (!studentKey) continue;
    const existing = latestByStudent.get(studentKey);
    if (!existing || Date.parse(row.ts || 0) > Date.parse(existing.ts || 0)) {
      latestByStudent.set(studentKey, row);
    }
  }

  return Array.from(latestByStudent.values())
    .sort((a, b) => {
      const tierDifference =
        numberOrZero(b.peak_tier_index) - numberOrZero(a.peak_tier_index);
      if (tierDifference !== 0) return tierDifference;
      return numberOrZero(b.reward_coins) - numberOrZero(a.reward_coins);
    })
    .slice(0, 3)
    .map((row, index) => ({
      ...row,
      medal_emoji: PODIUM_MEDALS[index],
    }));
}

function sliceLeaders(leaders, limit) {
  return leaders.slice(0, limit).map((leader, index) => ({
    position: index + 1,
    ...leader,
  }));
}

async function publicLeader(context, code, codeData) {
  const progress = codeData.progress || {};
  const profile = codeData.student_profile || {};
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  const studentName = cleanName(profile.student_name || progress.student_name || '');
  const v2State = await loadProgressState(context.env, code, codeData);
  const publicState = publicProgressState(v2State);
  const rawState = await progressState(context.env, code);
  const season = firstObject(publicState.season, v2State.season, rawState?.season, progress.season);
  const medals = firstArray(publicState.medals, v2State.medals, rawState?.medals, progress.medals);
  const currentLevel = publicState.current_level || progress.current_level || profile.level || 'L1';
  const completedPacks =
    numberOrZero(publicState.completed_packs) ||
    numberOrZero(progress.completed_packs) ||
    reviewHistory.length;

  if (!studentName && numberOrZero(publicState.total_xp) === 0 && numberOrZero(publicState.coins) === 0 && completedPacks === 0) {
    return null;
  }

  return {
    display_name: studentName || 'Bạn đọc bí mật',
    masked_code: maskCode(code),
    total_xp: numberOrZero(publicState.total_xp),
    xp_in_level: numberOrZero(publicState.xp_in_level),
    xp_to_next_level: numberOrZero(publicState.xp_to_next_level),
    xp_percent: numberOrZero(publicState.xp_percent),
    coins: numberOrZero(publicState.coins),
    completed_packs: completedPacks,
    season_id: season?.id || null,
    season_rp: seasonRpForLeader(season, publicState, rawState),
    season_rank_label: season?.ladder?.label_vi || publicState.rank_ladder?.label_vi || RANK_TITLES[currentLevel] || RANK_TITLES.L1,
    rank_ladder: season?.ladder || publicState.rank_ladder || null,
    season: season || null,
    medals,
    rank: RANK_TITLES[currentLevel] || RANK_TITLES.L1,
    rank_vi: RANK_TITLES[currentLevel] || RANK_TITLES.L1,
    rank_asset_url: RANK_ASSETS[currentLevel] || RANK_ASSETS.L1,
    current_level: currentLevel,
    streak_days: numberOrZero(publicState.streak_days),
    packs_until_level_up: numberOrZero(publicState.packs_until_level_up),
    avatar: publicState.avatar,
    equipped: publicState.equipped,
    equipped_display: publicState.equipped_display,
    last_reviewed_at:
      codeData.last_reviewed_at ||
      publicState.last_activity_at ||
      progress.last_activity_at ||
      progress.last_reviewed_at ||
      latestReviewDate(reviewHistory),
  };
}

function leaderboardSeason(leaders) {
  const counts = new Map();
  for (const leader of leaders) {
    if (!leader.season_id) continue;
    counts.set(leader.season_id, (counts.get(leader.season_id) || 0) + 1);
  }
  const seasonId = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] || calendarSeasonId();
  const known = SEASONS.find((season) => season.id === seasonId);
  const recordSeason = leaders.find((leader) => leader.season_id === seasonId)?.season;
  return {
    id: seasonId,
    name_vi: recordSeason?.name_vi || known?.name_vi || 'Mùa hiện tại',
    emoji: recordSeason?.emoji || known?.emoji || '✨',
    ends_at: recordSeason?.ends_at || known?.ends_at || null,
  };
}

function calendarSeasonId(now = new Date()) {
  const dateKey = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const active = SEASONS.find((season) =>
    (!season.starts || dateKey >= season.starts) && (!season.ends_at || dateKey <= season.ends_at));
  return active?.id || SEASONS[SEASONS.length - 1].id;
}

function previousSeasonIdFor(seasonId) {
  const index = SEASONS.findIndex((season) => season.id === seasonId);
  if (index > 0) return SEASONS[index - 1].id;
  const match = /^(\d{4})-S(\d+)$/.exec(String(seasonId || ''));
  if (!match || Number(match[2]) <= 0) return null;
  return `${match[1]}-S${Number(match[2]) - 1}`;
}

async function progressState(env, code) {
  const kv = env.READ2LEAD_PROGRESS || env.READ2LEAD_CODES;
  if (!kv) return null;
  return kv.get(`progress:${String(code).trim().toUpperCase()}`, { type: 'json' });
}

function cleanName(name) {
  return name.toString().trim().replace(/\s+/g, ' ').slice(0, 40);
}

function maskCode(code) {
  const clean = code.toString().trim().toUpperCase();
  const last = clean.slice(-4) || '----';
  if (clean.startsWith('R2L-')) return `R2L-***${last}`;
  return `***${last}`;
}

function latestReviewDate(reviewHistory) {
  return reviewHistory
    .map((item) => item.reviewed_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] || null;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function firstValidNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || null;
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
