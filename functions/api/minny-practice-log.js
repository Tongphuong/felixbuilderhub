import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { canAccessPackForPractice } from './_read2lead-pack-access.js';

function weekKey(isoDate = new Date().toISOString()) {
  const date = new Date(isoDate);
  const day = date.getUTCDay();
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Dữ liệu không hợp lệ.' }, 400);
  }

  if (body?.website) {
    return json({ ok: true, message: 'Đã ghi nhận.' });
  }

  const accessCode = String(body?.access_code || '').trim().toUpperCase();
  const packId = String(body?.pack_id || '').trim();
  const scorePercent = Number(body?.score_percent);
  const promptId = String(body?.prompt_id || '').trim();
  const readyForClass = body?.ready_for_class === true;

  if (!accessCode || !packId) {
    return json({ ok: false, error: 'missing_fields', message: 'Thiếu mã học sinh hoặc mã bài.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) return rateLimitedResponse(rl.retryAfter);

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  if (!canAccessPackForPractice(codeData, packId)) {
    return json({ ok: false, error: 'pack_not_found', message: 'Không tìm thấy bài này.' }, 404);
  }

  const now = new Date().toISOString();
  const progress = codeData.progress || {};
  const prev = progress.minny_practice || {};
  const currentWeek = weekKey(now);
  const sessionsThisWeek = prev.weekly_key === currentWeek
    ? numberOrZero(prev.sessions_this_week) + 1
    : 1;

  const entry = {
    at: now,
    pack_id: packId,
    prompt_id: promptId,
    score_percent: Number.isFinite(scorePercent) ? Math.round(scorePercent) : null,
    ready_for_class: readyForClass,
  };

  const nextPractice = {
    schema_version: 1,
    last_at: now,
    weekly_key: currentWeek,
    sessions_this_week: sessionsThisWeek,
    last_ready_for_class_at: readyForClass ? now : (prev.last_ready_for_class_at || null),
    history: [entry, ...(Array.isArray(prev.history) ? prev.history : [])].slice(0, 20),
  };

  const nextCodeData = {
    ...codeData,
    progress: {
      ...progress,
      minny_practice: nextPractice,
      last_activity_at: now,
    },
  };

  await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(nextCodeData));

  return json({
    ok: true,
    sessions_this_week: sessionsThisWeek,
    message_vi: readyForClass
      ? 'Minny đã lưu — hẹn gặp con trong lớp coaching với Felix!'
      : 'Minny đã lưu buổi luyện của con.',
  });
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
