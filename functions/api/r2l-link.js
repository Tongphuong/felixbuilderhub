// Public endpoint to resolve a magic link token into student info + access code.
// GET /api/r2l-link?token=... → { ok, access_code, student_name, level }
//
// The token is NEVER the access code — it's a 128-bit crypto-random hex string
// stored in KV under `r2l_link:{token}`. This endpoint validates the token and
// returns the underlying access code so the start page can call
// /api/generate-read2lead-pack.
//
// It does NOT spend a "use" per visit. /r2l/start is the child's home page: they open it
// daily, and metering page views ran the counter down until it locked the child out for
// good (a parent hit exactly that). Expiry + admin revoke are the security controls.

import { validateLinkRecord, linkKey, todayISO, addDaysISO } from './admin/codes/[code]/links.js';
import {
  getClientIp,
  checkCodeRateLimit,
  recordCodeFailure,
  rateLimitedResponse,
} from './_rate-limit.js';

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

const RENEW_WITHIN_DAYS = 30;
const RENEW_TO_DAYS = 365;
const DAY_SECONDS = 24 * 60 * 60;
const KV_MIN_TTL_SECONDS = 60; // KV rejects anything shorter

// TTL = through the end of the expiry day + a 1-day buffer, matching how links.js mints them.
export function ttlSecondsFor(expiresAtISO, now = Date.now()) {
  const expiresMs = Date.parse(`${expiresAtISO}T23:59:59Z`);
  if (!Number.isFinite(expiresMs)) return (RENEW_TO_DAYS + 1) * DAY_SECONDS;
  const seconds = Math.floor((expiresMs - now) / 1000) + DAY_SECONDS;
  return Math.max(KV_MIN_TTL_SECONDS, seconds);
}

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

  // A link the child is actively using must never age out from under them, so slide the expiry
  // once it comes within RENEW_WITHIN_DAYS of lapsing. Otherwise only touch last_used_at, and
  // only on the day it changes: refreshing the home page then costs zero KV writes, where the
  // old code wrote on every single request.
  const today = todayISO();
  const renewing = !record.expires_at || record.expires_at <= addDaysISO(RENEW_WITHIN_DAYS);

  if (renewing || record.last_used_at !== today) {
    record.last_used_at = today;
    if (renewing) record.expires_at = addDaysISO(RENEW_TO_DAYS);
    // Always re-assert the TTL: a put() without one would strip the record's expiration
    // entirely and leave the key in KV forever.
    await kv.put(linkKey(token), JSON.stringify(record), {
      expirationTtl: ttlSecondsFor(record.expires_at),
    });
  }

  const profile = codeData.student_profile || {};
  const progress = codeData.progress || {};

  return json({
    ok: true,
    access_code: record.access_code,
    student_name: profile.student_name || progress.student_name || '',
    level: progress.current_level || profile.level || 'L1',
  });
}
