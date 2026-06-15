import {
  MONSTER_COLORS,
  MONSTER_MANIFEST,
  MONSTER_SLOTS,
} from './_monster-manifest.js';
import {
  cumulativeStartRP,
  currentSeason,
  rankApexThreshold,
  seasonById,
  seasonRewardCoins,
  tierStartRp,
} from './_read2lead-seasons.js';
import {
  QUEST_DEFS,
  QUEST_IDS,
  pickDailyQuestIds,
  questCompleted,
  questDeltasForEvent,
  questReward,
} from './_read2lead-quests.js';
import {
  autoConvertDuplicate,
  chestPreviewText,
  rollChest,
} from './_read2lead-chests.js';
import { getPartRarity } from './_read2lead-shop-v2.js';

export { MONSTER_COLORS, MONSTER_MANIFEST, MONSTER_SLOTS };

export const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5'];
export const PACKS_TO_NEXT_LEVEL = {
  L1: 5,
  L2: 15,
  L3: 25,
  L4: 35,
  L5: 0,
};
export const XP_PER_PASSED_PACK = 20;
export const XP_PENALTY_BELOW_THRESHOLD = 0;
export const PASS_THRESHOLD_PERCENT = 50;
export const LEVEL_RESET_VERSION = 20260606;
export const START_LEVEL = 'L1';
export const COINS_TOOLTIP = 'Tiết kiệm xu cho cửa hàng sắp mở! 🛒';
export const SHOP_SLOTS = ['hat', 'pet', 'frame', 'name_color'];
export const BASIC_MONSTER_CONFIG = Object.freeze({
  body: 'png-default-body-whitea',
  arms: 'png-default-arm-whitea',
  eyes: 'png-default-eye-blue',
  mouth: 'png-default-moutha',
  detail: '',
  effects: '',
  frame: '',
  color: 'mint',
});

export const SHOP_CATALOG = [
  { id: 'hat_star', slot: 'hat', name_vi: 'Mũ sao', emoji: '⭐', price_coins: 30, css_class: 'r2l-shop-hat-star' },
  { id: 'hat_crown', slot: 'hat', name_vi: 'Vương miện', emoji: '👑', price_coins: 80, css_class: 'r2l-shop-hat-crown' },
  { id: 'pet_bunny', slot: 'pet', name_vi: 'Thỏ con', emoji: '🐰', price_coins: 50, css_class: 'r2l-shop-pet-bunny' },
  { id: 'pet_cat', slot: 'pet', name_vi: 'Mèo con', emoji: '🐱', price_coins: 50, css_class: 'r2l-shop-pet-cat' },
  { id: 'frame_gold', slot: 'frame', name_vi: 'Khung vàng', emoji: '🖼️', price_coins: 40, css_class: 'r2l-shop-frame-gold' },
  { id: 'frame_rainbow', slot: 'frame', name_vi: 'Khung cầu vồng', emoji: '🌈', price_coins: 70, css_class: 'r2l-shop-frame-rainbow' },
  { id: 'name_gold', slot: 'name_color', name_vi: 'Tên vàng', emoji: '✨', price_coins: 35, css_class: 'r2l-shop-name-gold' },
  { id: 'name_ocean', slot: 'name_color', name_vi: 'Tên xanh biển', emoji: '💎', price_coins: 35, css_class: 'r2l-shop-name-ocean' },
];
export const STREAK_FREEZE_MILESTONE_DAYS = 7;
export const STREAK_FREEZE_TOKEN_CAP = 5;
export const STREAK_FREEZE_HINT_VI =
  'Cứ 7 ngày học liên tiếp, con nhận 1 lượt giữ streak (tối đa 5). Tự dùng khi nghỉ đúng 1 ngày.';

const STARTER_BADGE_DEFINITIONS = [
  { id: 'first_story', label_vi: 'Mở truyện đầu tiên', description_vi: 'Hoàn thành 1 nhiệm vụ Read2Lead.' },
  { id: 'steady_three', label_vi: 'Ba nhiệm vụ chắc tay', description_vi: 'Hoàn thành 3 nhiệm vụ.' },
  { id: 'streak_3', label_vi: 'Ba ngày giữ nhịp', description_vi: 'Giữ streak 3 ngày.' },
  { id: 'coin_saver', label_vi: 'Người giữ xu', description_vi: 'Tích lũy 100 xu.' },
  { id: 'level_climber', label_vi: 'Lên level mới', description_vi: 'Mở khóa level tiếp theo.' },
  { id: 'brave_voice', label_vi: 'Dám nói thành tiếng', description_vi: 'Hoàn thành phần nghe và nói lại.' },
];

export const RANK_TITLES = {
  L1: 'Đồng',
  L2: 'Bạc',
  L3: 'Vàng',
  L4: 'Kim cương',
  L5: 'Huyền thoại',
};

export const RANK_ASSETS = {
  L1: '/assets/r2l/ranks/rank-l1-bronze.svg',
  L2: '/assets/r2l/ranks/rank-l2-silver.svg',
  L3: '/assets/r2l/ranks/rank-l3-gold.svg',
  L4: '/assets/r2l/ranks/rank-l4-diamond.svg',
  L5: '/assets/r2l/ranks/rank-l5-legend.svg',
};

const RANK_LADDER_TIERS = [
  { tier_index: 0, tier_name_vi: 'Đồng', tier_name_en: 'Bronze', tier_color: '#cd7f32' },
  { tier_index: 1, tier_name_vi: 'Bạc', tier_name_en: 'Silver', tier_color: '#c0c0c0' },
  { tier_index: 2, tier_name_vi: 'Vàng', tier_name_en: 'Gold', tier_color: '#ffd700' },
  { tier_index: 3, tier_name_vi: 'Bạch Kim', tier_name_en: 'Platinum', tier_color: '#4fd1c5' },
  { tier_index: 4, tier_name_vi: 'Kim Cương', tier_name_en: 'Diamond', tier_color: '#5b8def' },
  { tier_index: 5, tier_name_vi: 'Tinh Anh', tier_name_en: 'Elite', tier_color: '#a855f7' },
  { tier_index: 6, tier_name_vi: 'Cao Thủ', tier_name_en: 'Master', tier_color: '#ef4444' },
  { tier_index: 7, tier_name_vi: 'Thách Đấu', tier_name_en: 'Challenger', tier_color: '#ffd700' },
];
const RANK_LADDER_DIVISIONS = ['III', 'II', 'I'];

export const RANK_RP_PER_PACK = { below65: 0, from65: 1, from85: 2 };
export const RANK_DAILY_RP_CAP = 3;
export const RANK_TIER_COSTS = [9, 9, 12, 12, 15, 15, 15];
export const RANK_TIER_CAP_BY_LEVEL = { L1: 2, L2: 3, L3: 4, L4: 6, L5: 7 };
export const LEVEL_GATE_HINT_VI =
  'Sắp lên Level rồi! Con luyện thêm cho điểm trung bình đạt 70% nhé.';

const RANK_APEX_THRESHOLD = rankApexThreshold();
const CHEST_HISTORY_LIMIT = 50;
const LEARNING_HISTORY_LIMIT = 50;
const LEARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ATTENTION_EVENT_WINDOW_MS = 10000;
export const SUSPECT_PACK_TIME_MS = 30000;
export const SUSPECT_PACK_SCORE_PERCENT = 50;
const COMBO_XU_CAP_PER_PACK = 5;
const DAILY_LOGIN_CHEST_BASE = 5;
const DAILY_LOGIN_CHEST_PER_STREAK = 2;
const DAILY_LOGIN_CHEST_MAX_STREAK = 10;

export function rankRpFromScore(scorePercent) {
  const score = Number(scorePercent);
  if (!Number.isFinite(score) || score < 65) return RANK_RP_PER_PACK.below65;
  if (score >= 85) return RANK_RP_PER_PACK.from85;
  return RANK_RP_PER_PACK.from65;
}

export function rankPointsFromHistory(state) {
  const history = Array.isArray(state?.pack_history) ? state.pack_history : [];
  if (history.length > 0) {
    let total = 0;
    for (const entry of history) {
      if (entry?.passed === false) continue;
      const score = entry?.score_percent;
      if (score === undefined || score === null || !Number.isFinite(Number(score))) {
        total += 1;
        continue;
      }
      total += rankRpFromScore(score);
    }
    return total;
  }
  const completedIds = Array.isArray(state?.completed_pack_ids) ? state.completed_pack_ids.length : 0;
  const completedPacks = numberOrZero(state?.completed_packs);
  return Math.max(completedIds, completedPacks);
}

export function computeRankLadder(stateOrPoints, options = {}) {
  let rankPoints;
  let currentLevel = options.currentLevel || null;
  if (typeof stateOrPoints === 'number') {
    rankPoints = Math.max(0, Math.floor(stateOrPoints));
  } else if (stateOrPoints && typeof stateOrPoints === 'object') {
    if (stateOrPoints?.season?.rp != null && Number.isFinite(Number(stateOrPoints.season.rp))) {
      rankPoints = Number(stateOrPoints.season.rp);
    } else if (stateOrPoints?.rank_points != null && Number.isFinite(Number(stateOrPoints.rank_points))) {
      rankPoints = Number(stateOrPoints.rank_points);
    } else {
      rankPoints = rankPointsFromHistory(stateOrPoints);
    }
    currentLevel = options.currentLevel || stateOrPoints.current_level || null;
  } else {
    rankPoints = 0;
  }
  return buildRankLadderFromPoints(rankPoints, { currentLevel });
}

export function computeSeasonLadder(state) {
  return computeRankLadder(state);
}

export function computeRankUp(beforeLadder, afterLadder) {
  return {
    changed: beforeLadder.label_vi !== afterLadder.label_vi,
    from_label: beforeLadder.label_vi,
    to_label: afterLadder.label_vi,
    tier_changed: beforeLadder.tier_index !== afterLadder.tier_index,
  };
}

export function buildRankLadderFromPoints(rankPoints, { currentLevel = null } = {}) {
  const P = Math.max(0, Math.floor(rankPoints));
  const uncapped = buildUncappedRankLadder(P);
  return applyTierCap(uncapped, P, currentLevel);
}

function starsPerDivisionForTier(tierIndex) {
  const cost = RANK_TIER_COSTS[tierIndex] || RANK_TIER_COSTS[RANK_TIER_COSTS.length - 1];
  return Math.max(1, Math.floor(cost / 3));
}

function findTierPosition(P) {
  if (P >= RANK_APEX_THRESHOLD) {
    return { tierIndex: 7, within: P - RANK_APEX_THRESHOLD, isApex: true };
  }
  for (let tierIndex = 0; tierIndex < RANK_TIER_COSTS.length; tierIndex += 1) {
    const start = tierStartRp(tierIndex);
    const cost = RANK_TIER_COSTS[tierIndex];
    if (P < start + cost) {
      return { tierIndex, within: P - start, isApex: false };
    }
  }
  return { tierIndex: 7, within: 0, isApex: true };
}

function buildUncappedRankLadder(P) {
  const { tierIndex, within, isApex } = findTierPosition(P);
  const apexTier = RANK_LADDER_TIERS[7];
  if (isApex) {
    return {
      rank_points: P,
      tier_index: 7,
      tier_name_vi: apexTier.tier_name_vi,
      tier_name_en: apexTier.tier_name_en,
      tier_color: apexTier.tier_color,
      division: null,
      stars: 0,
      stars_per_division: starsPerDivisionForTier(6),
      stars_to_next: 0,
      is_apex: true,
      apex_points: P - RANK_APEX_THRESHOLD,
      label_vi: apexTier.tier_name_vi,
      next_label_vi: null,
      capped: false,
      cap_unlock_hint_vi: null,
    };
  }

  const starsPerDivision = starsPerDivisionForTier(tierIndex);
  const divisionIndex = Math.min(RANK_LADDER_DIVISIONS.length - 1, Math.floor(within / starsPerDivision));
  const stars = within % starsPerDivision;
  const starsToNext = starsPerDivision - stars;
  const tier = RANK_LADDER_TIERS[tierIndex];
  const division = RANK_LADDER_DIVISIONS[divisionIndex];
  const nextLadder = buildUncappedRankLadder(starsToNext > 0 ? P + starsToNext : P + 1);

  return {
    rank_points: P,
    tier_index: tierIndex,
    tier_name_vi: tier.tier_name_vi,
    tier_name_en: tier.tier_name_en,
    tier_color: tier.tier_color,
    division,
    stars,
    stars_per_division: starsPerDivision,
    stars_to_next: starsToNext,
    is_apex: false,
    apex_points: 0,
    label_vi: `${tier.tier_name_vi} ${division}`,
    next_label_vi: nextLadder.label_vi,
    capped: false,
    cap_unlock_hint_vi: null,
  };
}

function capUnlockHintVi(currentLevel, maxTierIndex) {
  const nextLevel = levelAfter(safeLevel(currentLevel));
  const nextTier = RANK_LADDER_TIERS[maxTierIndex + 1];
  if (!nextLevel || !nextTier) return null;
  return `Lên Level ${nextLevel.replace('L', '')} để mở khoá rank ${nextTier.tier_name_vi}!`;
}

function applyTierCap(ladder, actualRp, currentLevel) {
  if (!currentLevel) {
    return { ...ladder, rank_points: actualRp, capped: false, cap_unlock_hint_vi: null };
  }
  const level = safeLevel(currentLevel);
  const maxTierIndex = RANK_TIER_CAP_BY_LEVEL[level];
  if (maxTierIndex == null || ladder.tier_index <= maxTierIndex) {
    return { ...ladder, rank_points: actualRp, capped: false, cap_unlock_hint_vi: null };
  }
  const capMaxRp = tierStartRp(maxTierIndex + 1) - 1;
  const cappedLadder = buildUncappedRankLadder(Math.max(0, capMaxRp));
  return {
    ...cappedLadder,
    rank_points: actualRp,
    capped: true,
    cap_unlock_hint_vi: capUnlockHintVi(level, maxTierIndex),
  };
}

function updateSeasonPeak(season, ladder) {
  const peakTier = Number.isFinite(Number(season?.peak_tier_index)) ? Number(season.peak_tier_index) : -1;
  if (ladder.tier_index > peakTier) {
    return { ...season, peak_tier_index: ladder.tier_index, peak_label_vi: ladder.label_vi };
  }
  return season;
}

export function awardRankPoints(state, { scorePercent, dateKey, nowIso = new Date().toISOString() } = {}) {
  const rpEarned = rankRpFromScore(scorePercent);
  const activityDateKey = dateKey || vietnamDateKey(nowIso);
  const rankDaily = state.rank_daily && typeof state.rank_daily === 'object'
    ? { ...state.rank_daily }
    : { date_key: '', rp: 0 };
  let dailyRp = rankDaily.date_key === activityDateKey ? numberOrZero(rankDaily.rp) : 0;
  let awarded = 0;
  if (rpEarned > 0 && dailyRp < RANK_DAILY_RP_CAP) {
    awarded = Math.min(rpEarned, RANK_DAILY_RP_CAP - dailyRp);
    dailyRp += awarded;
  }
  const lifetimeBase = (
    state.lifetime_rp != null && Number.isFinite(Number(state.lifetime_rp))
  ) ? Number(state.lifetime_rp) : (
    state.rank_points != null && Number.isFinite(Number(state.rank_points))
  ) ? Number(state.rank_points) : rankPointsFromHistory(state);
  const seasonRpBase = (
    state.season?.rp != null && Number.isFinite(Number(state.season.rp))
  ) ? Number(state.season.rp) : lifetimeBase;
  const nextLifetime = lifetimeBase + awarded;
  const nextSeasonRp = seasonRpBase + awarded;
  // Peak must respect the level cap — a child must never receive a season
  // medal for a rank they were never shown (capped display = capped peak).
  const nextSeason = updateSeasonPeak(
    { ...(state.season || {}), rp: nextSeasonRp },
    buildRankLadderFromPoints(nextSeasonRp, { currentLevel: state.current_level }),
  );
  return {
    state: {
      ...state,
      rank_daily: { date_key: activityDateKey, rp: dailyRp },
      lifetime_rp: nextLifetime,
      rank_points: nextLifetime,
      season: nextSeason,
    },
    awarded,
  };
}

function normalizeMedals(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === 'object' && entry.season_id)
    .map((entry) => ({
      season_id: String(entry.season_id),
      name_vi: entry.name_vi || '',
      emoji: entry.emoji || '',
      peak_label_vi: entry.peak_label_vi || '',
      peak_tier_index: Number.isFinite(Number(entry.peak_tier_index)) ? Number(entry.peak_tier_index) : 0,
      reward_coins: numberOrZero(entry.reward_coins),
      ts: entry.ts || null,
    }));
}

function rolloverSeasonState(state, nowIso = new Date().toISOString()) {
  const activeSeason = currentSeason(nowIso);
  const season = state.season && typeof state.season === 'object' ? { ...state.season } : null;
  if (!season || !season.id || season.id === activeSeason.id) return state;

  const medals = normalizeMedals(state.medals);
  const previousSeason = seasonById(season.id);
  const peakTierIndex = Number.isFinite(Number(season.peak_tier_index)) ? Number(season.peak_tier_index) : 0;
  const peakRp = Number.isFinite(Number(season.rp)) ? Number(season.rp) : 0;
  let coins = numberOrZero(state.coins);
  if (!(peakTierIndex === 0 && peakRp === 0)) {
    medals.push({
      season_id: previousSeason.id,
      name_vi: previousSeason.name_vi,
      emoji: previousSeason.emoji,
      peak_label_vi: season.peak_label_vi || buildRankLadderFromPoints(peakRp).label_vi,
      peak_tier_index: peakTierIndex,
      reward_coins: seasonRewardCoins(peakTierIndex),
      ts: nowIso,
    });
    coins += seasonRewardCoins(peakTierIndex);
  }

  const resetRp = cumulativeStartRP(Math.max(0, peakTierIndex - 1));
  const resetLadder = buildRankLadderFromPoints(resetRp);
  return {
    ...state,
    coins,
    medals,
    season: {
      id: activeSeason.id,
      rp: resetRp,
      peak_tier_index: resetLadder.tier_index,
      peak_label_vi: resetLadder.label_vi,
    },
  };
}

function migrateSeasonFields(state, nowIso = new Date().toISOString()) {
  const activeSeason = currentSeason(nowIso);
  const lifetimeRp = (
    state.lifetime_rp != null && Number.isFinite(Number(state.lifetime_rp))
  ) ? Number(state.lifetime_rp) : (
    state.rank_points != null && Number.isFinite(Number(state.rank_points))
  ) ? Number(state.rank_points) : rankPointsFromHistory(state);
  const seasonRp = (
    state.season?.rp != null && Number.isFinite(Number(state.season.rp))
  ) ? Number(state.season.rp) : lifetimeRp;
  const ladder = buildRankLadderFromPoints(seasonRp);
  const season = state.season && typeof state.season === 'object'
    ? {
      ...state.season,
      id: state.season.id || activeSeason.id,
      rp: seasonRp,
      peak_tier_index: Number.isFinite(Number(state.season.peak_tier_index))
        ? Number(state.season.peak_tier_index)
        : ladder.tier_index,
      peak_label_vi: state.season.peak_label_vi || ladder.label_vi,
    }
    : {
      id: activeSeason.id,
      rp: seasonRp,
      peak_tier_index: ladder.tier_index,
      peak_label_vi: ladder.label_vi,
    };
  return {
    ...state,
    lifetime_rp: lifetimeRp,
    rank_points: lifetimeRp,
    season,
    medals: normalizeMedals(state.medals),
  };
}

export function publicSeasonPayload(state, nowIso = new Date().toISOString()) {
  const activeSeason = currentSeason(nowIso);
  const seasonId = state.season?.id || activeSeason.id;
  const seasonMeta = seasonById(seasonId);
  const rp = Number.isFinite(Number(state.season?.rp)) ? Number(state.season.rp) : 0;
  const ladder = computeRankLadder({ ...state, season: { ...state.season, rp } });
  return {
    id: seasonId,
    name_vi: seasonMeta.name_vi,
    emoji: seasonMeta.emoji,
    ends_at: seasonMeta.ends,
    rp,
    ladder,
    peak_label_vi: state.season?.peak_label_vi || ladder.label_vi,
  };
}

function passesLevelQualityGate(state) {
  const history = Array.isArray(state?.pack_history) ? state.pack_history : [];
  const passedScores = history
    .filter((entry) => entry?.passed !== false)
    .map((entry) => entry?.score_percent)
    .filter((score) => score != null && Number.isFinite(Number(score)))
    .slice(0, 5);
  if (passedScores.length < 3) return true;
  const average = passedScores.reduce((sum, score) => sum + Number(score), 0) / passedScores.length;
  return average >= 70;
}

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

export function daysBetweenDateKeys(fromKey, toKey) {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

export function daysUntilNextStreakFreezeMilestone(streakDays, freezeTokens = 0) {
  if (clampFreezeTokenCount(freezeTokens) >= STREAK_FREEZE_TOKEN_CAP) return null;
  const streak = Math.max(0, numberOrZero(streakDays));
  if (streak === 0) return STREAK_FREEZE_MILESTONE_DAYS;
  const remainder = streak % STREAK_FREEZE_MILESTONE_DAYS;
  return remainder === 0 ? STREAK_FREEZE_MILESTONE_DAYS : STREAK_FREEZE_MILESTONE_DAYS - remainder;
}

export function computeStreakAdvance(state, activityDateKey) {
  const lastDateKey = state.last_activity_date_vn || '';
  let streakDays = numberOrZero(state.streak_days);
  let freezeTokens = clampFreezeTokenCount(state.streak_freeze_tokens);
  let milestonesGranted = clampFreezeTokenCount(state.streak_freeze_milestones_granted);
  let freezeUsed = false;
  let freezeEarned = 0;

  if (!activityDateKey) {
    return {
      streak_days: streakDays,
      streak_freeze_tokens: freezeTokens,
      streak_freeze_milestones_granted: milestonesGranted,
      streak_freeze_earned: 0,
      streak_freeze_used: false,
    };
  }

  if (!lastDateKey) {
    streakDays = 1;
  } else if (lastDateKey === activityDateKey) {
    streakDays = Math.max(1, streakDays);
  } else if (isPreviousDate(lastDateKey, activityDateKey)) {
    streakDays = streakDays + 1;
  } else {
    const gap = daysBetweenDateKeys(lastDateKey, activityDateKey);
    if (gap === 2 && freezeTokens > 0) {
      streakDays = streakDays + 1;
      freezeTokens -= 1;
      freezeUsed = true;
    } else {
      streakDays = 1;
      milestonesGranted = 0;
    }
  }

  const eligibleMilestones = Math.min(
    Math.floor(streakDays / STREAK_FREEZE_MILESTONE_DAYS),
    STREAK_FREEZE_TOKEN_CAP,
  );
  const pendingAwards = Math.max(0, eligibleMilestones - milestonesGranted);
  const room = STREAK_FREEZE_TOKEN_CAP - freezeTokens;
  freezeEarned = Math.min(pendingAwards, room);
  freezeTokens += freezeEarned;
  milestonesGranted += freezeEarned;

  return {
    streak_days: streakDays,
    streak_freeze_tokens: freezeTokens,
    streak_freeze_milestones_granted: milestonesGranted,
    streak_freeze_earned: freezeEarned,
    streak_freeze_used: freezeUsed,
  };
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

function clampInt(value, low, high) {
  const parsed = Math.floor(Number(value) || 0);
  return Math.min(high, Math.max(low, parsed));
}

function normalizeDailyQuests(raw, accessCode, todayKey) {
  if (!raw || raw.date !== todayKey) {
    const ids = pickDailyQuestIds(todayKey, accessCode);
    const progress = {};
    const claimed = {};
    for (const id of ids) {
      progress[id] = 0;
      claimed[id] = false;
    }
    return { date: todayKey, ids, progress, claimed };
  }

  const validIds = Array.isArray(raw.ids)
    ? raw.ids.filter((id) => QUEST_IDS.includes(id)).slice(0, 3)
    : [];
  if (validIds.length !== 3 || new Set(validIds).size !== 3) {
    return normalizeDailyQuests(null, accessCode, todayKey);
  }

  const progress = {};
  const claimed = {};
  for (const id of validIds) {
    progress[id] = clampInt(raw.progress?.[id] ?? 0, 0, 999);
    claimed[id] = Boolean(raw.claimed?.[id]);
  }
  return { date: raw.date, ids: validIds, progress, claimed };
}

function normalizePendingChest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!['common', 'rare', 'epic'].includes(raw.rarity)) return null;
  return {
    rarity: raw.rarity,
    reward: {
      coins: numberOrZero(raw.reward?.coins),
      part_id: raw.reward?.part_id ? String(raw.reward.part_id) : null,
      ...(raw.reward?.part_name ? { part_name: String(raw.reward.part_name) } : {}),
    },
    duplicate: Boolean(raw.duplicate),
    awarded_at: raw.awarded_at || null,
  };
}

function normalizeChestHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && ['common', 'rare', 'epic'].includes(entry.rarity))
    .slice(-CHEST_HISTORY_LIMIT)
    .map((entry) => ({
      opened_at: entry.opened_at || null,
      rarity: entry.rarity,
      reward: {
        coins: numberOrZero(entry.reward?.coins),
        part_id: entry.reward?.part_id || null,
      },
      duplicate: Boolean(entry.duplicate),
    }));
}

function normalizeDailyLoginChest(raw) {
  if (!raw || typeof raw !== 'object') return { last_claim_date: null };
  return { last_claim_date: raw.last_claim_date || null };
}

export function normalizeAvatarStage(raw, state = {}) {
  const unlockedParts = Array.isArray(state?.unlocked_parts) ? state.unlocked_parts : [];
  const computedLadder = state?.rank_ladder || computeRankLadder(state);
  const tierIndex = numberOrZero(computedLadder?.tier_index);
  if (tierIndex < 1 && unlockedParts.length === 0) return 'egg';
  if (unlockedParts.length > 0) return 'custom';
  return 'basic';
}

function grandfatherUnlockedAvatarParts(raw, unlockedParts) {
  const unlocked = new Set(unlockedParts);
  const monster = raw?.avatar?.monster;
  if (!monster || typeof monster !== 'object') return [...unlocked];
  for (const slot of MONSTER_SLOTS) {
    const partId = String(monster[slot] || '').trim();
    if (
      partId
      && (getPartRarity(partId) !== 'common' || ['effects', 'frame'].includes(slot))
    ) {
      unlocked.add(partId);
    }
  }
  return [...unlocked];
}

function normalizePurchasedMonster(raw, unlockedParts, accessCode) {
  const normalized = normalizeAvatarMonster(raw, accessCode, MONSTER_MANIFEST);
  const unlocked = new Set(unlockedParts);
  const purchasedOnly = { ...BASIC_MONSTER_CONFIG };
  for (const slot of MONSTER_SLOTS) {
    const partId = String(normalized[slot] || '').trim();
    if (
      partId
      && (getPartRarity(partId) !== 'common' || ['effects', 'frame'].includes(slot))
      && unlocked.has(partId)
    ) {
      purchasedOnly[slot] = partId;
    }
  }
  return purchasedOnly;
}

function normalizePendingCeremony(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const partId = String(raw.part_id || '').trim();
  if (!partId || !['common', 'rare', 'epic'].includes(raw.rarity)) return null;
  return {
    part_id: partId,
    rarity: raw.rarity,
    ts: raw.ts || null,
  };
}

function clampPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function isSuspectLearningPack({ timeToPassMs, scorePercent }) {
  const time = Number(timeToPassMs);
  const score = Number(scorePercent);
  return Number.isFinite(time)
    && Number.isFinite(score)
    && time < SUSPECT_PACK_TIME_MS
    && score >= SUSPECT_PACK_SCORE_PERCENT;
}

export function calculateAttentionScore({
  startedAt,
  endedAt,
  events = [],
  eventWindowMs = ATTENTION_EVENT_WINDOW_MS,
} = {}) {
  const start = Date.parse(String(startedAt || ''));
  const end = Date.parse(String(endedAt || ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const windows = (Array.isArray(events) ? events : [])
    .map((event) => {
      const ts = Date.parse(String(event?.ts || ''));
      if (!Number.isFinite(ts)) return null;
      return [Math.max(start, ts), Math.min(end, ts + eventWindowMs)];
    })
    .filter((window) => Array.isArray(window) && window[1] > window[0])
    .sort((a, b) => a[0] - b[0]);
  if (!windows.length) return 0;

  let activeMs = 0;
  let [currentStart, currentEnd] = windows[0];
  for (const [from, to] of windows.slice(1)) {
    if (from <= currentEnd) {
      currentEnd = Math.max(currentEnd, to);
    } else {
      activeMs += currentEnd - currentStart;
      currentStart = from;
      currentEnd = to;
    }
  }
  activeMs += currentEnd - currentStart;
  return clampPercent((activeMs / (end - start)) * 100);
}

function normalizeLearningEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const packId = String(raw.pack_id || '').trim();
  if (!packId) return null;
  return {
    pack_id: packId,
    started_at: typeof raw.started_at === 'string' ? raw.started_at : null,
    passed_at: typeof raw.passed_at === 'string' ? raw.passed_at : null,
    score: Math.max(0, Math.min(1, Number(raw.score) || 0)),
    retry_count: Math.max(0, Math.floor(Number(raw.retry_count) || 0)),
    attention_score: clampPercent(raw.attention_score),
    time_to_pass_ms: Math.max(0, Math.floor(Number(raw.time_to_pass_ms) || 0)),
    suspect: raw.suspect === true,
  };
}

export function summarizeLearningMetrics(history = [], nowIso = new Date().toISOString()) {
  const now = Date.parse(String(nowIso || ''));
  const cutoff = Number.isFinite(now) ? now - LEARNING_WINDOW_MS : 0;
  const recent = (Array.isArray(history) ? history : []).filter((entry) => {
    const ts = Date.parse(String(entry?.passed_at || entry?.started_at || ''));
    return Number.isFinite(ts) && (!cutoff || ts >= cutoff);
  });
  const count = recent.length;
  const retryTotal = recent.reduce((sum, entry) => sum + Math.max(0, Number(entry.retry_count) || 0), 0);
  const attentionTotal = recent.reduce((sum, entry) => sum + clampPercent(entry.attention_score), 0);
  return {
    first_try_pass_rate: count
      ? Math.round((recent.filter((entry) => Number(entry.retry_count || 0) === 0).length / count) * 100) / 100
      : 0,
    avg_retry_count: count ? Math.round((retryTotal / count) * 100) / 100 : 0,
    avg_attention_score: count ? Math.round(attentionTotal / count) : 0,
    suspect_count: recent.filter((entry) => entry.suspect === true).length,
    calculated_at: Number.isFinite(now) ? new Date(now).toISOString() : new Date().toISOString(),
  };
}

export function normalizeLearningMetrics(raw, nowIso = new Date().toISOString()) {
  const history = Array.isArray(raw?.packs_history)
    ? raw.packs_history.map(normalizeLearningEntry).filter(Boolean).slice(0, LEARNING_HISTORY_LIMIT)
    : [];
  return {
    packs_history: history,
    '7day_summary': summarizeLearningMetrics(history, nowIso),
  };
}

export function buildLearningMetricEntry({
  packId,
  startedAt,
  passedAt,
  scorePercent,
  retryCount,
  attentionScore,
}) {
  const start = Date.parse(String(startedAt || ''));
  const pass = Date.parse(String(passedAt || ''));
  const timeToPassMs = Number.isFinite(start) && Number.isFinite(pass) && pass >= start ? pass - start : 0;
  return {
    pack_id: String(packId || '').trim(),
    started_at: Number.isFinite(start) ? new Date(start).toISOString() : null,
    passed_at: Number.isFinite(pass) ? new Date(pass).toISOString() : null,
    score: clampPercent(scorePercent) / 100,
    retry_count: Math.max(0, Math.floor(Number(retryCount) || 0)),
    attention_score: clampPercent(attentionScore),
    time_to_pass_ms: timeToPassMs,
    suspect: isSuspectLearningPack({ timeToPassMs, scorePercent }),
  };
}

export function appendLearningMetric(rawMetrics, rawEntry, nowIso = new Date().toISOString()) {
  const metrics = normalizeLearningMetrics(rawMetrics, nowIso);
  const entry = normalizeLearningEntry(rawEntry);
  if (!entry) return metrics;
  const history = [
    entry,
    ...metrics.packs_history.filter((item) => item.pack_id !== entry.pack_id),
  ].slice(0, LEARNING_HISTORY_LIMIT);
  return {
    packs_history: history,
    '7day_summary': summarizeLearningMetrics(history, nowIso),
  };
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
  const storedUnlockedParts = Array.isArray(raw?.unlocked_parts)
    ? Array.from(new Set(raw.unlocked_parts.filter(Boolean).map(String)))
    : [];
  const unlockedParts = raw?.avatar_stage
    ? storedUnlockedParts
    : grandfatherUnlockedAvatarParts(raw, storedUnlockedParts);
  const avatarStage = normalizeAvatarStage(raw?.avatar_stage, {
    ...raw,
    current_level: currentLevel,
    unlocked_parts: unlockedParts,
  });
  const hasStoredMonster = raw?.avatar?.monster && typeof raw.avatar.monster === 'object';
  const avatarMonster = avatarStage === 'custom' && hasStoredMonster
    ? normalizePurchasedMonster(raw.avatar.monster, unlockedParts, accessCode)
    : avatarStage === 'egg'
      ? normalizeAvatarMonster(null, accessCode, MONSTER_MANIFEST)
      : { ...BASIC_MONSTER_CONFIG };
  const base = {
    schema_version: 2,
    level_reset_version: LEVEL_RESET_VERSION,
    access_code: String(accessCode || raw?.access_code || '').trim().toUpperCase(),
    student_name: raw?.student_name || profile.student_name || legacyProgress.student_name || '',
    current_level: currentLevel,
    initial_level: initialLevel,
    unlocked_levels: Array.from(new Set([...unlockedLevels, currentLevel])),
    rank_title: RANK_TITLES[currentLevel] || RANK_TITLES[START_LEVEL],
    rank_asset_url: RANK_ASSETS[currentLevel] || RANK_ASSETS[START_LEVEL],
    coins,
    total_xp: totalXp,
    xp_in_level: xpInLevel,
    xp_to_next_level: xpToNextLevel(currentLevel),
    completed_packs: completedPacks,
    completed_pack_ids: Array.isArray(raw?.completed_pack_ids) ? raw.completed_pack_ids.slice(-100) : [],
    penalized_pack_ids: Array.isArray(raw?.penalized_pack_ids) ? raw.penalized_pack_ids.slice(-100) : [],
    level_progress: normalizeLevelProgress(levelProgress),
    streak_days: numberOrZero(raw?.streak_days ?? legacyProgress.streak_days),
    streak_freeze_tokens: clampFreezeTokenCount(raw?.streak_freeze_tokens),
    streak_freeze_milestones_granted: clampFreezeTokenCount(raw?.streak_freeze_milestones_granted),
    last_activity_date_vn: raw?.last_activity_date_vn || vietnamDateKey(legacyProgress.last_activity_at || ''),
    last_activity_at: raw?.last_activity_at || legacyProgress.last_activity_at || null,
    voice_attempts: numberOrZero(raw?.voice_attempts),
    pack_history: Array.isArray(raw?.pack_history) ? raw.pack_history.slice(0, 50) : [],
    ...(raw?.rank_points != null && Number.isFinite(Number(raw.rank_points))
      ? { rank_points: Number(raw.rank_points) }
      : {}),
    ...(raw?.lifetime_rp != null && Number.isFinite(Number(raw.lifetime_rp))
      ? { lifetime_rp: Number(raw.lifetime_rp) }
      : {}),
    ...(raw?.season && typeof raw.season === 'object' ? { season: raw.season } : {}),
    medals: normalizeMedals(raw?.medals),
    ...(raw?.rank_daily && typeof raw.rank_daily === 'object' ? { rank_daily: raw.rank_daily } : {}),
    badges: Array.isArray(raw?.badges) ? raw.badges : [],
    inventory: normalizeInventory(raw?.inventory),
    equipped: normalizeEquipped(raw?.equipped),
    daily_quests: normalizeDailyQuests(raw?.daily_quests, accessCode, vietnamDateKey(nowIso)),
    pending_chest: normalizePendingChest(raw?.pending_chest),
    chest_history: normalizeChestHistory(raw?.chest_history),
    daily_login_chest: normalizeDailyLoginChest(raw?.daily_login_chest),
    learning_metrics: normalizeLearningMetrics(raw?.learning_metrics, nowIso),
    combo_lifetime_xu: numberOrZero(raw?.combo_lifetime_xu),
    unlocked_parts: unlockedParts,
    avatar_stage: avatarStage,
    pending_ceremony: normalizePendingCeremony(raw?.pending_ceremony),
    avatar: {
      enabled: true,
      preset_id: raw?.avatar?.preset_id || null,
      gender: raw?.avatar?.gender || null,
      equipped: raw?.avatar?.equipped || {},
      monster: avatarMonster,
    },
    created_at: raw?.created_at || nowIso,
    updated_at: raw?.updated_at || nowIso,
  };
  const withSeason = migrateSeasonFields(refreshBadges(base), nowIso);
  return rolloverSeasonState(withSeason, nowIso);
}

export function getDailyQuestsView(state, dateKey, accessCode) {
  const dailyQuests = normalizeDailyQuests(state?.daily_quests, accessCode, dateKey);
  const pendingChest = normalizePendingChest(state?.pending_chest);
  return {
    date: dailyQuests.date,
    quests: dailyQuests.ids.map((id) => ({
      id,
      label_vi: QUEST_DEFS[id].label_vi,
      target: QUEST_DEFS[id].target,
      progress: dailyQuests.progress[id] || 0,
      reward_coins: QUEST_DEFS[id].reward.coins,
      reward_rp: QUEST_DEFS[id].reward.rp || 0,
      claimed: Boolean(dailyQuests.claimed[id]),
      complete: questCompleted(id, dailyQuests.progress[id] || 0),
    })),
    pending_chest: pendingChest
      ? { ...pendingChest, preview_text: chestPreviewText(pendingChest.rarity) }
      : null,
  };
}

export function applyQuestProgress(state, eventName, params, dateKey, accessCode) {
  const dailyQuests = normalizeDailyQuests(state?.daily_quests, accessCode, dateKey);
  const deltas = questDeltasForEvent(eventName, params || {}, dailyQuests.ids);
  const progress = { ...dailyQuests.progress };
  for (const { questId, delta } of deltas) {
    const target = QUEST_DEFS[questId]?.target ?? 0;
    progress[questId] = Math.min(target, (progress[questId] || 0) + delta);
  }
  return {
    ...state,
    daily_quests: {
      ...dailyQuests,
      progress,
    },
  };
}

export function claimQuestReward(state, questId, dateKey, accessCode) {
  const dailyQuests = normalizeDailyQuests(state?.daily_quests, accessCode, dateKey);
  if (!dailyQuests.ids.includes(questId)) {
    return { state, error: 'quest_not_active_today' };
  }
  if (dailyQuests.claimed[questId]) {
    return { state, error: 'already_claimed' };
  }
  if (!questCompleted(questId, dailyQuests.progress[questId] || 0)) {
    return { state, error: 'not_complete' };
  }

  const reward = questReward(questId);
  let nextState = {
    ...state,
    coins: numberOrZero(state?.coins) + reward.coins,
    daily_quests: {
      ...dailyQuests,
      claimed: {
        ...dailyQuests.claimed,
        [questId]: true,
      },
    },
  };
  if (reward.rp > 0) {
    nextState = applyQuestRpBonus(nextState, reward.rp);
  }
  return { state: nextState, reward };
}

function applyQuestRpBonus(state, rpBonus) {
  const lifetimeRp = numberOrZero(state?.lifetime_rp ?? state?.rank_points) + rpBonus;
  const seasonRp = numberOrZero(state?.season?.rp) + rpBonus;
  return {
    ...state,
    lifetime_rp: lifetimeRp,
    rank_points: lifetimeRp,
    season: {
      ...(state.season || {}),
      rp: seasonRp,
    },
  };
}

export function awardPendingChest(state, { passed } = {}, rngFn = Math.random) {
  if (!passed || state?.pending_chest) return state;
  const rawChest = rollChest(rngFn);
  const ownedParts = new Set(state?.unlocked_parts || []);
  const finalChest = autoConvertDuplicate(rawChest, ownedParts);
  return {
    ...state,
    pending_chest: {
      rarity: finalChest.rarity,
      reward: finalChest.reward,
      duplicate: finalChest.duplicate,
      awarded_at: new Date().toISOString(),
    },
  };
}

export function consumePendingChest(state, dateKey, accessCode) {
  if (!state?.pending_chest) {
    return { state, error: 'no_pending_chest' };
  }

  const chest = normalizePendingChest(state.pending_chest);
  if (!chest) {
    return { state: { ...state, pending_chest: null }, error: 'no_pending_chest' };
  }
  let unlockedParts = Array.isArray(state.unlocked_parts) ? state.unlocked_parts : [];
  if (chest.reward.part_id && !chest.duplicate && !unlockedParts.includes(chest.reward.part_id)) {
    unlockedParts = [...unlockedParts, chest.reward.part_id];
  }
  const historyEntry = {
    opened_at: new Date().toISOString(),
    rarity: chest.rarity,
    reward: {
      coins: chest.reward.coins,
      part_id: chest.duplicate ? null : chest.reward.part_id,
    },
    duplicate: chest.duplicate,
  };
  const chestHistory = [
    ...(Array.isArray(state.chest_history) ? state.chest_history : []),
    historyEntry,
  ].slice(-CHEST_HISTORY_LIMIT);
  let nextState = {
    ...state,
    coins: numberOrZero(state.coins) + chest.reward.coins,
    unlocked_parts: unlockedParts,
    chest_history: chestHistory,
    pending_chest: null,
  };
  nextState = applyQuestProgress(nextState, 'chest_opened', { rarity: chest.rarity }, dateKey, accessCode);
  return {
    state: nextState,
    reward: {
      coins: chest.reward.coins,
      part_id: chest.duplicate ? null : chest.reward.part_id,
      duplicate: chest.duplicate,
      rarity: chest.rarity,
    },
  };
}

export function claimDailyLoginChest(state, dateKey) {
  const dailyLoginChest = normalizeDailyLoginChest(state?.daily_login_chest);
  if (dailyLoginChest.last_claim_date === dateKey) {
    return { state, error: 'already_claimed_today' };
  }
  const streak = clampInt(state?.streak_days, 0, 999);
  const cappedStreak = Math.min(streak, DAILY_LOGIN_CHEST_MAX_STREAK);
  const coins = DAILY_LOGIN_CHEST_BASE + DAILY_LOGIN_CHEST_PER_STREAK * cappedStreak;
  return {
    state: {
      ...state,
      coins: numberOrZero(state?.coins) + coins,
      daily_login_chest: { last_claim_date: dateKey },
    },
    reward: {
      coins,
      formula: {
        base: DAILY_LOGIN_CHEST_BASE,
        per_streak: DAILY_LOGIN_CHEST_PER_STREAK,
        streak_used: cappedStreak,
      },
    },
  };
}

export function recordComboBonus(state, comboXuRequested) {
  const capped = clampInt(comboXuRequested, 0, COMBO_XU_CAP_PER_PACK);
  if (capped === 0) return state;
  return {
    ...state,
    coins: numberOrZero(state?.coins) + capped,
    combo_lifetime_xu: numberOrZero(state?.combo_lifetime_xu) + capped,
  };
}

export function previewDailyLoginChest(state, dateKey) {
  const dailyLoginChest = normalizeDailyLoginChest(state?.daily_login_chest);
  const available = dailyLoginChest.last_claim_date !== dateKey;
  const streak = clampInt(state?.streak_days, 0, 999);
  const cappedStreak = Math.min(streak, DAILY_LOGIN_CHEST_MAX_STREAK);
  return {
    available,
    coins: DAILY_LOGIN_CHEST_BASE + DAILY_LOGIN_CHEST_PER_STREAK * cappedStreak,
    next_claim_date: available ? null : addDaysToDateKey(dailyLoginChest.last_claim_date, 1),
  };
}

function addDaysToDateKey(dateKey, days) {
  if (!dateKey) return null;
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function applyPackCompletion(
  state,
  {
    packId,
    completedAt = new Date().toISOString(),
    rewardsEarned = {},
    activityResults = [],
    scorePercent = null,
    learningMetric = null,
  } = {},
) {
  const id = String(packId || '').trim();
  if (!id) throw new Error('pack_id required');
  if (state.completed_pack_ids.includes(id)) {
    return {
      state: refreshBadges(state),
      level_up: null,
      level_gate_hint_vi: null,
      already_counted: true,
    };
  }

  const currentLevel = safeLevel(state.current_level);
  const levelProgress = normalizeLevelProgress(state.level_progress);
  const nextLevelCount = numberOrZero(levelProgress[currentLevel]) + 1;
  const currentDateKey = vietnamDateKey(completedAt);
  const voiceAttempts = hasVoiceAttempt(activityResults) ? state.voice_attempts + 1 : state.voice_attempts;
  const earnedXp = numberOrZero(rewardsEarned.xp);
  const streakUpdate = computeStreakAdvance(state, currentDateKey);
  const nextCompleted = state.completed_packs + 1;
  const nextCompletedIds = [...state.completed_pack_ids, id].slice(-100);
  let nextCurrentLevel = currentLevel;
  const xpTarget = xpToNextLevel(currentLevel);
  const nextXpTotal = state.xp_in_level + earnedXp;
  let xpInLevel = xpTarget ? Math.min(xpTarget, nextXpTotal) : nextXpTotal;
  let levelUp = null;
  let levelGateHintVi = null;

  levelProgress[currentLevel] = nextLevelCount;
  const nextPackHistory = [
    {
      pack_id: id,
      completed_at: completedAt,
      level: currentLevel,
      coins: numberOrZero(rewardsEarned.coins),
      xp: earnedXp,
      ...(scorePercent !== null && scorePercent !== undefined
        ? { score_percent: Number(scorePercent) }
        : {}),
    },
    ...state.pack_history,
  ].slice(0, 50);
  if (xpTarget && nextXpTotal >= xpTarget) {
    const nextLevel = levelAfter(currentLevel);
    if (nextLevel) {
      if (passesLevelQualityGate({ ...state, pack_history: nextPackHistory })) {
        levelUp = {
          from_level: currentLevel,
          to_level: nextLevel,
          message_vi: `Con đã mở khóa ${nextLevel}.`,
        };
        nextCurrentLevel = nextLevel;
        levelProgress[nextLevel] = 0;
        xpInLevel = 0;
      } else {
        levelGateHintVi = LEVEL_GATE_HINT_VI;
        xpInLevel = xpTarget;
      }
    } else {
      xpInLevel = xpTarget;
    }
  }

  const nextState = {
    ...state,
    current_level: nextCurrentLevel,
    unlocked_levels: Array.from(new Set([...state.unlocked_levels, nextCurrentLevel])),
    rank_title: RANK_TITLES[nextCurrentLevel] || state.rank_title,
    rank_asset_url: RANK_ASSETS[nextCurrentLevel] || state.rank_asset_url || RANK_ASSETS[START_LEVEL],
    coins: state.coins + numberOrZero(rewardsEarned.coins),
    total_xp: state.total_xp + earnedXp,
    xp_in_level: xpInLevel,
    xp_to_next_level: xpToNextLevel(nextCurrentLevel),
    completed_packs: nextCompleted,
    completed_pack_ids: nextCompletedIds,
    level_progress: levelProgress,
    ...streakUpdate,
    last_activity_date_vn: currentDateKey,
    last_activity_at: completedAt,
    voice_attempts: voiceAttempts,
    pack_history: nextPackHistory,
    learning_metrics: learningMetric
      ? appendLearningMetric(state.learning_metrics, learningMetric, completedAt)
      : normalizeLearningMetrics(state.learning_metrics, completedAt),
    ...(levelGateHintVi ? { level_gate_hint_vi: levelGateHintVi } : {}),
  };

  return {
    state: refreshBadges(nextState),
    level_up: levelUp,
    level_gate_hint_vi: levelGateHintVi,
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
  const streakUpdate = computeStreakAdvance(state, currentDateKey);
  const nextState = {
    ...state,
    current_level: currentLevel,
    rank_title: RANK_TITLES[currentLevel] || state.rank_title,
    rank_asset_url: RANK_ASSETS[currentLevel] || state.rank_asset_url || RANK_ASSETS[START_LEVEL],
    total_xp: Math.max(0, state.total_xp - loss),
    xp_in_level: Math.max(0, state.xp_in_level - loss),
    xp_to_next_level: xpToNextLevel(currentLevel),
    penalized_pack_ids: [...penalizedPackIds, id].slice(-100),
    ...streakUpdate,
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

function hashAccessCode(accessCode) {
  const clean = String(accessCode || '').trim().toUpperCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i += 1) {
    hash = ((hash << 5) - hash) + clean.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function defaultMonsterForCode(accessCode, manifest = MONSTER_MANIFEST) {
  const hash = hashAccessCode(accessCode);
  const pickPart = (slot, salt) => {
    const parts = Array.isArray(manifest?.[slot]) ? manifest[slot] : [];
    if (!parts.length) return 'default';
    const index = (hash + salt) % parts.length;
    return parts[index]?.id || parts[0]?.id || 'default';
  };
  return {
    body: pickPart('body', 0),
    eyes: pickPart('eyes', 11),
    mouth: pickPart('mouth', 23),
    arms: pickPart('arms', 37),
    detail: pickPart('detail', 53),
    effects: '',
    frame: '',
    color: MONSTER_COLORS[(hash >> 3) % MONSTER_COLORS.length] || MONSTER_COLORS[0],
  };
}

function resolveMonsterPartId(slot, partId, manifest, defaults) {
  const id = String(partId || '').trim();
  const parts = Array.isArray(manifest?.[slot]) ? manifest[slot] : [];
  if (!parts.length) return 'default';
  if (['detail', 'effects', 'frame'].includes(slot) && !id) return '';
  if (parts.some((part) => part.id === id)) return id;
  const migrated = id.replace(/^png-double-/, 'png-default-');
  if (migrated !== id && parts.some((part) => part.id === migrated)) return migrated;
  return defaults[slot];
}

export function normalizeAvatarMonster(raw, accessCode, manifest = MONSTER_MANIFEST) {
  const defaults = defaultMonsterForCode(accessCode, manifest);
  if (!raw || typeof raw !== 'object') return defaults;

  const validPart = (slot, value) => resolveMonsterPartId(slot, value, manifest, defaults);

  const color = String(raw.color || '').trim();
  return {
    body: validPart('body', raw.body),
    eyes: validPart('eyes', raw.eyes),
    mouth: validPart('mouth', raw.mouth),
    arms: validPart('arms', raw.arms),
    detail: validPart('detail', raw.detail),
    effects: validPart('effects', raw.effects),
    frame: validPart('frame', raw.frame),
    color: MONSTER_COLORS.includes(color) ? color : defaults.color,
  };
}

export function saveAvatarMonster(state, monster, accessCode, manifest = MONSTER_MANIFEST) {
  const unlockedParts = new Set(state?.unlocked_parts || []);
  const allowedMonster = { ...BASIC_MONSTER_CONFIG, color: monster?.color || BASIC_MONSTER_CONFIG.color };
  for (const slot of MONSTER_SLOTS) {
    const partId = String(monster?.[slot] || '').trim();
    if (
      partId
      && (getPartRarity(partId) !== 'common' || ['effects', 'frame'].includes(slot))
      && unlockedParts.has(partId)
    ) {
      allowedMonster[slot] = partId;
    }
  }
  const normalized = normalizeAvatarMonster(allowedMonster, accessCode, manifest);
  return {
    ok: true,
    state: {
      ...state,
      avatar_stage: normalizeAvatarStage('custom', state),
      avatar: {
        ...state.avatar,
        enabled: true,
        monster: normalized,
      },
      updated_at: new Date().toISOString(),
    },
    monster: normalized,
  };
}

export function publicMonsterManifest(manifest = MONSTER_MANIFEST) {
  return MONSTER_SLOTS.reduce((acc, slot) => {
    acc[slot] = Array.isArray(manifest[slot])
      ? manifest[slot].map(({ id, file }) => ({ id, file }))
      : [];
    return acc;
  }, {});
}

export function getShopItem(itemId) {
  const id = String(itemId || '').trim();
  return SHOP_CATALOG.find((item) => item.id === id) || null;
}

export function normalizeInventory(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(
    raw
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => entry.trim())
      .filter((entry) => getShopItem(entry)),
  )];
}

export function normalizeEquipped(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const equipped = {};
  for (const slot of SHOP_SLOTS) {
    const itemId = source[slot];
    if (typeof itemId === 'string' && itemId.trim() && getShopItem(itemId.trim())) {
      equipped[slot] = itemId.trim();
    }
  }
  return equipped;
}

export function publicShopCatalog() {
  return SHOP_CATALOG.map(({ id, slot, name_vi, emoji, price_coins, css_class }) => ({
    id,
    slot,
    name_vi,
    emoji,
    price_coins,
    css_class,
  }));
}

export function equippedDisplay(state) {
  return SHOP_SLOTS
    .map((slot) => {
      const itemId = normalizeEquipped(state.equipped)[slot];
      const item = itemId ? getShopItem(itemId) : null;
      return item ? { slot, id: item.id, name_vi: item.name_vi, emoji: item.emoji, css_class: item.css_class } : null;
    })
    .filter(Boolean);
}

export function purchaseItem(state, itemId) {
  const item = getShopItem(itemId);
  if (!item) return { ok: false, error: 'item_not_found', state };
  const inventory = normalizeInventory(state.inventory);
  if (inventory.includes(item.id)) {
    return { ok: true, already_owned: true, state, item };
  }
  const price = numberOrZero(item.price_coins);
  if (numberOrZero(state.coins) < price) {
    return { ok: false, error: 'insufficient_coins', state, item };
  }
  const nextState = refreshBadges({
    ...state,
    coins: numberOrZero(state.coins) - price,
    inventory: [...inventory, item.id],
    updated_at: new Date().toISOString(),
  });
  return { ok: true, purchased: true, state: nextState, item };
}

export function equipItem(state, itemId) {
  const item = getShopItem(itemId);
  if (!item) return { ok: false, error: 'item_not_found', state };
  const inventory = normalizeInventory(state.inventory);
  if (!inventory.includes(item.id)) {
    return { ok: false, error: 'not_owned', state, item };
  }
  return {
    ok: true,
    state: {
      ...state,
      equipped: { ...normalizeEquipped(state.equipped), [item.slot]: item.id },
      updated_at: new Date().toISOString(),
    },
    item,
  };
}

export function unequipSlot(state, slot) {
  const slotId = String(slot || '').trim();
  if (!SHOP_SLOTS.includes(slotId)) {
    return { ok: false, error: 'invalid_slot', state };
  }
  const equipped = { ...normalizeEquipped(state.equipped) };
  delete equipped[slotId];
  return {
    ok: true,
    state: { ...state, equipped, updated_at: new Date().toISOString() },
  };
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
    rank_asset_url: state.rank_asset_url || RANK_ASSETS[currentLevel] || RANK_ASSETS[START_LEVEL],
    coins: state.coins,
    coins_tooltip: COINS_TOOLTIP,
    total_xp: state.total_xp,
    xp: state.xp_in_level,
    xp_in_level: state.xp_in_level,
    xp_to_next_level: xpTarget,
    xp_percent: xpTarget ? Math.min(100, Math.round((state.xp_in_level / xpTarget) * 100)) : 100,
    streak_days: state.streak_days,
    streak_freeze_tokens: clampFreezeTokenCount(state.streak_freeze_tokens),
    streak_freeze_cap: STREAK_FREEZE_TOKEN_CAP,
    streak_freeze_hint_vi: STREAK_FREEZE_HINT_VI,
    streak_freeze_next_in_days: daysUntilNextStreakFreezeMilestone(
      state.streak_days,
      state.streak_freeze_tokens,
    ),
    completed_packs: state.completed_packs,
    packs_completed_in_level: completedInLevel,
    packs_until_level_up: packsUntilLevelUp(currentLevel, state.xp_in_level),
    badges: state.badges,
    avatar_stage: normalizeAvatarStage(state.avatar_stage, state),
    monster_basic_defaults: { ...BASIC_MONSTER_CONFIG },
    avatar: state.avatar,
    monster_parts: publicMonsterManifest(),
    unlocked_parts: Array.isArray(state.unlocked_parts) ? state.unlocked_parts : [],
    inventory: normalizeInventory(state.inventory),
    equipped: normalizeEquipped(state.equipped),
    equipped_display: equippedDisplay(state),
    shop_catalog: publicShopCatalog(),
    last_activity_at: state.last_activity_at,
    last_activity_date_vn: state.last_activity_date_vn,
    rank_ladder: computeRankLadder(state),
    season: publicSeasonPayload(state),
    medals: normalizeMedals(state.medals),
    daily_quests_view: getDailyQuestsView(state, vietnamDateKey(), state.access_code || ''),
    daily_login_chest: previewDailyLoginChest(state, vietnamDateKey()),
    pending_chest: state.pending_chest || null,
    pending_ceremony: normalizePendingCeremony(state.pending_ceremony),
    learning_metrics: normalizeLearningMetrics(state.learning_metrics),
    ...(state.level_gate_hint_vi ? { level_gate_hint_vi: state.level_gate_hint_vi } : {}),
  };
}

export function getEggOrMonsterView(state) {
  const currentLevel = safeLevel(state?.current_level);
  const stage = normalizeAvatarStage(state?.avatar_stage, state);
  if (stage === 'egg') {
    return {
      stage,
      name: state?.student_name || '',
      level: currentLevel,
      packs_until_level_up: packsUntilLevelUp(currentLevel, state?.xp_in_level),
    };
  }
  return {
    stage,
    monster: stage === 'basic' ? { ...BASIC_MONSTER_CONFIG } : state?.avatar?.monster,
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

/** Admin-only: snap a test account to L1–L5 with plausible ladder progress. */
export function buildAdminTestLevelState(existingState, targetLevel, { accessCode, codeData = null, nowIso = new Date().toISOString() } = {}) {
  const level = safeLevel(targetLevel);
  const levelIndex = LEVELS.indexOf(level);
  const unlockedLevels = LEVELS.slice(0, levelIndex + 1);
  const levelProgress = normalizeLevelProgress({});
  for (let i = 0; i < levelIndex; i += 1) {
    levelProgress[LEVELS[i]] = PACKS_TO_NEXT_LEVEL[LEVELS[i]];
  }
  levelProgress[level] = 0;

  const base =
    existingState && existingState.schema_version === 2
      ? { ...existingState }
      : normalizeProgressState(null, { accessCode, codeData, nowIso });

  const xpTarget = xpToNextLevel(level);
  let totalXp = numberOrZero(base.total_xp);
  for (let i = 0; i < levelIndex; i += 1) {
    const floor = PACKS_TO_NEXT_LEVEL[LEVELS[i]] * XP_PER_PASSED_PACK;
    if (totalXp < floor) totalXp = floor;
  }

  return refreshBadges({
    ...base,
    schema_version: 2,
    level_reset_version: LEVEL_RESET_VERSION,
    access_code: String(accessCode || base.access_code || '').trim().toUpperCase(),
    student_name: base.student_name || codeData?.student_profile?.student_name || codeData?.progress?.student_name || '',
    current_level: level,
    initial_level: base.initial_level || START_LEVEL,
    unlocked_levels: unlockedLevels,
    rank_title: RANK_TITLES[level],
    rank_asset_url: RANK_ASSETS[level],
    total_xp: totalXp,
    xp_in_level: 0,
    xp_to_next_level: xpTarget,
    level_progress: levelProgress,
    updated_at: nowIso,
  });
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
  return Array.isArray(activityResults) && activityResults.some(
    (item) => item?.type === 'listen_and_speak' || item?.type === 'retell_summary',
  );
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

function clampFreezeTokenCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(STREAK_FREEZE_TOKEN_CAP, Math.floor(parsed));
}
