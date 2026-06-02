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

  const lessonContext = currentPack.review_context;
  if (!lessonContext) {
    return json({ ok: false, error: 'missing_context', message: 'Bài này thiếu dữ liệu để chấm trên web.' }, 400);
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
