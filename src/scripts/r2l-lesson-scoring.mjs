/** Pure lesson scoring helpers — W1 outcome points + legacy parity. */

export const PASS_THRESHOLD_PERCENT = 50;

const OUTCOME_POINTS = {
  first_try: 1,
  second_try: 0.5,
  revealed: 0,
};

const POINT_TRACKED_TYPES = new Set(['listening_fill_blank', 'reading_comprehension', 'guided_listening']);

/**
 * @param {'first_try'|'second_try'|'revealed'|string} outcome
 * @returns {number}
 */
export function questionPoints(outcome) {
  return OUTCOME_POINTS[outcome] ?? 0;
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
