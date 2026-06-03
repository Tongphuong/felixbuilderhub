import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }

  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').trim().toUpperCase();
  if (!code) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng nhập mã học sinh.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  let codeData = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  // Self-heal stale generation_in_progress: if Render finished but the user
  // never re-opened the "đang tạo" page (so check-generation-status never
  // promoted the pack), Felixar dashboard would stay stuck "Đang tạo bài"
  // forever. Reconcile by reading task state KV directly here.
  codeData = await reconcileGenerationState(env.READ2LEAD_CODES, code, codeData);

  const progress = normalizeProgress(codeData);
  const requireReviewBeforeNextPack = shouldRequireReviewBeforeNextPack(codeData);
  const nextPackLocked = currentPackBlocksGeneration(progress.current_pack, requireReviewBeforeNextPack);
  const state = dashboardState(progress.current_pack);

  return json({
    ok: true,
    state,
    state_label: stateLabel(state),
    primary_action: primaryAction(state, code, nextPackLocked),
    progress: publicProgress(progress),
    next_pack_locked: nextPackLocked,
    review_link: `/read2lead/review?code=${encodeURIComponent(code)}`,
    last_review_summary: lastReviewSummary(progress.current_pack, progress.review_history),
    weekly_completed_count: progress.weekly_completed_count,
    streak_days: progress.streak_days,
    last_level_recommendation: progress.last_level_recommendation,
    is_test: codeData.is_test === true,
    is_shared: codeData.is_shared === true,
  });
}

function normalizeProgress(codeData) {
  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const stars = Number.isFinite(progress.stars) ? progress.stars : 0;
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  const completedPacks = numberOrZero(progress.completed_packs) || reviewHistory.length;

  return {
    student_name: profile.student_name || progress.student_name || '',
    age: profile.age || progress.age || null,
    current_level: progress.current_level || profile.level || 'L2',
    stars,
    rank: progress.rank || rankForStars(stars),
    badges: Array.isArray(progress.badges) ? progress.badges : badgesForStars(stars),
    packs_created: numberOrZero(progress.packs_created),
    completed_packs: completedPacks,
    weekly_completed_count: numberOrZero(progress.weekly_completed_count),
    streak_days: numberOrZero(progress.streak_days),
    last_activity_at: progress.last_activity_at || codeData.last_reviewed_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: progress.current_pack || null,
    review_history: reviewHistory,
  };
}

function dashboardState(pack) {
  if (!pack) return 'no_pack';
  if (pack.status === 'generation_in_progress') return 'generation_in_progress';
  if (isPackReviewed(pack)) return 'reviewed';
  return 'awaiting_review';
}

function stateLabel(state) {
  return {
    no_pack: 'Chưa có bài',
    generation_in_progress: 'Đang tạo bài',
    awaiting_review: 'Chờ nộp bài',
    reviewed: 'Đã nhận xét',
  }[state] || 'Đang kiểm tra';
}

function primaryAction(state, code, nextPackLocked) {
  if (state === 'generation_in_progress') {
    return { type: 'wait', label: 'Đang tạo bài', href: null };
  }
  if (state === 'awaiting_review' && nextPackLocked) {
    return { type: 'submit_review', label: 'Nộp bài hiện tại', href: `/read2lead/review?code=${encodeURIComponent(code)}#submit` };
  }
  if (state === 'awaiting_review') {
    return { type: 'create_pack', label: 'Tạo thêm bài mới', href: '/read2lead#form' };
  }
  if (state === 'reviewed') {
    return { type: 'create_next', label: 'Tạo bài tiếp theo', href: '/read2lead#form' };
  }
  return { type: 'create_first', label: 'Tạo bài đầu tiên', href: '/read2lead#form' };
}

function isPackReviewed(pack) {
  return ['reviewed_pass', 'reviewed_retry', 'reviewed_pass_web', 'reviewed_retry_web'].includes(pack.status);
}

function shouldRequireReviewBeforeNextPack(codeData) {
  return !(codeData.is_test === true || codeData.is_shared === true);
}

function currentPackBlocksGeneration(pack, requireReviewBeforeNextPack = true) {
  if (!pack) return false;
  if (pack.status === 'generation_in_progress') return true;
  return requireReviewBeforeNextPack && !isPackReviewed(pack);
}

function publicProgress(progress) {
  return {
    student_name: progress.student_name,
    age: progress.age,
    current_level: progress.current_level,
    stars: progress.stars || 0,
    rank: progress.rank || rankForStars(progress.stars || 0),
    badges: progress.badges || badgesForStars(progress.stars || 0),
    packs_created: progress.packs_created || 0,
    completed_packs: progress.completed_packs || 0,
    weekly_completed_count: progress.weekly_completed_count || 0,
    streak_days: progress.streak_days || 0,
    last_activity_at: progress.last_activity_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: publicPack(progress.current_pack),
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
    pdf_url: pack.pdf_url,
    mp3_url: pack.mp3_url,
    reviewed_at: pack.reviewed_at,
    web_lesson_steps: pack.web_lesson_steps || null,
  };
}

function lastReviewSummary(currentPack, reviewHistory) {
  const summary = currentPack?.review_summary || null;
  if (summary) return publicReviewSummary(summary);
  const latest = Array.isArray(reviewHistory) && reviewHistory.length ? reviewHistory[0] : null;
  if (!latest) return null;
  return publicReviewSummary(latest);
}

function publicReviewSummary(summary) {
  return {
    reviewed_at: summary.reviewed_at,
    passed: summary.passed,
    star_awarded: summary.star_awarded,
    scores: summary.scores || {},
    feedback_vi: summary.feedback_vi || {},
    mini_practice_vi: summary.mini_practice_vi || {},
    level_recommendation: summary.level_recommendation || 'stay',
  };
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function rankForStars(stars) {
  if (stars >= 15) return 'Reading Champion';
  if (stars >= 10) return 'Story Hero';
  if (stars >= 6) return 'Mission Builder';
  if (stars >= 3) return 'Chunk Explorer';
  if (stars >= 1) return 'Story Starter';
  return 'Rookie Reader';
}

function badgesForStars(stars) {
  const badges = [];
  if (stars >= 1) badges.push('First Mission Complete');
  if (stars >= 3) badges.push('Chunk Hunter');
  if (stars >= 5) badges.push('Retell Rookie');
  if (stars >= 10) badges.push('Story Hero');
  return badges;
}

// Reconcile current_pack against task state KV. Returns possibly-updated codeData.
// Idempotent: if task already promoted (status != generation_in_progress) we no-op.
// Mirrors the promote logic in check-generation-status.js so the dashboard
// recovers without depending on the polling page being open.
const GENERATION_STALE_AFTER_MS = 10 * 60 * 1000; // 10 min: Render gen typically <60s

async function reconcileGenerationState(kv, accessCode, codeData) {
  const currentPack = codeData?.progress?.current_pack;
  if (!currentPack || currentPack.status !== 'generation_in_progress' || !currentPack.task_id) {
    return codeData;
  }
  const taskValue = await kv.get(`task:${currentPack.task_id}`, { type: 'json' });

  // CASE 1: Render finished, promote pack so dashboard shows "Chờ nộp bài"
  if (taskValue?.status === 'done' && taskValue.result?.pdf_url && taskValue.result?.mp3_url) {
    const now = new Date().toISOString();
    const newPackId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const finalPack = {
      pack_id: newPackId,
      status: 'awaiting_review',
      created_at: now,
      pdf_url: taskValue.result.pdf_url,
      mp3_url: taskValue.result.mp3_url,
      topic: taskValue.result.topic,
      story_title: taskValue.result.story_title,
      level: currentPack.level,
      generation_task_id: currentPack.task_id,
      review_context: taskValue.result.review_context || null,
    };
    const updated = {
      ...codeData,
      progress: {
        ...codeData.progress,
        current_pack: finalPack,
        packs_created: (codeData.progress?.packs_created || 0) + 1,
      },
      uses_remaining: Math.max(0, (codeData.uses_remaining ?? 0) - 1),
      last_used_at: now.slice(0, 10),
    };
    await kv.put(accessCode, JSON.stringify(updated));
    return updated;
  }

  // CASE 2: Render failed (or repair after error) — clear lock so user can retry
  if (taskValue?.status === 'error') {
    const updated = {
      ...codeData,
      progress: { ...codeData.progress, current_pack: null },
    };
    await kv.put(accessCode, JSON.stringify(updated));
    return updated;
  }

  // CASE 3: Task KV gone (TTL 30 min expired) AND lock older than 10 min →
  // assume orphaned, clear lock so user isn't blocked from creating new pack.
  // Anything younger we leave alone — Render might still be working.
  if (!taskValue) {
    const startedAt = Date.parse(currentPack.created_at || '');
    if (Number.isFinite(startedAt) && Date.now() - startedAt > GENERATION_STALE_AFTER_MS) {
      const updated = {
        ...codeData,
        progress: { ...codeData.progress, current_pack: null },
      };
      await kv.put(accessCode, JSON.stringify(updated));
      return updated;
    }
  }

  return codeData;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
