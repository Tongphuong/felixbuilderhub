import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import {
  applyPackCompletion,
  loadProgressState,
  publicProgressState,
  saveProgressState,
} from './_read2lead-v2-state.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã học sinh.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Không đọc được dữ liệu tiến trình.' }, 400);
  }

  const accessCode = String(body.access_code || body.code || '').trim().toUpperCase();
  const packId = String(body.pack_id || '').trim();
  if (!accessCode || !packId) {
    return json({ ok: false, error: 'missing_fields', message: 'Thiếu mã học sinh hoặc mã bài.' }, 400);
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

  const state = await loadProgressState(env, accessCode, codeData);
  const result = applyPackCompletion(state, {
    packId,
    completedAt: validIso(body.completed_at) || new Date().toISOString(),
    rewardsEarned: body.rewards_earned || {},
    activityResults: Array.isArray(body.activity_results) ? body.activity_results : [],
  });
  const saved = await saveProgressState(env, accessCode, result.state);

  return json({
    ok: true,
    already_counted: result.already_counted,
    level_up: result.level_up,
    read2lead_state: publicProgressState(saved),
  });
}

function validIso(value) {
  if (typeof value !== 'string') return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
