/** Pure lesson scoring helpers — W1 outcome points, legacy parity, V2.1 stars. */

export const PASS_THRESHOLD_PERCENT = 50;

export const V21_PHASE_COUNT = 7;
export const V21_MAX_STARS = V21_PHASE_COUNT * 3;
export const SPEED_BONUS_MS = 3000;

const OUTCOME_POINTS = {
  first_try: 1,
  second_try: 0.5,
  revealed: 0,
};

const POINT_TRACKED_TYPES = new Set(['listening_fill_blank', 'reading_comprehension', 'listen_and_fill', 'story_detective']);

const V20_TO_V21_TYPE = {
  listen_and_order: 'sentence_builder',
  reading_comprehension: 'story_detective',
  listening_fill_blank: 'listen_and_fill',
  listen_and_speak: 'echo_challenge',
};

const V21_ACTIVITY_TYPES = new Set([
  'story_discovery',
  'vocab_blitz',
  'sentence_builder',
  'story_detective',
  'listen_and_fill',
  'echo_challenge',
  'speed_round',
]);

/**
 * @param {'first_try'|'second_try'|'revealed'|string} outcome
 * @returns {number}
 */
export function questionPoints(outcome) {
  return OUTCOME_POINTS[outcome] ?? 0;
}

export function isPackSchemaV21(schemaVersion) {
  return String(schemaVersion ?? '') === '2.1';
}

export function resolveActivityType(type, schemaVersion) {
  const raw = String(type || '').trim();
  if (!raw) return '';
  if (isPackSchemaV21(schemaVersion)) return raw;
  return V20_TO_V21_TYPE[raw] || raw;
}

function starsFromPercent(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return 0;
  if (p >= 90) return 3;
  if (p >= 70) return 2;
  if (p >= 50) return 1;
  return 0;
}

function countCorrectTotal(result) {
  if (!result || typeof result !== 'object') return { correct: 0, total: 0 };

  const type = String(result.type || '');
  if (type === 'story_detective' && Array.isArray(result.questions)) {
    const total = result.questions.length;
    const correct = result.questions.filter((q) => q?.correct === true).length;
    return { correct, total };
  }

  if (type === 'echo_challenge' && Array.isArray(result.items)) {
    const scored = result.items.filter((item) => item?.scores && typeof item.scores === 'object');
    const total = scored.length || result.items.length;
    if (!scored.length) {
      return {
        correct: Number(result.correct_count || 0),
        total: Number(result.total_count || result.items.length || 0),
      };
    }
    const sum = scored.reduce((acc, item) => acc + Number(item.scores.overall || 0), 0);
    const avg = total > 0 ? sum / total : 0;
    return { correct: avg, total: 100 };
  }

  if (Array.isArray(result.items)) {
    const total = result.items.length;
    const correct = result.items.filter((item) => item?.correct === true).length;
    return { correct, total };
  }

  const total = Number(result.total_count || 0);
  const correct = Math.min(total, Number(result.correct_count || 0));
  return { correct, total };
}

function itemsUnder3s(result) {
  if (!result || !Array.isArray(result.items)) return 0;
  return result.items.filter((item) => {
    const ms = Number(item?.time_ms);
    return Number.isFinite(ms) && ms > 0 && ms < SPEED_BONUS_MS;
  }).length;
}

function comboBonus(comboMax) {
  const combo = Number(comboMax) || 0;
  if (combo >= 8) return 15;
  if (combo >= 5) return 10;
  if (combo >= 3) return 5;
  return 0;
}

/**
 * @param {string} type
 * @param {Record<string, unknown>} result
 * @returns {number} 0-3 stars
 */
export function calculatePhaseStars(type, result) {
  const resolved = resolveActivityType(type, '2.1');
  if (resolved === 'echo_challenge') {
    const { correct, total } = countCorrectTotal({ ...result, type: resolved });
    if (total === 100) return starsFromPercent(correct);
  }
  const { correct, total } = countCorrectTotal({ ...result, type: resolved });
  if (!total) return 0;
  return starsFromPercent((correct / total) * 100);
}

/**
 * @param {Record<string, number>} phaseStars phase → 0-3
 * @returns {number} 0-100
 */
export function calculateOverallScore(phaseStars) {
  const stars = Object.values(phaseStars || {});
  const totalStars = stars.reduce((sum, value) => sum + (Number(value) || 0), 0);
  return Math.round((totalStars / V21_MAX_STARS) * 100);
}

/**
 * @param {Array<Record<string, unknown>>} phaseResults
 * @returns {{ base: number, combo_bonus: number, speed_bonus: number, total: number, phase_coins: Record<string, number> }}
 */
export function calculateCoins(phaseResults) {
  const phaseCoins = {};
  let base = 0;
  let comboBonusTotal = 0;
  let speedBonusTotal = 0;

  for (const entry of phaseResults || []) {
    const type = String(entry?.type || '');
    if (!type) continue;
    const comboMax = Number(entry?.combo_max) || 0;
    const speedItems = itemsUnder3s(entry);
    const phaseBase = 5;
    const phaseCombo = comboBonus(comboMax);
    const phaseSpeed = speedItems * 2;
    phaseCoins[type] = phaseBase + phaseCombo + phaseSpeed;
    base += phaseBase;
    comboBonusTotal += phaseCombo;
    speedBonusTotal += phaseSpeed;
  }

  return {
    base,
    combo_bonus: comboBonusTotal,
    speed_bonus: speedBonusTotal,
    total: base + comboBonusTotal + speedBonusTotal,
    phase_coins: phaseCoins,
  };
}

export function rollChestReward(rng = Math.random) {
  const roll = rng();
  if (roll < 0.05) return { tier: 'epic', coins: 50 };
  if (roll < 0.30) return { tier: 'rare', coins: 15 };
  return { tier: 'common', coins: 5 };
}

/**
 * V2.1 lesson score from activity_results array.
 * @param {Array<Record<string, unknown>>} activityResults
 */
export function calculateV21LessonScore(activityResults) {
  const phaseStars = {};
  let totalStars = 0;

  for (const result of activityResults || []) {
    const type = String(result?.type || '');
    if (!type) continue;
    const stars = calculatePhaseStars(type, result);
    phaseStars[type] = stars;
    totalStars += stars;
  }

  const scorePercent = calculateOverallScore(phaseStars);
  const coinsBreakdown = calculateCoins(activityResults);
  const xp = totalStars * 10;

  return {
    phase_stars: phaseStars,
    total_stars: totalStars,
    score_percent: scorePercent,
    score_label_vi: `Điểm: ${scorePercent}/100`,
    coins: coinsBreakdown,
    xp,
    rank_points: Math.floor(xp / 10),
    correct_count: totalStars,
    total_count: V21_MAX_STARS,
    wrong_count: V21_MAX_STARS - totalStars,
  };
}

/**
 * Legacy score: correct / (total + floor(wrong * 0.5)).
 * @param {Array<{correct_count?: number, total_count?: number, wrong_count?: number}>} activityResults
 */
export function calculateLegacyLessonScore(activityResults) {
  let correct = 0;
  let total = 0;
  let wrong = 0;
  (activityResults || []).forEach((result) => {
    const resultTotal = Number(result?.total_count || 0);
    total += resultTotal;
    correct += Math.min(resultTotal, Number(result?.correct_count || 0));
    wrong += Number(result?.wrong_count || 0);
  });
  const denominator = total + Math.floor(wrong * 0.5);
  return {
    correct_count: correct,
    total_count: total,
    wrong_count: wrong,
    score_percent: denominator > 0 ? Math.round((correct / denominator) * 100) : 0,
  };
}

/**
 * W1 score: point-tracked activities use question_outcomes; others keep legacy contribution.
 * @param {Array<Record<string, unknown>>} activityResults
 * @param {{ w1?: boolean }} [options]
 */
export function calculateLessonScore(activityResults, options = {}) {
  if (options.schemaVersion && isPackSchemaV21(options.schemaVersion)) {
    return calculateV21LessonScore(activityResults);
  }
  if (!options.w1) {
    return calculateLegacyLessonScore(activityResults);
  }

  let correct = 0;
  let total = 0;
  let wrong = 0;
  let pointsEarned = 0;
  let pointsPossible = 0;

  (activityResults || []).forEach((result) => {
    const type = result?.type;
    const outcomes = Array.isArray(result?.question_outcomes) ? result.question_outcomes : null;

    if (type && POINT_TRACKED_TYPES.has(type) && outcomes && outcomes.length > 0) {
      outcomes.forEach((entry) => {
        pointsPossible += 1;
        const pts = questionPoints(entry?.outcome);
        pointsEarned += pts;
        if (entry?.outcome === 'first_try') correct += 1;
        else if (entry?.outcome === 'second_try') {
          correct += 0.5;
          wrong += 0.5;
        } else {
          wrong += 1;
        }
        total += 1;
      });
      return;
    }

    const resultTotal = Number(result?.total_count || 0);
    total += resultTotal;
    correct += Math.min(resultTotal, Number(result?.correct_count || 0));
    wrong += Number(result?.wrong_count || 0);
    pointsPossible += resultTotal;
    pointsEarned += Math.min(resultTotal, Number(result?.correct_count || 0));
  });

  const scorePercent = pointsPossible > 0
    ? Math.round((pointsEarned / pointsPossible) * 100)
    : 0;

  return {
    correct_count: Math.round(correct * 2) / 2,
    total_count: total,
    wrong_count: Math.round(wrong * 2) / 2,
    score_percent: scorePercent,
  };
}

export function isV21ActivityType(type) {
  return V21_ACTIVITY_TYPES.has(String(type || ''));
}
