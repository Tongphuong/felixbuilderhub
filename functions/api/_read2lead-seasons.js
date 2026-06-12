export const PRE_SEASON = {
  id: '2026-S0',
  name_vi: 'Mùa Khởi Đầu',
  emoji: '🌱',
  starts: '2020-01-01',
  ends: '2026-06-30',
};

export const SEASONS = [
  { id: '2026-S1', name_vi: 'Mùa Khám Phá', emoji: '🧭', starts: '2026-07-01', ends: '2026-08-31' },
  { id: '2026-S2', name_vi: 'Mùa Phiêu Lưu', emoji: '🗺️', starts: '2026-09-01', ends: '2026-10-31' },
];

export const SEASON_REWARD_COINS = [10, 20, 35, 50, 70, 90, 120, 150];

export const RANK_TIER_COSTS = [9, 9, 12, 12, 15, 15, 15];

export function tierStartRp(tierIndex) {
  const index = Math.max(0, Math.floor(Number(tierIndex) || 0));
  return RANK_TIER_COSTS.slice(0, index).reduce((sum, cost) => sum + cost, 0);
}

export function cumulativeStartRP(tierIndex) {
  return tierStartRp(Math.max(0, Math.floor(Number(tierIndex) || 0)));
}

export function rankApexThreshold() {
  return RANK_TIER_COSTS.reduce((sum, cost) => sum + cost, 0);
}

function vnDateKeyFromDate(date) {
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function currentSeason(now = new Date()) {
  const today = vnDateKeyFromDate(now instanceof Date ? now : new Date(now));
  if (!today || today < '2026-07-01') {
    return { ...PRE_SEASON };
  }
  for (const season of SEASONS) {
    if (today >= season.starts && today <= season.ends) {
      return { ...season };
    }
  }
  const last = SEASONS[SEASONS.length - 1];
  if (today > last.ends) {
    return { ...last };
  }
  return { ...PRE_SEASON };
}

export function seasonById(seasonId) {
  const id = String(seasonId || '').trim();
  if (id === PRE_SEASON.id) return { ...PRE_SEASON };
  const found = SEASONS.find((season) => season.id === id);
  return found ? { ...found } : { ...PRE_SEASON };
}

export function seasonRewardCoins(peakTierIndex) {
  const index = Math.max(0, Math.min(7, Math.floor(Number(peakTierIndex) || 0)));
  return SEASON_REWARD_COINS[index] || 0;
}
