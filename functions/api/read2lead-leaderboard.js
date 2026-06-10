import { loadProgressState, publicProgressState, RANK_ASSETS, RANK_TITLES } from './_read2lead-v2-state.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chua cau hinh bang xep hang.' }, 500);
  }

  const url = new URL(request.url);
  const requestedLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;

  const leaders = [];
  let cursor;

  do {
    const list = await env.READ2LEAD_CODES.list({ limit: 100, cursor });
    cursor = list.cursor;

    const records = await Promise.all(
      list.keys.map(async (key) => {
        if (key.name.startsWith('task:') || key.name.startsWith('progress:')) return null;
        const value = await env.READ2LEAD_CODES.get(key.name, { type: 'json' });
        return value ? publicLeader(context, key.name, value) : null;
      }),
    );

    for (const record of records) {
      if (record) leaders.push(record);
    }
  } while (cursor);

  leaders.sort((a, b) => {
    if (b.total_xp !== a.total_xp) return b.total_xp - a.total_xp;
    if (b.coins !== a.coins) return b.coins - a.coins;
    if (b.completed_packs !== a.completed_packs) return b.completed_packs - a.completed_packs;
    return Date.parse(b.last_reviewed_at || 0) - Date.parse(a.last_reviewed_at || 0);
  });

  return json({
    ok: true,
    updated_at: new Date().toISOString(),
    leaders: leaders.slice(0, limit).map((leader, index) => ({
      position: index + 1,
      ...leader,
    })),
  });
}

async function publicLeader(context, code, codeData) {
  const progress = codeData.progress || {};
  const profile = codeData.student_profile || {};
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  const studentName = cleanName(profile.student_name || progress.student_name || '');
  const v2State = await loadProgressState(context.env, code, codeData);
  const publicState = publicProgressState(v2State);
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
