import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { ensureSixActivities } from './_read2lead-lesson-activities.js';
import {
  applyQuestProgress,
  applyPackCompletion,
  applyPackPenalty,
  awardPendingChest,
  awardRankPoints,
  buildLearningMetricEntry,
  calculateAttentionScore,
  computeRankUp,
  computeSeasonLadder,
  loadProgressState,
  PASS_THRESHOLD_PERCENT,
  recordComboBonus,
  vietnamDateKey,
  XP_PENALTY_BELOW_THRESHOLD,
  XP_PER_PASSED_PACK,
  publicProgressState,
  saveProgressState,
} from './_read2lead-v2-state.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chua cau hinh ma hoc sinh.' }, 500);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Khong doc duoc bai nop.' }, 400);
  }

  if (data.website) {
    return json({ ok: true, message: 'Da ghi nhan.' });
  }

  const accessCode = (data.access_code || '').toString().trim().toUpperCase();
  const packId = (data.pack_id || '').toString().trim();
  const answers = data.answers && typeof data.answers === 'object' ? data.answers : null;
  if (!accessCode || !packId || !answers) {
    return json({ ok: false, error: 'missing_fields', message: 'Thieu ma hoc sinh, ma bai hoac dap an.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Ma hoc sinh khong ton tai.' }, 404);
  }

  const progress = normalizeProgress(codeData);
  const currentPack = progress.current_pack;
  if (!currentPack || currentPack.pack_id !== packId) {
    return json({ ok: false, error: 'pack_not_found', message: 'Khong tim thay bai nay trong ma hoc sinh.' }, 404);
  }

  if (isV2PackReviewed(currentPack)) {
    return respondFromCachedAttempt({
      accessCode,
      codeData,
      currentPack,
      env,
      progress,
      alreadyCompleted: true,
    });
  }

  const lessonContext = extractV2LessonContext(currentPack);
  if (!lessonContext) {
    return json({
      ok: false,
      error: 'legacy_pack_removed',
      message: 'Bai nay la format cu. V2 submit chi nhan pack schema_version = 2.',
    }, 410);
  }

  return submitV2Lesson({
    accessCode,
    codeData,
    currentPack,
    env,
    lessonContext,
    progress,
    submittedAnswers: answers,
    comboXuRequested: data.combo_xu ?? answers.combo_xu,
  });
}

function extractV2LessonContext(pack) {
  const candidates = [
    pack?.review_context,
    pack?.pack,
    pack?.pack_json,
    pack?.result?.pack,
    pack,
  ];
  const context = candidates.find(isV2LessonContext) || null;
  if (!context) return null;
  return {
    ...context,
    activities: ensureSixActivities(context.activities, {
      story: context.story,
      topic: context.topic || '',
      activities: context.activities,
    }),
  };
}

function isV2LessonContext(context) {
  return Boolean(
    context &&
      context.schema_version === 2 &&
      context.story &&
      Array.isArray(context.activities),
  );
}

function isV2PackReviewed(pack) {
  return Boolean(pack && pack.status === 'reviewed_pass_web_v2');
}

const DUPLICATE_SUBMIT_WINDOW_MS = 12000;
export const SPEAKING_PASS_PERCENT = 50;
const SPEAKING_ACTIVITY_TYPES = new Set(['listen_and_speak', 'retell_summary']);

function isRecentDuplicateSubmit(currentPack) {
  const last = currentPack?.web_lesson_summary;
  if (!last?.submitted_at) return false;
  const ageMs = Date.now() - Date.parse(last.submitted_at);
  return ageMs >= 0 && ageMs < DUPLICATE_SUBMIT_WINDOW_MS;
}

function hasPassingWebAttempt(currentPack) {
  return (Array.isArray(currentPack?.web_attempts) ? currentPack.web_attempts : [])
    .some((attempt) => attempt?.passed === true);
}

async function submitV2Lesson({
  accessCode,
  codeData,
  currentPack,
  env,
  lessonContext,
  progress,
  submittedAnswers,
  comboXuRequested,
}) {
  if (hasPassingWebAttempt(currentPack)) {
    return respondFromCachedAttempt({
      accessCode,
      codeData,
      currentPack,
      env,
      progress,
      alreadyCompleted: true,
    });
  }

  if (isRecentDuplicateSubmit(currentPack)) {
    return respondFromCachedAttempt({
      accessCode,
      codeData,
      currentPack,
      env,
      progress,
    });
  }

  const submittedAt = new Date().toISOString();
  const activityResults = Array.isArray(submittedAnswers.activity_results)
    ? submittedAnswers.activity_results
    : [];
  const expectedTypes = (Array.isArray(lessonContext.activities) ? lessonContext.activities : [])
    .map((activity) => activity?.type)
    .filter(Boolean);
  const completedTypes = new Set(
    activityResults
      .filter((result) => result && result.attempted !== false)
      .map((result) => result.type)
      .filter(Boolean),
  );
  const score = scoreActivityResults(activityResults, lessonContext);
  const totalCount = score.total_count || expectedTypes.length || 6;
  const correctCount = score.correct_count;
  const allActivitiesAttempted = expectedTypes.length > 0
    ? expectedTypes.every((type) => completedTypes.has(type))
    : completedTypes.size >= 6;
  const scorePercent = score.score_percent;
  const speakingGate = evaluateSpeakingGate(activityResults, expectedTypes);
  const completedWithoutReward = allActivitiesAttempted && speakingGate.skipped;
  const passed = allActivitiesAttempted
    && speakingGate.passed
    && scorePercent >= PASS_THRESHOLD_PERCENT;
  const rewards = lessonContext.rewards || {
    coins_on_complete: 15,
    xp_on_complete: XP_PER_PASSED_PACK,
    bonus_coins_per_activity_attempted: 2,
  };
  const rewardsEarned = passed
    ? {
        coins:
          numberOrZero(rewards.coins_on_complete) +
          correctCount * numberOrZero(rewards.bonus_coins_per_activity_attempted),
        xp: XP_PER_PASSED_PACK,
      }
    : { coins: 0, xp: -XP_PENALTY_BELOW_THRESHOLD };
  const attempt = {
    schema_version: 2,
    submitted_at: submittedAt,
    passed,
    completed: passed || completedWithoutReward,
    completed_without_reward: completedWithoutReward,
    score_percent: scorePercent,
    correct_count: correctCount,
    total_count: totalCount,
    activity_results: activityResults,
    rewards_earned: rewardsEarned,
  };
  const learningMetric = passed
    ? buildSubmitLearningMetric({
        currentPack,
        submittedAnswers,
        submittedAt,
        scorePercent,
      })
    : null;
  if (learningMetric) attempt.learning_metric = learningMetric;
  const webAttempts = [
    ...(Array.isArray(currentPack.web_attempts) ? currentPack.web_attempts : []),
    attempt,
  ].slice(-5);

  if (completedWithoutReward) {
    return finalizeWithoutReward({
      accessCode,
      codeData,
      currentPack,
      env,
      progress,
      attempt,
      webAttempts,
      submittedAt,
      scorePercent,
      correctCount,
      totalCount,
    });
  }

  if (!passed) {
    const progressState = await loadProgressState(env, accessCode, codeData);
    const penaltyResult = applyPackPenalty(progressState, {
      packId: currentPack.pack_id,
      completedAt: submittedAt,
      penaltyXp: XP_PENALTY_BELOW_THRESHOLD,
    });
    const savedProgressState = await saveProgressState(env, accessCode, penaltyResult.state);
    const updatedPack = {
      ...currentPack,
      web_attempts: webAttempts,
      web_lesson_summary: attempt,
    };
    const nextProgress = {
      ...progress,
      current_pack: updatedPack,
    };
    await env.READ2LEAD_CODES.put(accessCode, JSON.stringify({ ...codeData, progress: nextProgress }));

    return json({
      ok: true,
      schema_version: 2,
      passed: false,
      score_percent: scorePercent,
      correct_count: correctCount,
      total_count: totalCount,
      rewards_earned: rewardsEarned,
      message: `Chua dat ${PASS_THRESHOLD_PERCENT}%. Khong sao, minh thu lai nhe!`,
      read2lead_state: publicProgressState(savedProgressState),
      penalty_already_counted: penaltyResult.already_penalized,
      progress: publicProgress(nextProgress),
      current_pack: publicPack(updatedPack),
      next_pack_unlocked: false,
    });
  }

  const progressState = await loadProgressState(env, accessCode, codeData);
  const rankLadderBefore = computeSeasonLadder(progressState);
  const stateResult = applyPackCompletion(progressState, {
    packId: currentPack.pack_id,
    completedAt: submittedAt,
    rewardsEarned,
    activityResults,
    scorePercent,
    learningMetric,
  });
  const rankAward = stateResult.already_counted
    ? { state: stateResult.state, awarded: 0 }
    : awardRankPoints(stateResult.state, {
      scorePercent,
      dateKey: vietnamDateKey(submittedAt),
      nowIso: submittedAt,
    });
  let nextProgressState = rankAward.state;
  if (!stateResult.already_counted) {
    // === V4 W2 hooks ===
    const w2DateKey = vietnamDateKey(submittedAt);
    const hasSpeakActivity = activityResults.some(
      (result) => result?.type === 'listen_and_speak' || result?.type === 'retell_summary',
    );
    nextProgressState = applyQuestProgress(
      nextProgressState,
      'pack_passed',
      { score: scorePercent, has_speak: hasSpeakActivity },
      w2DateKey,
      accessCode,
    );
    if (scorePercent >= 80) {
      nextProgressState = applyQuestProgress(
        nextProgressState,
        'pack_passed_high_score',
        { score: scorePercent },
        w2DateKey,
        accessCode,
      );
    }
    if (hasSpeakActivity) {
      nextProgressState = applyQuestProgress(
        nextProgressState,
        'speak_completed',
        {},
        w2DateKey,
        accessCode,
      );
    }
    const perfectActivity = activityResults.find((result) => {
      const correct = Number(result?.correct_count);
      const total = Number(result?.total_count);
      return result?.percent === 100
        || result?.score === 1
        || (total > 0 && correct === total && numberOrZero(result?.wrong_count) === 0);
    });
    if (perfectActivity) {
      nextProgressState = applyQuestProgress(
        nextProgressState,
        'activity_perfect',
        { activity_key: perfectActivity.key || perfectActivity.type },
        w2DateKey,
        accessCode,
      );
    }
    if (numberOrZero(nextProgressState.streak_days) >= 3) {
      nextProgressState = applyQuestProgress(
        nextProgressState,
        'streak_day_3',
        { streak: nextProgressState.streak_days },
        w2DateKey,
        accessCode,
      );
    }
    if (numberOrZero(comboXuRequested) > 0) {
      nextProgressState = recordComboBonus(nextProgressState, comboXuRequested);
    }
    const rng = typeof env.RNG === 'function' ? env.RNG : Math.random;
    nextProgressState = awardPendingChest(
      nextProgressState,
      { passed: true, score: scorePercent },
      rng,
    );
    // === end V4 W2 hooks ===
  }
  const savedProgressState = await saveProgressState(env, accessCode, nextProgressState);
  const rankLadderAfter = computeSeasonLadder(savedProgressState);
  const rankUp = computeRankUp(rankLadderBefore, rankLadderAfter);

  const reviewedPack = {
    ...currentPack,
    status: 'reviewed_pass_web_v2',
    reviewed_at: submittedAt,
    web_attempts: webAttempts,
    web_lesson_summary: attempt,
    review_summary: {
      schema_version: 2,
      completed_at: submittedAt,
      score_percent: scorePercent,
      rewards_earned: rewardsEarned,
      activity_results: activityResults,
    },
  };
  const nextReviewHistory = [
    {
      pack_id: reviewedPack.pack_id,
      status: reviewedPack.status,
      title: lessonContext.story?.title || reviewedPack.story_title || '',
      topic: lessonContext.topic || reviewedPack.topic || '',
      level: lessonContext.level || reviewedPack.level || '',
      reviewed_at: submittedAt,
      score_percent: scorePercent,
      schema_version: 2,
    },
    ...(progress.review_history || []),
  ].slice(0, 20);
  const nextProgress = {
    ...progress,
    completed_packs: (progress.completed_packs || 0) + 1,
    weekly_completed_count: nextWeeklyCompletedCount(progress, submittedAt),
    weekly_key: weekKey(submittedAt),
    streak_days: savedProgressState.streak_days,
    last_activity_at: submittedAt,
    last_level_recommendation: 'stay',
    current_pack: reviewedPack,
    review_history: nextReviewHistory,
  };

  await env.READ2LEAD_CODES.put(
    accessCode,
    JSON.stringify({
      ...codeData,
      progress: nextProgress,
      last_reviewed_at: submittedAt,
    }),
  );

  return json({
    ok: true,
    schema_version: 2,
    passed: true,
    score_percent: scorePercent,
    correct_count: correctCount,
    total_count: totalCount,
    rewards_earned: rewardsEarned,
    level_up: stateResult.level_up,
    ...(stateResult.level_gate_hint_vi
      ? { level_gate_hint_vi: stateResult.level_gate_hint_vi }
      : {}),
    rank_up: rankUp,
    read2lead_state: publicProgressState(savedProgressState),
    message: 'Con da hoan thanh nhiem vu V2 hom nay.',
    review: reviewedPack.review_summary,
    progress: publicProgress(nextProgress),
    current_pack: publicPack(reviewedPack),
    next_pack_unlocked: true,
  });
}

export function evaluateSpeakingGate(activityResults, expectedTypes) {
  const expectedSpeakingTypes = expectedTypes.filter((type) => SPEAKING_ACTIVITY_TYPES.has(type));
  if (!expectedSpeakingTypes.length) return { passed: true, skipped: false };
  const resultsByType = new Map(
    activityResults
      .filter((result) => result?.type)
      .map((result) => [result.type, result]),
  );
  const speakingResults = expectedSpeakingTypes.map((type) => resultsByType.get(type));
  const skipped = speakingResults.some((result) => result?.skipped_due_to_mic === true);
  const passed = !skipped && speakingResults.every(
    (result) => result && Number(result.score_percent) >= SPEAKING_PASS_PERCENT,
  );
  return { passed, skipped };
}

function buildSubmitLearningMetric({
  currentPack,
  submittedAnswers,
  submittedAt,
  scorePercent,
}) {
  const raw = submittedAnswers?.learning_metrics && typeof submittedAnswers.learning_metrics === 'object'
    ? submittedAnswers.learning_metrics
    : {};
  const startedAt = raw.started_at || currentPack?.created_at || submittedAt;
  const events = Array.isArray(raw.events) ? raw.events.slice(-80) : [];
  const retryFromAttempts = (Array.isArray(currentPack?.web_attempts) ? currentPack.web_attempts : [])
    .filter((attempt) => attempt?.passed !== true)
    .length;
  const retryFromClient = Math.max(0, Math.floor(Number(raw.retry_count) || 0));
  const retryCount = Math.max(retryFromAttempts, retryFromClient);
  const attentionScore = raw.attention_score != null
    ? raw.attention_score
    : calculateAttentionScore({
        startedAt,
        endedAt: submittedAt,
        events,
      });

  return buildLearningMetricEntry({
    packId: currentPack?.pack_id,
    startedAt,
    passedAt: submittedAt,
    scorePercent,
    retryCount,
    attentionScore,
  });
}

async function finalizeWithoutReward({
  accessCode,
  codeData,
  currentPack,
  env,
  progress,
  attempt,
  webAttempts,
  submittedAt,
  scorePercent,
  correctCount,
  totalCount,
}) {
  const progressState = await loadProgressState(env, accessCode, codeData);
  const rewardsEarned = { coins: 0, xp: 0 };
  const reviewedPack = {
    ...currentPack,
    status: 'reviewed_pass_web_v2',
    reviewed_at: submittedAt,
    web_attempts: webAttempts,
    web_lesson_summary: attempt,
    review_summary: {
      schema_version: 2,
      completed_at: submittedAt,
      passed: false,
      completed_without_reward: true,
      score_percent: scorePercent,
      rewards_earned: rewardsEarned,
      activity_results: attempt.activity_results,
    },
  };
  const nextProgress = {
    ...progress,
    current_pack: reviewedPack,
  };

  await env.READ2LEAD_CODES.put(
    accessCode,
    JSON.stringify({
      ...codeData,
      progress: nextProgress,
    }),
  );

  return json({
    ok: true,
    schema_version: 2,
    completed: true,
    completed_without_reward: true,
    passed: false,
    score_percent: scorePercent,
    correct_count: correctCount,
    total_count: totalCount,
    rewards_earned: rewardsEarned,
    read2lead_state: publicProgressState(progressState),
    message: 'Bai da ket thuc khong thuong. Con co the tao bai moi.',
    review: reviewedPack.review_summary,
    progress: publicProgress(nextProgress),
    current_pack: publicPack(reviewedPack),
    next_pack_unlocked: true,
  });
}

async function respondFromCachedAttempt({
  accessCode,
  codeData,
  currentPack,
  env,
  progress,
  alreadyCompleted = false,
}) {
  const attempt = currentPack.web_lesson_summary
    || (Array.isArray(currentPack.web_attempts)
      ? [...currentPack.web_attempts].reverse().find((entry) => entry?.passed === true)
      : null)
    || currentPack.review_summary
    || null;
  const passed = attempt ? Boolean(attempt.passed) : alreadyCompleted;
  const completedWithoutReward = attempt?.completed_without_reward === true;
  const completed = passed || completedWithoutReward;
  const progressState = await loadProgressState(env, accessCode, codeData);

  return json({
    ok: true,
    schema_version: 2,
    ...(alreadyCompleted ? { already_completed: true } : { duplicate: true }),
    completed,
    completed_without_reward: completedWithoutReward,
    passed,
    score_percent: attempt?.score_percent ?? null,
    correct_count: attempt?.correct_count ?? null,
    total_count: attempt?.total_count ?? null,
    rewards_earned: attempt?.rewards_earned || { coins: 0, xp: 0 },
    message: passed
      ? 'Con da hoan thanh nhiem vu V2 hom nay.'
      : completedWithoutReward
        ? 'Bai da ket thuc khong thuong. Con co the tao bai moi.'
        : `Chua dat ${PASS_THRESHOLD_PERCENT}%. Khong sao, minh thu lai nhe!`,
    read2lead_state: publicProgressState(progressState),
    progress: publicProgress(progress),
    current_pack: publicPack(currentPack),
    next_pack_unlocked: completed,
    review: completed ? (currentPack.review_summary || attempt || null) : null,
  });
}

function scoreActivityResults(activityResults, lessonContext) {
  const expectedActivities = Array.isArray(lessonContext.activities) ? lessonContext.activities : [];
  const resultsByType = new Map(
    (Array.isArray(activityResults) ? activityResults : [])
      .filter((result) => result?.type)
      .map((result) => [result.type, result]),
  );
  let correct = 0;
  let total = 0;
  let wrong = 0;

  for (const activity of expectedActivities) {
    const result = resultsByType.get(activity?.type);
    const fallbackTotal = activityItemCount(activity);
    const resultTotal = numberOrZero(result?.total_count) || fallbackTotal;
    total += resultTotal;
    correct += Math.min(resultTotal, numberOrZero(result?.correct_count));
    wrong += numberOrZero(result?.wrong_count);
  }

  if (!expectedActivities.length) {
    for (const result of resultsByType.values()) {
      const resultTotal = numberOrZero(result?.total_count);
      total += resultTotal;
      correct += Math.min(resultTotal, numberOrZero(result?.correct_count));
      wrong += numberOrZero(result?.wrong_count);
    }
  }

  const denominator = total + Math.floor(wrong * 0.5);
  const scorePercent = denominator > 0 ? Math.round((correct / denominator) * 100) : 0;
  return {
    correct_count: correct,
    total_count: total,
    wrong_count: wrong,
    score_percent: scorePercent,
  };
}

function activityItemCount(activity) {
  if (!activity || typeof activity !== 'object') return 0;
  if (Array.isArray(activity.questions)) return activity.questions.length;
  if (Array.isArray(activity.items)) return activity.items.length;
  return 0;
}

function normalizeProgress(codeData) {
  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  return {
    student_name: profile.student_name || progress.student_name || '',
    age: profile.age || progress.age || null,
    current_level: progress.current_level || profile.level || 'L1',
    packs_created: progress.packs_created || 0,
    completed_packs: progress.completed_packs || reviewHistory.length || 0,
    weekly_completed_count: progress.weekly_completed_count || 0,
    weekly_key: progress.weekly_key || '',
    streak_days: progress.streak_days || 0,
    last_activity_at: progress.last_activity_at || codeData.last_reviewed_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: progress.current_pack || null,
    review_history: reviewHistory,
  };
}

function publicPack(pack) {
  if (!pack) return null;
  return {
    pack_id: pack.pack_id,
    status: pack.status,
    topic: pack.topic,
    story_title: pack.story_title,
    level: pack.level,
    schema_version: pack.schema_version || pack.review_context?.schema_version || null,
    reviewed_at: pack.reviewed_at,
    web_lesson_steps: pack.web_lesson_steps || null,
  };
}

function publicProgress(progress) {
  return {
    student_name: progress.student_name,
    age: progress.age,
    current_level: progress.current_level,
    packs_created: progress.packs_created || 0,
    completed_packs: progress.completed_packs || 0,
    weekly_completed_count: progress.weekly_completed_count || 0,
    streak_days: progress.streak_days || 0,
    last_activity_at: progress.last_activity_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: publicPack(progress.current_pack),
  };
}

function nextWeeklyCompletedCount(progress, iso) {
  const key = weekKey(iso);
  return progress.weekly_key === key ? (progress.weekly_completed_count || 0) + 1 : 1;
}

function nextStreakDays(lastActivityAt, submittedAt, currentStreak = 0) {
  if (!lastActivityAt) return 1;
  const last = new Date(lastActivityAt);
  const now = new Date(submittedAt);
  if (Number.isNaN(last.getTime()) || Number.isNaN(now.getTime())) return 1;
  const lastKey = last.toISOString().slice(0, 10);
  const nowKey = now.toISOString().slice(0, 10);
  if (lastKey === nowKey) return Math.max(1, currentStreak || 0);
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.abs(Date.parse(nowKey) - Date.parse(lastKey)) <= oneDayMs
    ? (currentStreak || 0) + 1
    : 1;
}

function weekKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
