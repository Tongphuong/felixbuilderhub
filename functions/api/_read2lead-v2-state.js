export const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5'];
export const PACKS_PER_LEVEL = 3;
export const XP_PER_LEVEL = 60;
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
  const initialLevel = safeLevel(
    raw?.initial_level || legacyProgress.current_level || profile.level || 'L2',
  );
  const currentLevel = safeLevel(raw?.current_level || raw?.level || initialLevel);
  const completedPacks = numberOrZero(raw?.completed_packs ?? legacyProgress.completed_packs);
  const coins = numberOrZero(raw?.coins);
  const totalXp = numberOrZero(raw?.total_xp);
  const xpInLevel = Math.min(XP_PER_LEVEL, numberOrZero(raw?.xp_in_level ?? raw?.xp));
  const levelProgress =
    raw?.level_progress && typeof raw.level_progress === 'object' ? raw.level_progress : {};
  const defaultUnlockedLevels = currentLevel === initialLevel
    ? [initialLevel]
    : [initialLevel, currentLevel];
  const unlockedLevels = Array.isArray(raw?.unlocked_levels) && raw.unlocked_levels.length
    ? raw.unlocked_levels.filter((level) => LEVELS.includes(level))
    : defaultUnlockedLevels;
  const base = {
    schema_version: 2,
    access_code: String(accessCode || raw?.access_code || '').trim().toUpperCase(),
    student_name: raw?.student_name || profile.student_name || legacyProgress.student_name || '',
    current_level: currentLevel,
    initial_level: initialLevel,
    unlocked_levels: Array.from(new Set([...unlockedLevels, currentLevel])),
    rank_title: RANK_TITLES[currentLevel] || RANK_TITLES.L2,
    coins,
    total_xp: totalXp,
    xp_in_level: xpInLevel,
    xp_to_next_level: XP_PER_LEVEL,
    completed_packs: completedPacks,
    completed_pack_ids: Array.isArray(raw?.completed_pack_ids) ? raw.completed_pack_ids.slice(-100) : [],
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
  let xpInLevel = Math.min(XP_PER_LEVEL, state.xp_in_level + earnedXp);
  let levelUp = null;

  levelProgress[currentLevel] = nextLevelCount;
  if (nextLevelCount >= PACKS_PER_LEVEL) {
    const nextLevel = levelAfter(currentLevel);
    if (nextLevel) {
      levelUp = {
        from_level: currentLevel,
        to_level: nextLevel,
        message_vi: `Con đã mở khóa ${nextLevel}.`,
      };
      nextCurrentLevel = nextLevel;
      levelProgress[currentLevel] = 0;
      xpInLevel = 0;
    } else {
      xpInLevel = XP_PER_LEVEL;
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

export function setProgressLevel(state, level, nowIso = new Date().toISOString()) {
  const nextLevel = safeLevel(level);
  const nextState = {
    ...state,
    current_level: nextLevel,
    unlocked_levels: Array.from(new Set([...state.unlocked_levels, nextLevel])),
    rank_title: RANK_TITLES[nextLevel] || state.rank_title,
    xp_in_level: 0,
    updated_at: nowIso,
  };
  return refreshBadges(nextState);
}

export function publicProgressState(state) {
  const currentLevel = safeLevel(state.current_level);
  const completedInLevel = numberOrZero(state.level_progress?.[currentLevel]);
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
    xp_to_next_level: state.xp_to_next_level,
    xp_percent: Math.min(100, Math.round((state.xp_in_level / state.xp_to_next_level) * 100)),
    streak_days: state.streak_days,
    completed_packs: state.completed_packs,
    packs_completed_in_level: completedInLevel,
    packs_until_level_up: Math.max(0, PACKS_PER_LEVEL - completedInLevel),
    badges: state.badges,
    avatar: state.avatar,
    last_activity_at: state.last_activity_at,
    last_activity_date_vn: state.last_activity_date_vn,
  };
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
  return LEVELS.includes(level) ? level : 'L2';
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
