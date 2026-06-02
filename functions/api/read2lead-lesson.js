import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { buildLessonPayload } from './_read2lead-lesson.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chưa cấu hình mã học sinh.' }, 500);
  }

  const url = new URL(request.url);
  const accessCode = (url.searchParams.get('code') || '').trim().toUpperCase();
  const packId = (url.searchParams.get('pack_id') || '').trim();
  if (!accessCode || !packId) {
    return json({ ok: false, error: 'missing_params', message: 'Thiếu mã học sinh hoặc mã bài.' }, 400);
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

  const pack = codeData.progress?.current_pack;
  if (!pack || pack.pack_id !== packId) {
    return json({ ok: false, error: 'pack_not_found', message: 'Không tìm thấy bài này trong mã học sinh.' }, 404);
  }

  if (pack.status === 'generation_in_progress') {
    return json({ ok: false, error: 'generation_in_progress', message: 'Bài vẫn đang được tạo. Vui lòng đợi thêm một chút.' }, 409);
  }

  if (!pack.review_context) {
    return json({ ok: false, error: 'missing_context', message: 'Bài này thiếu dữ liệu để làm trên web. Vui lòng dùng PDF hoặc tạo lại bài.' }, 400);
  }

  return json({
    ok: true,
    lesson: buildLessonPayload({ accessCode, codeData, pack }),
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
