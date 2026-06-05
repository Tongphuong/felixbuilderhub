import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import {
  badgesForStars,
  buildWebReviewSummary,
  gradeLessonSubmission,
  isPackReviewed,
  nextStreakDays,
  nextWeeklyCompletedCount,
  normalizeProgress,
  publicPack,
  publicProgress,
  rankForStars,
  reviewHistoryItem,
} from './_read2lead-lesson.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chưa cấu hình mã học sinh.' }, 500);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Không đọc được bài nộp.' }, 400);
  }

  if (data.website) {
    return json({ ok: true, message: 'Đã ghi nhận.' });
  }

  const accessCode = (data.access_code || '').toString().trim().toUpperCase();
  const packId = (data.pack_id || '').toString().trim();
  const answers = data.answers && typeof data.answers === 'object' ? data.answers : null;
  if (!accessCode || !packId || !answers) {
    return json({ ok: false, error: 'missing_fields', message: 'Thiếu mã học sinh, mã bài hoặc đáp án.' }, 400);
  }

  const stepInput = data.steps && typeof data.steps === 'object' ? data.steps : {};
  const sanitizeIso = (value) => (typeof value === 'string' && value ? value.slice(0, 40) : null);
  const stepStamps = {
    listen_completed_at: sanitizeIso(stepInput.listen_completed_at),
    read_completed_at: sanitizeIso(stepInput.read_completed_at),
  };

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  const progress = normalizeProgress(codeData);
  const currentPack = progress.current_pack;
  if (!currentPack || currentPack.pack_id !== packId) {
    return json({ ok: false, error: 'pack_not_found', message: 'Không tìm thấy bài này trong mã học sinh.' }, 404);
  }

  if (isV2PackReviewed(currentPack)) {
    return json({
      ok: true,
      schema_version: 2,
      already_completed: true,
      passed: true,
      message: 'Bài này đã hoàn thành rồi. Read2Lead giữ kết quả cũ để con không phải làm lại.',
      review: currentPack.review_summary || currentPack.web_lesson_summary || null,
      progress: publicProgress(progress),
      current_pack: publicPack(currentPack),
      next_pack_unlocked: true,
    });
  }

  if (isPackReviewed(currentPack)) {
    return json({
      ok: true,
      already_completed: true,
      passed: true,
      message: 'Bài này đã được hoàn thành rồi. Felixar không cộng sao lần hai.',
      review: currentPack.review_summary || currentPack.web_lesson_summary || null,
      progress: publicProgress(progress),
      current_pack: publicPack(currentPack),
      next_pack_unlocked: true,
    });
  }

  const lessonContext = extractLessonContext(currentPack);
  if (!lessonContext) {
    return json({ ok: false, error: 'missing_context', message: 'Bài này thiếu dữ liệu để chấm trên web.' }, 400);
  }

  if (isV2LessonContext(lessonContext)) {
    return submitV2Lesson({
      accessCode,
      codeData,
      currentPack,
      env,
      lessonContext,
      progress,
      submittedAnswers: answers,
    });
  }

  const grading = gradeLessonSubmission(lessonContext, answers);
  const submittedAt = new Date().toISOString();
  const attempt = {
    submitted_at: submittedAt,
    passed: grading.passed,
    score_percent: grading.score_percent,
    correct_count: grading.correct_count,
    total_count: grading.total_count,
    sections: grading.sections,
    open_answers: grading.open_answers,
  };
  const webAttempts = [
    ...(Array.isArray(currentPack.web_attempts) ? currentPack.web_attempts : []),
    attempt,
  ].slice(-5);

  if (!grading.passed) {
    const updatedPack = {
      ...currentPack,
      web_attempts: webAttempts,
      web_lesson_summary: attempt,
      web_lesson_steps: {
        ...stepStamps,
        lesson_completed_at: null,
      },
    };
    const nextProgress = {
      ...progress,
      current_pack: updatedPack,
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
      passed: false,
      score_percent: grading.score_percent,
      correct_count: grading.correct_count,
      total_count: grading.total_count,
      sections: grading.sections,
      message: 'Con chưa qua bài này. Bố mẹ cho con xem lại rồi làm lại nhé.',
      progress: publicProgress(nextProgress),
      current_pack: publicPack(updatedPack),
      next_pack_unlocked: false,
    });
  }

  const oldStars = progress.stars || 0;
  const nextStars = oldStars + 1;
  const reviewSummary = buildWebReviewSummary({ grading, context: lessonContext, completedAt: submittedAt });
  const reviewedPack = {
    ...currentPack,
    status: 'reviewed_pass_web',
    reviewed_at: submittedAt,
    web_attempts: webAttempts,
    web_lesson_summary: attempt,
    web_lesson_steps: {
      ...stepStamps,
      lesson_completed_at: submittedAt,
    },
    review_summary: reviewSummary,
  };
  const nextReviewHistory = [
    reviewHistoryItem(reviewedPack),
    ...(progress.review_history || []),
  ].slice(0, 20);
  const nextProgress = {
    ...progress,
    stars: nextStars,
    rank: rankForStars(nextStars),
    badges: badgesForStars(nextStars),
    completed_packs: (progress.completed_packs || 0) + 1,
    weekly_completed_count: nextWeeklyCompletedCount(progress, submittedAt),
    weekly_key: weekKey(submittedAt),
    streak_days: nextStreakDays(progress.last_activity_at, submittedAt, progress.streak_days),
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
      student_profile: {
        ...(codeData.student_profile || {}),
        student_name: progress.student_name,
        age: progress.age,
        level: nextProgress.current_level,
        child_gender: progress.child_gender,
      },
      last_reviewed_at: submittedAt,
    }),
  );

  return json({
    ok: true,
    passed: true,
    star_awarded: true,
    score_percent: grading.score_percent,
    correct_count: grading.correct_count,
    total_count: grading.total_count,
    sections: grading.sections,
    message: 'Con đã hoàn thành bài này và được cộng 1 sao.',
    review: reviewSummary,
    progress: publicProgress(nextProgress),
    current_pack: publicPack(reviewedPack),
    next_pack_unlocked: true,
  });
}

function extractLessonContext(pack) {
  const candidates = [
    pack?.review_context,
    pack?.pack,
    pack?.pack_json,
    pack?.result?.pack,
  ];

  const nestedContext = candidates.find((candidate) => candidate && typeof candidate === 'object');
  if (nestedContext) return nestedContext;
  return isV2LessonContext(pack) ? pack : null;
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

async function submitV2Lesson({
  accessCode,
  codeData,
  currentPack,
  env,
  lessonContext,
  progress,
  submittedAnswers,
}) {
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
  const totalCount = expectedTypes.length || 4;
  const correctCount = expectedTypes.filter((type) => completedTypes.has(type)).length;
  const scorePercent = Math.round((correctCount / totalCount) * 100);
  const passed = correctCount === totalCount;
  const rewards = lessonContext.rewards || {
    coins_on_complete: 15,
    xp_on_complete: 20,
    bonus_coins_per_activity_attempted: 2,
  };
  const rewardsEarned = passed
    ? {
        coins:
          numberOrZero(rewards.coins_on_complete) +
          correctCount * numberOrZero(rewards.bonus_coins_per_activity_attempted),
        xp: numberOrZero(rewards.xp_on_complete),
      }
    : { coins: 0, xp: 0 };
  const attempt = {
    schema_version: 2,
    submitted_at: submittedAt,
    passed,
    score_percent: scorePercent,
    correct_count: correctCount,
    total_count: totalCount,
    activity_results: activityResults,
    rewards_earned: rewardsEarned,
  };
  const webAttempts = [
    ...(Array.isArray(currentPack.web_attempts) ? currentPack.web_attempts : []),
    attempt,
  ].slice(-5);

  if (!passed) {
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
      message: 'Con còn một mảnh nhiệm vụ chưa chạm tới. Mình quay lại hoàn thành nốt nhé.',
      progress: publicProgress(nextProgress),
      current_pack: publicPack(updatedPack),
      next_pack_unlocked: false,
    });
  }

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
    streak_days: nextStreakDays(progress.last_activity_at, submittedAt, progress.streak_days),
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
    message: 'Con đã hoàn thành nhiệm vụ V2 hôm nay.',
    review: reviewedPack.review_summary,
    progress: publicProgress(nextProgress),
    current_pack: publicPack(reviewedPack),
    next_pack_unlocked: true,
  });
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
