/** V2.1 lesson game state — combo, badges, coins, stars (frontend). */

export type ComboLevel = 'normal' | 'fire' | 'lightning' | 'rainbow';
export type ChestTier = 'common' | 'rare' | 'epic';

export interface GameState {
  combo: { current: number; max: number; phase_max: Record<string, number> };
  coins: { base: number; combo_bonus: number; speed_bonus: number; total: number };
  badges: Array<{ phase: string; name_vi: string; earned: boolean }>;
  stars: Record<string, number>;
  speed_items: number;
  score_100: number;
  current_phase: string | null;
}

export const SPEED_BONUS_MS = 3000;
export const PHASE_BASE_COINS = 5;

const BADGE_DEFS: Array<{
  phase: string;
  name_vi: string;
  check: (result: PhaseResultSnapshot) => boolean;
}> = [
  {
    phase: 'story_discovery',
    name_vi: 'Nhà thám hiểm',
    check: (r) => r.total > 0 && (r.correct / r.total) >= 0.8,
  },
  {
    phase: 'vocab_blitz',
    name_vi: 'Phù thủy chữ',
    check: (r) => r.correct >= 5 && r.total >= 6,
  },
  {
    phase: 'sentence_builder',
    name_vi: 'Kiến trúc sư',
    check: (r) => r.total > 0 && r.perfect === true,
  },
  {
    phase: 'story_detective',
    name_vi: 'Thám tử Vàng',
    check: (r) => r.total > 0 && r.correct === r.total,
  },
  {
    phase: 'listen_and_fill',
    name_vi: 'Tai Thần',
    check: (r) => r.total >= 5 && r.first_try_count >= 5,
  },
  {
    phase: 'echo_challenge',
    name_vi: 'Giọng ca Vàng',
    check: (r) => r.total > 0 && (r.avg_score ?? 0) >= 80,
  },
  {
    phase: 'speed_round',
    name_vi: 'Tia Chớp',
    check: (r) => r.correct >= 8 && r.total >= 10,
  },
];

interface PhaseResultSnapshot {
  correct: number;
  total: number;
  perfect?: boolean;
  first_try_count?: number;
  avg_score?: number;
}

export function comboVisualLevel(combo: number): ComboLevel {
  if (combo >= 8) return 'rainbow';
  if (combo >= 5) return 'lightning';
  if (combo >= 3) return 'fire';
  return 'normal';
}

function starsFromPercent(percent: number): number {
  if (percent >= 90) return 3;
  if (percent >= 70) return 2;
  if (percent >= 50) return 1;
  return 0;
}

function comboBonus(comboMax: number): number {
  if (comboMax >= 8) return 15;
  if (comboMax >= 5) return 10;
  if (comboMax >= 3) return 5;
  return 0;
}

function initialBadges(): GameState['badges'] {
  return BADGE_DEFS.map(({ phase, name_vi }) => ({ phase, name_vi, earned: false }));
}

export function createGameState(): GameState {
  return {
    combo: { current: 0, max: 0, phase_max: {} },
    coins: { base: 0, combo_bonus: 0, speed_bonus: 0, total: 0 },
    badges: initialBadges(),
    stars: {},
    speed_items: 0,
    score_100: 0,
    current_phase: null,
  };
}

export function recordAnswer(
  state: GameState,
  phase: string,
  correct: boolean,
  time_ms: number,
): GameState {
  const next = structuredClone(state);
  next.current_phase = phase;

  if (correct) {
    next.combo.current += 1;
    next.combo.max = Math.max(next.combo.max, next.combo.current);
    const phaseMax = next.combo.phase_max[phase] ?? 0;
    next.combo.phase_max[phase] = Math.max(phaseMax, next.combo.current);
  } else {
    next.combo.current = 0;
  }

  if (correct && time_ms > 0 && time_ms < SPEED_BONUS_MS) {
    next.speed_items += 1;
  }

  return next;
}

function phaseSnapshot(phase: string, result: Record<string, unknown> | null): PhaseResultSnapshot {
  if (!result) return { correct: 0, total: 0 };

  if (phase === 'story_detective' && Array.isArray(result.questions)) {
    const total = result.questions.length;
    const correct = result.questions.filter((q) => (q as { correct?: boolean })?.correct === true).length;
    return { correct, total };
  }

  if (phase === 'echo_challenge' && Array.isArray(result.items)) {
    const items = result.items as Array<{ scores?: { overall?: number } }>;
    const total = items.length;
    const avg = total
      ? items.reduce((sum, item) => sum + Number(item.scores?.overall || 0), 0) / total
      : 0;
    const correct = items.filter((item) => Number(item.scores?.overall || 0) >= 50).length;
    return { correct, total, avg_score: avg };
  }

  if (phase === 'sentence_builder' && Array.isArray(result.items)) {
    const items = result.items as Array<{ correct?: boolean; attempts?: number }>;
    const total = items.length;
    const correct = items.filter((item) => item.correct === true).length;
    const perfect = total > 0 && items.every((item) => item.correct === true && (item.attempts ?? 1) === 1);
    return { correct, total, perfect };
  }

  if (phase === 'listen_and_fill' && Array.isArray(result.items)) {
    const items = result.items as Array<{ correct?: boolean; first_try?: boolean }>;
    const total = items.length;
    const correct = items.filter((item) => item.correct === true).length;
    const first_try_count = items.filter((item) => item.first_try === true).length;
    return { correct, total, first_try_count };
  }

  if (Array.isArray(result.items)) {
    const items = result.items as Array<{ correct?: boolean }>;
    const total = items.length;
    const correct = items.filter((item) => item.correct === true).length;
    return { correct, total };
  }

  return {
    correct: Number(result.correct_count) || 0,
    total: Number(result.total_count) || 0,
  };
}

export function endPhase(
  state: GameState,
  phase: string,
  result: Record<string, unknown> | null = null,
): GameState {
  const next = structuredClone(state);
  const snapshot = phaseSnapshot(phase, result);
  const percent = snapshot.total > 0 ? (snapshot.correct / snapshot.total) * 100 : 0;
  next.stars[phase] = starsFromPercent(percent);

  const phaseComboMax = next.combo.phase_max[phase] ?? next.combo.max;
  const phaseSpeed = Array.isArray(result?.items)
    ? (result.items as Array<{ time_ms?: number }>).filter(
        (item) => Number(item.time_ms) > 0 && Number(item.time_ms) < SPEED_BONUS_MS,
      ).length
    : 0;

  const phaseCoins = PHASE_BASE_COINS + comboBonus(phaseComboMax) + phaseSpeed * 2;
  next.coins.base += PHASE_BASE_COINS;
  next.coins.combo_bonus += comboBonus(phaseComboMax);
  next.coins.speed_bonus += phaseSpeed * 2;
  next.coins.total += phaseCoins;

  const badgeDef = BADGE_DEFS.find((b) => b.phase === phase);
  if (badgeDef && badgeDef.check(snapshot)) {
    next.badges = next.badges.map((badge) => (
      badge.phase === phase ? { ...badge, earned: true } : badge
    ));
  }

  next.combo.current = 0;
  next.score_100 = calculateOverallScoreFromStars(next.stars);
  return next;
}

export function calculateOverallScoreFromStars(stars: Record<string, number>): number {
  const totalStars = Object.values(stars).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return Math.round((totalStars / 21) * 100);
}

export function calculateReward(
  state: GameState,
  rng: () => number = Math.random,
): { coins: number; xp: number; chest_tier: ChestTier; chest_coins: number } {
  const totalStars = Object.values(state.stars).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const xp = totalStars * 10;
  const chest = rollChestTier(rng);
  const lessonCoins = state.coins.total;
  return {
    coins: lessonCoins + chest.coins,
    xp,
    chest_tier: chest.tier,
    chest_coins: chest.coins,
  };
}

export function rollChestTier(rng: () => number = Math.random): { tier: ChestTier; coins: number } {
  const roll = rng();
  if (roll < 0.05) return { tier: 'epic', coins: 50 };
  if (roll < 0.30) return { tier: 'rare', coins: 15 };
  return { tier: 'common', coins: 5 };
}

/** Reset combo between phases (e.g. explicit phase boundary). */
export function resetPhaseCombo(state: GameState): GameState {
  const next = structuredClone(state);
  next.combo.current = 0;
  return next;
}
