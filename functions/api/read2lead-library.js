import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { buildLibraryPayload } from './_read2lead-library.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chua cau hinh ma hoc sinh.' }, 500);
  }

  const url = new URL(request.url);
  const accessCode = (url.searchParams.get('code') || '').trim().toUpperCase();
  if (!accessCode) {
    return json({ ok: false, error: 'code_missing', message: 'Vui long nhap ma hoc sinh.' }, 400);
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

  const progress = codeData.progress || {};
  const reviewHistory = Array.isArray(progress.review_history) ? progress.review_history : [];
  const studentName = progress.student_name || codeData.student_profile?.student_name || '';

  return json({
    ok: true,
    access_code_masked: maskCode(accessCode),
    library: buildLibraryPayload({ reviewHistory, studentName }),
  });
}

function maskCode(code) {
  const value = String(code || '').trim().toUpperCase();
  if (value.length <= 4) return value;
  return `${value.slice(0, 2)}**${value.slice(-2)}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
