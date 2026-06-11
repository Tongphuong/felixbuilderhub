import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import {
  computeRankLadder,
  loadProgressState,
  PACKS_TO_NEXT_LEVEL,
  XP_PER_PASSED_PACK,
} from './_read2lead-v2-state.js';

const GENERATION_LOCK_STALE_MS = 15 * 60 * 1000;

// 0-100: how far the child is through the CURRENT level (passed packs / packs
// required for the next level). null when not computable (L5 has no next level,
// or state is missing) — the backend then defaults to mid-level behavior.
export function levelProgressPercent(progressState, level) {
  const required = Number(PACKS_TO_NEXT_LEVEL[level] || 0);
  if (!required) return null;
  const xp = Number(progressState?.xp_in_level ?? progressState?.xp);
  if (!Number.isFinite(xp) || xp < 0) return null;
  const packsDone = Math.floor(xp / XP_PER_PASSED_PACK);
  return Math.max(0, Math.min(100, Math.round((packsDone / required) * 100)));
}
const BACKEND_CHILD_NAME_RE = /^[^\W\d_]+(?:[\s\-'][^\W\d_]+)*$/u;

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (data.website) {
    return json({ ok: false, error: 'Spam detected' }, 400);
  }

  const errors = validate(data);
  if (errors.length) {
    return json({ ok: false, error: 'Validation failed', fields: errors }, 400);
  }

  const accessCode = (data.access_code || '').trim().toUpperCase();
  if (!accessCode) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng nhập mã học sinh.' }, 400);
  }

  if (!env.READ2LEAD_CODES) {
    console.error('READ2LEAD_CODES KV binding missing');
    return json({ ok: false, error: 'config_error', message: 'Felixar chưa cấu hình mã. Vui lòng nhắn Zalo Felix.' }, 500);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã không tồn tại. Kiểm tra lại hoặc nhắn Zalo Felix.' }, 403);
  }

  const availabilityError = checkCodeAvailability(codeData);
  if (availabilityError) return availabilityError;

  const progressState = await loadProgressState(env, accessCode, codeData);
  const progress = normalizeProgress(codeData, progressState);
  const profileError = checkStudentProfile(progress);
  if (profileError) return profileError;
  const requireReviewBeforeNextPack = shouldRequireReviewBeforeNextPack(codeData);
  if (currentPackBlocksGeneration(progress.current_pack, requireReviewBeforeNextPack)) {
    return json(
      {
        ok: false,
        error: progress.current_pack.status === 'generation_in_progress' ? 'generation_in_progress' : 'previous_pack_needs_review',
        message:
          progress.current_pack.status === 'generation_in_progress'
            ? 'Felixar đang tạo bài cho con. Vui lòng đợi thêm một chút, đừng bấm tạo lại.'
            : 'Con cần hoàn thành bài đang mở trên web trước khi tạo bài mới. Mở bài học, làm xong 5 nhiệm vụ rồi bấm lưu chiến công.',
        review_link: `/hoc-sinh?code=${encodeURIComponent(accessCode)}`,
        current_pack: publicPack(progress.current_pack),
        progress: publicProgress(progress),
      },
      409,
    );
  }

  const backendUrl = env.READ2LEAD_BACKEND_URL;
  if (!backendUrl) {
    return json({ ok: false, error: 'backend_not_configured', message: 'Backend chưa cấu hình.' }, 500);
  }
  const backendSecret = env.READ2LEAD_BACKEND_SECRET;
  if (!backendSecret) {
    return json({ ok: false, error: 'backend_auth_not_configured', message: 'Backend chưa cấu hình bảo mật.' }, 500);
  }

  const interests = (data.interests || '').toString().trim().slice(0, 120);
  const topic = (data.topic || '').toString().trim().slice(0, 60);
  const levelForPack = progress.current_level || 'L1';
  const lockCreatedAt = new Date().toISOString();
  const pendingPackId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pendingPack = {
    pack_id: pendingPackId,
    status: 'generation_in_progress',
    created_at: lockCreatedAt,
    topic: topic || '',
    story_title: 'Đang tạo bài Read2Lead',
    level: levelForPack,
  };
  const lockedProgress = {
    ...progress,
    current_level: levelForPack,
    current_pack: pendingPack,
  };
  await env.READ2LEAD_CODES.put(
    accessCode,
    JSON.stringify({
      ...codeData,
      student_profile: {
        ...(codeData.student_profile || {}),
        student_name: progress.student_name,
        age: progress.age,
        level: levelForPack,
        child_gender: progress.child_gender,
      },
      progress: lockedProgress,
    }),
  );

  try {
    const reviewUrl = `${new URL(request.url).origin}/hoc-sinh?code=${encodeURIComponent(accessCode)}`;
    const rankLadder = computeRankLadder(progressState);
    const rankPoints = Number.isFinite(Number(rankLadder?.rank_points))
      ? Math.max(0, Math.floor(Number(rankLadder.rank_points)))
      : null;
    const upstreamRequestBody = {
      child_name: progress.student_name,
      age: progress.age,
      level: levelForPack,
      child_gender: progress.child_gender,
      interests: interests || undefined,
      topic: topic || undefined,
      review_url: reviewUrl,
    };
    if (rankPoints != null) {
      upstreamRequestBody.rank_points = rankPoints;
    }
    // In-level difficulty ramp (W2R backend leg): tell the generator how far the
    // child is through the CURRENT level so pack language ramps early→mid→late
    // instead of staying flat for 5-35 packs. Old backends ignore the field.
    const levelProgress = levelProgressPercent(progressState, levelForPack);
    if (levelProgress != null) {
      upstreamRequestBody.level_progress_percent = levelProgress;
    }
    const upstream = await fetch(`${backendUrl}/generate-async-v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Read2Lead-Secret': backendSecret,
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify(upstreamRequestBody),
    });
    if (!upstream.ok) {
      await clearGenerationLock(env.READ2LEAD_CODES, accessCode, pendingPackId);
      const body = await upstream.json().catch(() => ({ ok: false, error: 'backend_error' }));
      return json(mapBackendGenerateError(body), upstream.status);
    }

    const upstreamBody = await upstream.json();
    if (upstreamBody.ok && upstreamBody.pack?.schema_version === 2) {
      const finalPack = buildFinalV2Pack({
        pendingPack,
        pack: upstreamBody.pack,
        createdAt: new Date().toISOString(),
      });
      const nextProgress = {
        ...lockedProgress,
        current_pack: finalPack,
        packs_created: (progress.packs_created || 0) + 1,
      };
      const updatedCode = {
        ...codeData,
        student_profile: {
          ...(codeData.student_profile || {}),
          student_name: progress.student_name,
          age: progress.age,
          level: finalPack.level,
          child_gender: progress.child_gender,
        },
        progress: nextProgress,
        uses_remaining: Math.max(0, (codeData.uses_remaining ?? 0) - 1),
        last_used_at: finalPack.created_at.slice(0, 10),
      };
      await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(updatedCode));

      return json({
        ok: true,
        status: 'done',
        pack_id: finalPack.pack_id,
        topic: finalPack.topic,
        story_title: finalPack.story_title,
        child_name: progress.student_name,
        review_link: `/hoc-sinh?code=${encodeURIComponent(accessCode)}`,
        lesson_link: `/read2lead/lesson?code=${encodeURIComponent(accessCode)}&pack_id=${encodeURIComponent(finalPack.pack_id)}`,
        current_pack: publicPack(finalPack),
        progress: publicProgress(nextProgress),
        level: finalPack.level,
      });
    }

    if (!upstreamBody.ok || !upstreamBody.task_id) {
      await clearGenerationLock(env.READ2LEAD_CODES, accessCode, pendingPackId);
      return json({ ok: false, error: 'backend_invalid_response' }, 502);
    }

    const pendingPackWithTaskId = {
      ...pendingPack,
      task_id: upstreamBody.task_id,
    };
    const lockedProgressWithTaskId = {
      ...lockedProgress,
      current_pack: pendingPackWithTaskId,
    };
    const lockedWithTaskId = {
      ...codeData,
      student_profile: {
        ...(codeData.student_profile || {}),
        student_name: progress.student_name,
        age: progress.age,
        level: levelForPack,
        child_gender: progress.child_gender,
      },
      progress: lockedProgressWithTaskId,
    };
    await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(lockedWithTaskId));

    return json({
      ok: true,
      task_id: upstreamBody.task_id,
      status: 'pending',
      current_pack: publicPack(pendingPackWithTaskId),
      progress: publicProgress(lockedProgressWithTaskId),
      level: levelForPack,
    });
  } catch (err) {
    console.error('Backend call failed:', err.message);
    await clearGenerationLock(env.READ2LEAD_CODES, accessCode, pendingPackId);
    return json({ ok: false, error: 'backend_unavailable', message: 'Backend không phản hồi. Thử lại sau.' }, 502);
  }
}

function validate(data) {
  const errors = [];
  return errors;
}

function checkStudentProfile(progress) {
  if (!progress.student_name) {
    return json({ ok: false, error: 'student_profile_missing', message: 'Mã này chưa có tên học sinh. Vào admin/codes để cập nhật tên con trước khi tạo bài.' }, 400);
  }
  if (!isValidBackendChildName(progress.student_name)) {
    return json(
      {
        ok: false,
        error: 'student_name_invalid',
        message:
          'Tên con chỉ dùng chữ cái (không số, không ký tự đặc biệt). Vào admin/codes → Edit — ví dụ dùng "Pilot" thay vì "Pilot L3".',
      },
      400,
    );
  }
  if (!Number.isFinite(progress.age) || progress.age < 5 || progress.age > 14) {
    return json({ ok: false, error: 'student_age_missing', message: 'Mã này chưa có tuổi học sinh. Vào admin/codes để cập nhật tuổi con trước khi tạo bài.' }, 400);
  }
  if (!['boy', 'girl'].includes(progress.child_gender)) {
    return json({ ok: false, error: 'student_gender_missing', message: 'Mã này chưa có giới tính học sinh. Vào admin/codes để cập nhật trước khi tạo bài.' }, 400);
  }
  return null;
}

function checkCodeAvailability(codeData) {
  if (codeData.expires_at) {
    const today = new Date().toISOString().slice(0, 10);
    if (codeData.expires_at < today) {
      return json({ ok: false, error: 'code_expired', message: 'Mã đã hết hạn. Vui lòng liên hệ Felix qua Zalo để gia hạn.' }, 403);
    }
  }

  if ((codeData.uses_remaining ?? 0) <= 0) {
    return json({ ok: false, error: 'code_exhausted', message: 'Mã đã hết lượt. Vui lòng liên hệ Felix qua Zalo để gia hạn.' }, 403);
  }
  return null;
}

function normalizeProgress(codeData, progressState = null) {
  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  return {
    student_name: profile.student_name || progressState?.student_name || progress.student_name || '',
    age: Number.isFinite(profile.age) ? profile.age : (Number.isFinite(progress.age) ? progress.age : null),
    child_gender: profile.child_gender || progress.child_gender || '',
    current_level: progressState?.current_level || earnedCurrentLevel(progress, reviewHistory),
    packs_created: progress.packs_created || 0,
    completed_packs: progress.completed_packs || reviewHistory.length || 0,
    weekly_completed_count: progress.weekly_completed_count || 0,
    weekly_key: progress.weekly_key || '',
    streak_days: progress.streak_days || 0,
    last_activity_at: progress.last_activity_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: progress.current_pack || null,
    review_history: reviewHistory,
  };
}

function isPackReviewed(pack) {
  return ['reviewed_pass', 'reviewed_retry', 'reviewed_pass_web', 'reviewed_retry_web', 'reviewed_pass_web_v2'].includes(pack.status);
}

function shouldRequireReviewBeforeNextPack(codeData) {
  return !(codeData.is_test === true || codeData.is_shared === true);
}

function currentPackBlocksGeneration(pack, requireReviewBeforeNextPack = true) {
  if (!pack) return false;

  if (pack.status !== 'generation_in_progress') {
    if (!isV2Pack(pack)) return false;
    return requireReviewBeforeNextPack && !isPackReviewed(pack);
  }

  const startedAt = Date.parse(pack.created_at || '');
  if (!Number.isFinite(startedAt)) return false;
  return Date.now() - startedAt < GENERATION_LOCK_STALE_MS;
}

function isV2Pack(pack) {
  return Boolean(
    pack?.schema_version === 2 ||
      pack?.review_context?.schema_version === 2 ||
      pack?.pack?.schema_version === 2 ||
      pack?.pack_json?.schema_version === 2,
  );
}

function earnedCurrentLevel(progress, reviewHistory = []) {
  const completedPacks = numberOrZero(progress.completed_packs) || reviewHistory.length;
  if (completedPacks > 0 && ['L1', 'L2', 'L3'].includes(progress.current_level)) {
    return progress.current_level;
  }
  return 'L1';
}

function buildFinalV2Pack({ pendingPack, pack, createdAt }) {
  return {
    ...pendingPack,
    status: 'awaiting_review',
    created_at: createdAt,
    topic: pack.topic || pendingPack.topic || '',
    story_title: pack.story?.title || pack.story_title || 'Read2Lead V2 Mission',
    level: pack.level || pendingPack.level,
    schema_version: 2,
    review_context: pack,
  };
}

async function clearGenerationLock(kv, accessCode, pendingPackId) {
  const current = await kv.get(accessCode, { type: 'json' });
  if (!current?.progress?.current_pack || current.progress.current_pack.pack_id !== pendingPackId) return;

  await kv.put(
    accessCode,
    JSON.stringify({
      ...current,
      progress: {
        ...current.progress,
        current_pack: null,
      },
    }),
  );
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
  };
}

function publicProgress(progress) {
  return {
    student_name: progress.student_name,
    current_level: progress.current_level,
    completed_packs: progress.completed_packs || 0,
    weekly_completed_count: progress.weekly_completed_count || 0,
    streak_days: progress.streak_days || 0,
    last_activity_at: progress.last_activity_at || null,
    last_level_recommendation: progress.last_level_recommendation || 'stay',
    current_pack: publicPack(progress.current_pack),
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isValidBackendChildName(name) {
  const trimmed = String(name || '').trim();
  return trimmed.length > 0 && trimmed.length <= 50 && BACKEND_CHILD_NAME_RE.test(trimmed);
}

function mapBackendGenerateError(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'backend_error' };
  if (body.error === 'Invalid child_name') {
    return {
      ...body,
      error: 'student_name_invalid',
      message:
        'Tên con chỉ dùng chữ cái (không số). Vào admin/codes → Edit — ví dụ "Pilot" thay vì "Pilot L3".',
    };
  }
  return body;
}
