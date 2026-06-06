export const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5'];
export const PACKS_TO_NEXT_LEVEL = {
  L1: 5,
  L2: 15,
  L3: 25,
  L4: 35,
  L5: 0,
};
export const XP_PER_PASSED_PACK = 20;
export const XP_PENALTY_BELOW_THRESHOLD = 10;
export const PASS_THRESHOLD_PERCENT = 70;
export const LEVEL_RESET_VERSION = 20260606;
export const START_LEVEL = 'L1';
export const COINS_TOOLTIP = 'Tiết kiệm xu cho cửa hàng sắp mở! 🛒';

const STARTER_BADGE_DEFINITIONS = [
  { id: 'first_story', label_vi: 'Mở truyện đầu tiên', description_vi: 'Hoàn thành 1 nhiệm vụ Read2Lead.' },
  { id: 'steady_three', label_vi: 'Ba nhiệm vụ chắc tay', description_vi: 'Hoàn thành 3 nhiệm vụ.' },
  { id: 'streak_3', label_vi: 'Ba ngày giữ nhịp', description_vi: 'Giữ streak 3 ngày.' },
  { id: 'coin_saver', label_vi: 'Người giữ xu', description_vi: 'Tích lũy 100 xu.' },
  { id: 'level_climber', label_vi: 'Lên level mới', description_vi: 'Mở khóa level tiếp theo.' },
  { id: 'brave_voice', label_vi: 'Dám nói thành tiếng', description_vi: 'Hoàn thành phần nghe và nói lại.' },
];

const RANK_TITLES = {
  L1: 'Story Starter',
  L2: 'Listening Explorer',
  L3: 'Sentence Builder',
  L4: 'Reading Ranger',
  L5: 'Story Captain',
};

export function progressNamespace(env) {
  return env.READ2LEAD_PROGRESS || env.READ2LEAD_CODES || null;
}

export function progressKey(accessCode) {
  return `progress:${String(accessCode || '').trim().toUpperCase()}`;
}

export function vietnamDateKey(iso = new Date().toISOString()) {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function nextStreakDays(lastDateKey, currentDateKey, currentStreak = 0) {
  if (!currentDateKey) return numberOrZero(currentStreak);
  if (!lastDateKey) return 1;
  if (lastDateKey === currentDateKey) return Math.max(1, numberOrZero(currentStreak));
  if (isPreviousDate(lastDateKey, currentDateKey)) return numberOrZero(currentStreak) + 1;
  return 1;
}

export async function loadProgressState(env, accessCode, codeData = null, nowIso = new Date().toISOString()) {
  const kv = progressNamespace(env);
  if (!kv) throw new Error('READ2LEAD_PROGRESS or READ2LEAD_CODES binding missing');
  const key = progressKey(accessCode);
  const stored = await kv.get(key, { type: 'json' });
  return normalizeProgressState(stored, { accessCode, codeData, nowIso });
}

export async function saveProgressState(env, accessCode, state) {
  const kv = progressNamespace(env);
  if (!kv) throw new Error('READ2LEAD_PROGRESS or READ2LEAD_CODES binding missing');
  const next = {
    ...state,
    updated_at: new Date().toISOString(),
  };
  await kv.put(progressKey(accessCode), JSON.stringify(next));
  return next;
}

export function normalizeProgressState(raw, { accessCode, codeData = null, nowIso = new Date().toISOString() } = {}) {
  const profile = codeData?.student_profile || {};
  const legacyProgress = codeData?.progress || {};
  const hasStoredV2State = raw?.schema_version === 2;
  const hasCurrentLevelReset = raw?.level_reset_version === LEVEL_RESET_VERSION;
  const initialLevel = hasStoredV2State && hasCurrentLevelReset ? safeLevel(raw?.initial_level) : START_LEVEL;
  const currentLevel = hasStoredV2State && hasCurrentLevelReset
    ? safeLevel(raw?.current_level || raw?.level || initialLevel)
    : START_LEVEL;
  const completedPacks = numberOrZero(raw?.completed_packs ?? legacyProgress.completed_packs);
  const coins = numberOrZero(raw?.coins);
  const totalXp = hasCurrentLevelReset ? numberOrZero(raw?.total_xp) : 0;
  const xpInLevel = hasCurrentLevelReset
    ? Math.min(xpToNextLevel(currentLevel), numberOrZero(raw?.xp_in_level ?? raw?.xp))
    : 0;
  const levelProgress =
    hasCurrentLevelReset && raw?.level_progress && typeof raw.level_progress === 'object'
      ? raw.level_progress
      : {};
  const defaultUnlockedLevels = currentLevel === initialLevel
    ? [initialLevel]
    : [initialLevel, currentLevel];
  const unlockedLevels = Array.isArray(raw?.unlocked_levels) && raw.unlocked_levels.length
    ? raw.unlocked_levels.filter((level) => LEVELS.includes(level))
    : defaultUnlockedLevels;
  const base = {
    schema_version: 2,
    level_reset_version: LEVEL_RESET_VERSION,
    access_code: String(accessCode || raw?.access_code || '').trim().toUpperCase(),
    student_name: raw?.student_name || profile.student_name || legacyProgress.student_name || '',
    current_level: currentLevel,
    initial_level: initialLevel,
    unlocked_levels: Array.from(new Set([...unlockedLevels, currentLevel])),
    rank_title: RANK_TITLES[currentLevel] || RANK_TITLES[START_LEVEL],
    coins,
    total_xp: totalXp,
    xp_in_level: xpInLevel,
    xp_to_next_level: xpToNextLevel(currentLevel),
    completed_packs: completedPacks,
    completed_pack_ids: Array.isArray(raw?.completed_pack_ids) ? raw.completed_pack_ids.slice(-100) : [],
    penalized_pack_ids: Array.isArray(raw?.penalized_pack_ids) ? raw.penalized_pack_ids.slice(-100) : [],
    level_progress: normalizeLevelProgress(levelProgress),
    streak_days: numberOrZero(raw?.streak_days ?? legacyProgress.streak_days),
    last_activity_date_vn: raw?.last_activity_date_vn || vietnamDateKey(legacyProgress.last_activity_at || ''),
    last_activity_at: raw?.last_activity_at || legacyProgress.last_activity_at || null,
    voice_attempts: numberOrZero(raw?.voice_attempts),
    pack_history: Array.isArray(raw?.pack_history) ? raw.pack_history.slice(0, 50) : [],
    badges: Array.isArray(raw?.badges) ? raw.badges : [],
    avatar: {
      enabled: false,
      preset_id: raw?.avatar?.preset_id || null,
      gender: raw?.avatar?.gender || null,
      equipped: raw?.avatar?.equipped || {},
    },
    created_at: raw?.created_at || nowIso,
    updated_at: raw?.updated_at || nowIso,
  };
  return refreshBadges(base);
}

export function applyPackCompletion(
  state,
  {
    packId,
    completedAt = new Date().toISOString(),
    rewardsEarned = {},
    activityResults = [],
  } = {},
) {
  const id = String(packId || '').trim();
  if (!id) throw new Error('pack_id required');
  if (state.completed_pack_ids.includes(id)) {
    return { state: refreshBadges(state), level_up: null, already_counted: true };
  }

  const currentLevel = safeLevel(state.current_level);
  const levelProgress = normalizeLevelProgress(state.level_progress);
  const nextLevelCount = numberOrZero(levelProgress[currentLevel]) + 1;
  const currentDateKey = vietnamDateKey(completedAt);
  const voiceAttempts = hasVoiceAttempt(activityResults) ? state.voice_attempts + 1 : state.voice_attempts;
  const earnedXp = numberOrZero(rewardsEarned.xp);
  const nextCompleted = state.completed_packs + 1;
  const nextCompletedIds = [...state.completed_pack_ids, id].slice(-100);
  let nextCurrentLevel = currentLevel;
  const xpTarget = xpToNextLevel(currentLevel);
  const nextXpTotal = state.xp_in_level + earnedXp;
  let xpInLevel = xpTarget ? Math.min(xpTarget, nextXpTotal) : nextXpTotal;
  let levelUp = null;

  levelProgress[currentLevel] = nextLevelCount;
  if (xpTarget && nextXpTotal >= xpTarget) {
    const nextLevel = levelAfter(currentLevel);
    if (nextLevel) {
      levelUp = {
        from_level: currentLevel,
        to_level: nextLevel,
        message_vi: `Con đã mở khóa ${nextLevel}.`,
      };
      nextCurrentLevel = nextLevel;
      levelProgress[nextLevel] = 0;
      xpInLevel = 0;
    } else {
      xpInLevel = xpTarget;
    }
  }

  const nextState = {
    ...state,
    current_level: nextCurrentLevel,
    unlocked_levels: Array.from(new Set([...state.unlocked_levels, nextCurrentLevel])),
    rank_title: RANK_TITLES[nextCurrentLevel] || state.rank_title,
    coins: state.coins + numberOrZero(rewardsEarned.coins),
    total_xp: state.total_xp + earnedXp,
    xp_in_level: xpInLevel,
    xp_to_next_level: xpToNextLevel(nextCurrentLevel),
    completed_packs: nextCompleted,
    completed_pack_ids: nextCompletedIds,
    level_progress: levelProgress,
    streak_days: nextStreakDays(state.last_activity_date_vn, currentDateKey, state.streak_days),
    last_activity_date_vn: currentDateKey,
    last_activity_at: completedAt,
    voice_attempts: voiceAttempts,
    pack_history: [
      {
        pack_id: id,
        completed_at: completedAt,
        level: currentLevel,
        coins: numberOrZero(rewardsEarned.coins),
        xp: earnedXp,
      },
      ...state.pack_history,
    ].slice(0, 50),
  };

  return {
    state: refreshBadges(nextState),
    level_up: levelUp,
    already_counted: false,
  };
}

export function applyPackPenalty(
  state,
  {
    packId,
    completedAt = new Date().toISOString(),
    penaltyXp = XP_PENALTY_BELOW_THRESHOLD,
  } = {},
) {
  const id = String(packId || '').trim();
  if (!id) throw new Error('pack_id required');
  const penalizedPackIds = Array.isArray(state.penalized_pack_ids) ? state.penalized_pack_ids : [];
  if (penalizedPackIds.includes(id)) {
    return { state: refreshBadges(state), already_penalized: true };
  }

  const currentLevel = safeLevel(state.current_level);
  const currentDateKey = vietnamDateKey(completedAt);
  const loss = Math.max(0, numberOrZero(penaltyXp));
  const nextState = {
    ...state,
    current_level: currentLevel,
    rank_title: RANK_TITLES[currentLevel] || state.rank_title,
    total_xp: Math.max(0, state.total_xp - loss),
    xp_in_level: Math.max(0, state.xp_in_level - loss),
    xp_to_next_level: xpToNextLevel(currentLevel),
    penalized_pack_ids: [...penalizedPackIds, id].slice(-100),
    streak_days: nextStreakDays(state.last_activity_date_vn, currentDateKey, state.streak_days),
    last_activity_date_vn: currentDateKey,
    last_activity_at: completedAt,
    pack_history: [
      {
        pack_id: id,
        completed_at: completedAt,
        level: currentLevel,
        coins: 0,
        xp: -loss,
        passed: false,
      },
      ...state.pack_history,
    ].slice(0, 50),
  };

  return { state: refreshBadges(nextState), already_penalized: false };
}

export function publicProgressState(state) {
  const currentLevel = safeLevel(state.current_level);
  const completedInLevel = numberOrZero(state.level_progress?.[currentLevel]);
  const xpTarget = xpToNextLevel(currentLevel);
  return {
    schema_version: 2,
    student_name: state.student_name,
    current_level: currentLevel,
    unlocked_levels: state.unlocked_levels,
    rank_title: state.rank_title,
    coins: state.coins,
    coins_tooltip: COINS_TOOLTIP,
    total_xp: state.total_xp,
    xp: state.xp_in_level,
    xp_in_level: state.xp_in_level,
    xp_to_next_level: xpTarget,
    xp_percent: xpTarget ? Math.min(100, Math.round((state.xp_in_level / xpTarget) * 100)) : 100,
    streak_days: state.streak_days,
    completed_packs: state.completed_packs,
    packs_completed_in_level: completedInLevel,
    packs_until_level_up: packsUntilLevelUp(currentLevel, state.xp_in_level),
    badges: state.badges,
    avatar: state.avatar,
    last_activity_at: state.last_activity_at,
    last_activity_date_vn: state.last_activity_date_vn,
  };
}

export function xpToNextLevel(level) {
  return numberOrZero(PACKS_TO_NEXT_LEVEL[safeLevel(level)]) * XP_PER_PASSED_PACK;
}

export function packsUntilLevelUp(level, xpInLevel = 0) {
  const xpTarget = xpToNextLevel(level);
  if (!xpTarget) return 0;
  return Math.max(0, Math.ceil((xpTarget - numberOrZero(xpInLevel)) / XP_PER_PASSED_PACK));
}

function refreshBadges(state) {
  const previous = new Map((state.badges || []).map((badge) => [badge.id, badge]));
  const badges = STARTER_BADGE_DEFINITIONS.map((badge) => {
    const unlocked = badgeUnlocked(badge.id, state);
    const old = previous.get(badge.id) || {};
    return {
      ...badge,
      unlocked,
      unlocked_at: unlocked ? old.unlocked_at || state.last_activity_at || state.updated_at : null,
    };
  });
  return { ...state, badges };
}

function badgeUnlocked(id, state) {
  if (id === 'first_story') return state.completed_packs >= 1;
  if (id === 'steady_three') return state.completed_packs >= 3;
  if (id === 'streak_3') return state.streak_days >= 3;
  if (id === 'coin_saver') return state.coins >= 100;
  if (id === 'level_climber') return state.unlocked_levels.length > 1 || state.current_level !== state.initial_level;
  if (id === 'brave_voice') return state.voice_attempts >= 1;
  return false;
}

function hasVoiceAttempt(activityResults) {
  return Array.isArray(activityResults) && activityResults.some((item) => item?.type === 'listen_and_speak');
}

function normalizeLevelProgress(levelProgress) {
  return Object.fromEntries(LEVELS.map((level) => [level, numberOrZero(levelProgress[level])]));
}

function safeLevel(level) {
  return LEVELS.includes(level) ? level : START_LEVEL;
}

function levelAfter(level) {
  const index = LEVELS.indexOf(level);
  if (index < 0 || index >= LEVELS.length - 1) return null;
  return LEVELS[index + 1];
}

function isPreviousDate(previous, current) {
  const prev = Date.parse(`${previous}T00:00:00Z`);
  const now = Date.parse(`${current}T00:00:00Z`);
  if (!Number.isFinite(prev) || !Number.isFinite(now)) return false;
  return now - prev === 24 * 60 * 60 * 1000;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
