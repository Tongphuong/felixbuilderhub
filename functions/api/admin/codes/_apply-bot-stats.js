import {
  LEADERBOARD_BOT_PRESETS,
  RANK_ASSETS,
  RANK_TITLES,
  buildAdminBotLeaderboardState,
  loadProgressState,
  publicProgressState,
  saveProgressState,
} from '../../_read2lead-v2-state.js';

const LEADERBOARD_CACHE_KEY = 'leaderboard-cache';

export async function applyBotStatsToCode(env, code, preset, { nowIso = new Date().toISOString() } = {}) {
  const normalizedCode = String(code || preset?.code || '').trim().toUpperCase();
  if (!normalizedCode) {
    return { ok: false, error: 'code_required' };
  }

  const record = await env.READ2LEAD_CODES.get(normalizedCode, { type: 'json' });
  if (!record) {
    return { ok: false, error: 'not_found', code: normalizedCode };
  }

  let existingProgress = null;
  try {
    existingProgress = await loadProgressState(env, normalizedCode, record);
  } catch {
    existingProgress = null;
  }

  const nextProgress = buildAdminBotLeaderboardState(existingProgress, {
    accessCode: normalizedCode,
    codeData: record,
    rankLabelVi: preset.rank_label_vi,
    completedPacks: preset.completed_packs,
    coins: preset.coins,
    studentName: preset.student_name,
    nowIso,
  });
  await saveProgressState(env, normalizedCode, nextProgress);

  const profile = record.student_profile || {};
  const progress = record.progress || {};
  const level = nextProgress.current_level;
  const studentName = preset.student_name || nextProgress.student_name || profile.student_name || progress.student_name || '';

  const updatedRecord = {
    ...record,
    is_bot: true,
    student_profile: {
      ...profile,
      student_name: studentName,
      level,
    },
    progress: {
      ...progress,
      student_name: studentName,
      current_level: level,
      level,
      rank_title: RANK_TITLES[level],
      rank_asset_url: RANK_ASSETS[level],
      completed_packs: nextProgress.completed_packs,
      coins: nextProgress.coins,
    },
    last_used_at: nowIso,
  };
  await env.READ2LEAD_CODES.put(normalizedCode, JSON.stringify(updatedRecord));

  try {
    await env.READ2LEAD_CODES.delete(LEADERBOARD_CACHE_KEY);
  } catch {
    // Best-effort cache bust.
  }

  return {
    ok: true,
    code: normalizedCode,
    preset: preset.key || null,
    display_name: studentName,
    rank_label_vi: nextProgress.season?.peak_label_vi || publicProgressState(nextProgress).rank_ladder?.label_vi,
    completed_packs: nextProgress.completed_packs,
    coins: nextProgress.coins,
    season_rp: nextProgress.season?.rp ?? 0,
    read2lead_state: publicProgressState(nextProgress),
  };
}

export function resolveBotPreset(presetKey) {
  const key = String(presetKey || '').trim().toLowerCase();
  const preset = LEADERBOARD_BOT_PRESETS[key];
  if (!preset) return null;
  return { key, ...preset };
}
