// Public endpoint to resolve a magic link token into student info + access code.
// GET /api/r2l-link?token=... → { ok, access_code, student_name, level }
//
// The token is NEVER the access code — it's a 128-bit crypto-random hex string
// stored in KV under `r2l_link:{token}`. This endpoint validates the token,
// decrements its use counter, and returns the underlying access code so the
// start page can call /api/generate-read2lead-pack.

import { validateLinkRecord, linkKey } from './admin/codes/[code]/links.js';
import {
  getClientIp,
  checkCodeRateLimit,
  recordCodeFailure,
  rateLimitedResponse,
} from './_rate-limit.js';

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = env.READ2LEAD_CODES;
  if (!kv) return json({ ok: false, error: 'kv_missing' }, 500);

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token || !TOKEN_PATTERN.test(token)) {
    return json({
      ok: false,
      error: 'invalid_token',
      message: 'Link không hợp lệ. Nhắn Zalo Felix để nhận link mới.',
    }, 400);
  }

  const ip = getClientIp(request);
  const rateCheck = await checkCodeRateLimit(kv, ip);
  if (rateCheck.blocked) return rateLimitedResponse(rateCheck.retryAfter);

  const record = await kv.get(linkKey(token), { type: 'json' });
  if (!record) {
    await recordCodeFailure(kv, ip);
    return json({
      ok: false,
      error: 'link_not_found',
      message: 'Link không hợp lệ. Nhắn Zalo Felix để nhận link mới.',
    }, 404);
  }

  const validationError = validateLinkRecord(record);
  if (validationError === 'link_expired') {
    return json({
      ok: false,
      error: 'link_expired',
      message: 'Link đã hết hạn. Nhắn Zalo Felix để nhận link mới.',
    }, 410);
  }
  if (validationError === 'link_exhausted') {
    return json({
      ok: false,
      error: 'link_exhausted',
      message: 'Link đã hết lượt sử dụng. Nhắn Zalo Felix để nhận link mới.',
    }, 410);
  }
  if (validationError) {
    return json({
      ok: false,
      error: validationError,
      message: 'Link không hợp lệ. Nhắn Zalo Felix để nhận link mới.',
    }, 403);
  }

  const codeData = await kv.get(record.access_code, { type: 'json' });
  if (!codeData) {
    return json({
      ok: false,
      error: 'code_not_found',
      message: 'Mã học sinh không còn tồn tại. Nhắn Zalo Felix để được hỗ trợ.',
    }, 404);
  }

  record.uses_remaining = (record.uses_remaining ?? 1) - 1;
  record.last_used_at = new Date().toISOString().slice(0, 10);
  await kv.put(linkKey(token), JSON.stringify(record));

  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};

  return json({
    ok: true,
    access_code: record.access_code,
    student_name: profile.student_name || progress.student_name || '',
    level: progress.current_level || profile.level || 'L1',
  });
}
