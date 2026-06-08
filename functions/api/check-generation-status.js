import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';

const STATUS_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const accessCode = (url.searchParams.get('access_code') || '').trim().toUpperCase();
  const taskId = (url.searchParams.get('task_id') || '').trim();

  if (!accessCode || !taskId) {
    return json({ ok: false, error: 'missing_params' }, 400);
  }

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error' }, 500);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found' }, 403);
  }

  const currentPack = codeData.progress?.current_pack;
  if (currentPack?.generation_task_id === taskId && isV2Pack(currentPack)) {
    return json({
      ok: true,
      status: 'done',
      pack_id: currentPack.pack_id,
      topic: currentPack.topic,
      story_title: currentPack.story_title,
      review_link: `/hoc-sinh?code=${encodeURIComponent(accessCode)}`,
      lesson_link: `/read2lead/lesson?code=${encodeURIComponent(accessCode)}&pack_id=${encodeURIComponent(currentPack.pack_id)}`,
    });
  }

  if (!currentPack || currentPack.task_id !== taskId) {
    return json({ ok: false, error: 'task_mismatch' }, 403);
  }

  const startedAt = Date.parse(currentPack.created_at || '');
  if (Number.isFinite(startedAt) && Date.now() - startedAt > STATUS_POLL_TIMEOUT_MS) {
    await clearGenerationLockSimple(env.READ2LEAD_CODES, accessCode, taskId);
    return json({ ok: false, error: 'timeout', message: 'Generation quá thời gian cho phép. Vui lòng thử lại.' }, 504);
  }

  // Đọc task state trực tiếp từ KV (Render Python publish state qua /api/task-state).
  // Loại bỏ phụ thuộc vào Render in-memory dict — state persist qua Render restart.
  const taskValue = await env.READ2LEAD_CODES.get(`task:${taskId}`, { type: 'json' });
  if (!taskValue) {
    // Chưa publish hoặc đã expire (TTL 30 phút). Vẫn pending nếu lock còn dưới 60s.
    const startedAtIso = currentPack.created_at || '';
    const startedAtMs = Date.parse(startedAtIso);
    if (Number.isFinite(startedAtMs) && Date.now() - startedAtMs < 60_000) {
      return json({ ok: true, status: 'pending' });
    }
    await clearGenerationLockSimple(env.READ2LEAD_CODES, accessCode, taskId);
    return json({ ok: false, error: 'task_not_found', message: 'Bài đã hết phiên (hoặc máy chủ vừa khởi động lại). Vui lòng thử lại.' }, 404);
  }

  const upstream = {
    status: 200,
    body: {
      ok: true,
      status: taskValue.status,
      queue_position: typeof taskValue.queue_position === 'number' ? taskValue.queue_position : null,
      ...(taskValue.result || {}),
      error: taskValue.error,
    },
  };
  const status = upstream.body.status;

  if (status === 'pending') {
    return json({ ok: true, status: 'pending', queue_position: upstream.body.queue_position });
  }

  if (status === 'error') {
    await clearGenerationLockSimple(env.READ2LEAD_CODES, accessCode, taskId);
    const upstreamError = upstream.body.error || 'generation_failed';
    return json({
      ok: false,
      error: upstreamError,
      message: `Tạo bài thất bại: ${upstreamError}. Vui lòng thử lại hoặc nhắn Zalo Felix.`,
    }, 500);
  }

  if (status === 'done') {
    const packId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const now = new Date().toISOString();
    const finalPack = {
      pack_id: packId,
      status: 'awaiting_review',
      created_at: now,
      topic: upstream.body.topic,
      story_title: upstream.body.story_title,
      level: currentPack.level,
      generation_task_id: taskId,
      review_context: upstream.body.review_context || null,
      schema_version: upstream.body.review_context?.schema_version || null,
    };

    const nextProgress = {
      ...codeData.progress,
      current_pack: finalPack,
      packs_created: (codeData.progress?.packs_created || 0) + 1,
    };

    const updatedCode = {
      ...codeData,
      progress: nextProgress,
      uses_remaining: (codeData.uses_remaining ?? 0) - 1,
      last_used_at: now.slice(0, 10),
    };
    await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(updatedCode));

    return json({
      ok: true,
      status: 'done',
      pack_id: finalPack.pack_id,
      topic: finalPack.topic,
      story_title: finalPack.story_title,
      review_link: `/hoc-sinh?code=${encodeURIComponent(accessCode)}`,
      lesson_link: `/read2lead/lesson?code=${encodeURIComponent(accessCode)}&pack_id=${encodeURIComponent(finalPack.pack_id)}`,
    });
  }

  return json({ ok: false, error: 'unknown_status' }, 500);
}

function isV2Pack(pack) {
  return Boolean(
    pack?.schema_version === 2 ||
      pack?.review_context?.schema_version === 2 ||
      pack?.pack?.schema_version === 2 ||
      pack?.pack_json?.schema_version === 2,
  );
}

async function clearGenerationLockSimple(kv, accessCode, taskId) {
  const current = await kv.get(accessCode, { type: 'json' });
  if (!current?.progress?.current_pack || current.progress.current_pack.task_id !== taskId) return;
  await kv.put(
    accessCode,
    JSON.stringify({
      ...current,
      progress: { ...current.progress, current_pack: null },
    }),
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
