import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { buildStoryProgressForProfile } from './_read2lead-library.js';
import { buildWeeklyGrowthForProfile } from './_read2lead-growth.js';
import { buildSkillQuality } from './_read2lead-profile-quality.js';
import { loadProgressState, PACKS_TO_NEXT_LEVEL, publicProgressState } from './_read2lead-v2-state.js';
import { isV2PackSchemaVersion, packHasV2Schema } from './_read2lead-pack-schema.js';

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

  const legacyProgress = normalizeProgress(codeData);
  const v2State = await loadProgressState(env, code, codeData);
  const progress = {
    ...legacyProgress,
    student_name: v2State.student_name || legacyProgress.student_name,
    current_level: v2State.current_level,
  };
  const requireReviewBeforeNextPack = shouldRequireReviewBeforeNextPack(codeData);
  const nextPackLocked = currentPackBlocksGeneration(progress.current_pack, requireReviewBeforeNextPack);
  const state = dashboardState(progress.current_pack);

  return json({
    ok: true,
    state,
    state_label: stateLabel(state),
    primary_action: primaryAction(state, code, nextPackLocked),
    progress: publicProgress(progress),
    read2lead_state: publicProgressState(v2State),
    next_pack_locked: nextPackLocked,
    review_link: `/ho-so?code=${encodeURIComponent(code)}`,
    last_review_summary: lastReviewSummary(progress.current_pack, progress.review_history),
    weekly_completed_count: progress.weekly_completed_count,
    streak_days: progress.streak_days,
    last_level_recommendation: progress.last_level_recommendation,
    is_test: codeData.is_test === true,
    is_shared: codeData.is_shared === true,
    story_progress: buildStoryProgressForProfile({
      reviewHistory: progress.review_history,
      studentName: progress.student_name,
      currentLevel: v2State.current_level,
      packsCompletedInLevel: numberOrZero(v2State.level_progress?.[v2State.current_level]),
      packsNeededForLevelUp: numberOrZero(PACKS_TO_NEXT_LEVEL[v2State.current_level]),
      accessCode: code,
    }),
    weekly_growth: buildWeeklyGrowthForProfile({
      packHistory: v2State.pack_history,
      reviewHistory: progress.review_history,
      studentName: v2State.student_name || progress.student_name,
    }),
    skill_quality: buildSkillQuality({
      packHistory: v2State.pack_history,
      currentPack: codeData.progress?.current_pack || null,
    }),
  });
}

function normalizeProgress(codeData) {
  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  const completedPacks = numberOrZero(progress.completed_packs) || reviewHistory.length;

  return {
    student_name: profile.student_name || progress.student_name || '',
    age: profile.age || progress.age || null,
    current_level: progress.current_level || profile.level || 'L1',
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
    awaiting_review: 'Chưa hoàn thành bài',
    reviewed: 'Đã nhận xét',
  }[state] || 'Đang kiểm tra';
}

function primaryAction(state, code, nextPackLocked) {
  if (state === 'generation_in_progress') {
    return { type: 'wait', label: 'Đang tạo bài', href: null };
  }
  if (state === 'awaiting_review' && nextPackLocked) {
    return { type: 'open_lesson', label: 'Mở bài con đang học', href: null };
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
  return ['reviewed_pass', 'reviewed_retry', 'reviewed_pass_web', 'reviewed_retry_web', 'reviewed_pass_web_v2'].includes(pack.status);
}

function shouldRequireReviewBeforeNextPack(codeData) {
  return !(codeData.is_test === true || codeData.is_shared === true);
}

const GENERATION_LOCK_STALE_MS = 15 * 60 * 1000;

function generationLockAgeMs(pack) {
  const startedAt = Date.parse(pack?.created_at || '');
  return Number.isFinite(startedAt) ? Date.now() - startedAt : Number.POSITIVE_INFINITY;
}

function isStaleGenerationLock(pack) {
  if (!pack || pack.status !== 'generation_in_progress') return false;
  return generationLockAgeMs(pack) >= GENERATION_LOCK_STALE_MS;
}

function currentPackBlocksGeneration(pack, requireReviewBeforeNextPack = true) {
  if (!pack) return false;
  if (pack.status === 'generation_in_progress') {
    return generationLockAgeMs(pack) < GENERATION_LOCK_STALE_MS;
  }
  if (!packHasV2Schema(pack)) return false;
  return requireReviewBeforeNextPack && !isPackReviewed(pack);
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

function publicPack(pack) {
  if (!pack) return null;
  return {
    pack_id: pack.pack_id,
    status: pack.status,
    topic: pack.topic,
    story_title: pack.story_title,
    level: pack.level,
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

// Reconcile current_pack against task state KV. Returns possibly-updated codeData.
// Idempotent: if task already promoted (status != generation_in_progress) we no-op.
// Mirrors the promote logic in check-generation-status.js so the dashboard
// recovers without depending on the polling page being open.
async function reconcileGenerationState(kv, accessCode, codeData) {
  const currentPack = codeData?.progress?.current_pack;
  if (!currentPack || currentPack.status !== 'generation_in_progress') {
    return codeData;
  }

  if (!currentPack.task_id && isStaleGenerationLock(currentPack)) {
    return clearGenerationLock(kv, accessCode, codeData);
  }
  if (!currentPack.task_id) {
    return codeData;
  }

  const taskValue = await kv.get(`task:${currentPack.task_id}`, { type: 'json' });

  // CASE 1: Render finished, promote pack so dashboard shows "Chờ nộp bài"
  if (taskValue?.status === 'done' && isV2PackSchemaVersion(taskValue.result?.review_context?.schema_version)) {
    const now = new Date().toISOString();
    const newPackId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const finalPack = {
      pack_id: newPackId,
      status: 'awaiting_review',
      created_at: now,
      topic: taskValue.result.topic,
      story_title: taskValue.result.story_title,
      level: currentPack.level,
      generation_task_id: currentPack.task_id,
      review_context: taskValue.result.review_context || null,
      schema_version: taskValue.result.review_context?.schema_version || null,
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
    return clearGenerationLock(kv, accessCode, codeData);
  }

  // CASE 3: Task KV gone (TTL 30 min expired) AND lock stale → orphaned, clear lock.
  if (!taskValue && isStaleGenerationLock(currentPack)) {
    return clearGenerationLock(kv, accessCode, codeData);
  }

  // CASE 4: Task KV stuck on pending after Render restart — clear when lock is stale.
  if (taskValue?.status === 'pending' && isStaleGenerationLock(currentPack)) {
    return clearGenerationLock(kv, accessCode, codeData);
  }

  return codeData;
}

async function clearGenerationLock(kv, accessCode, codeData) {
  const updated = {
    ...codeData,
    progress: { ...codeData.progress, current_pack: null },
  };
  await kv.put(accessCode, JSON.stringify(updated));
  return updated;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
