// Public self-serve signup — mints a Read2Lead access code without a human
// in the loop, replacing the Zalo-to-Phương manual bottleneck.
// POST /api/signup → { ok, code, link, record }
//
// See _ops/specs/SPEC_R2L_OPEN_ACCESS.md (R2L-OPEN-ACCESS).
//
// SHIPS DARK: gated on `config:signup_enabled` (KV, default absent/off) → 503
// until Phương flips it on. Every abuse fence below fails CLOSED — an
// unreadable KV counter or a missing Turnstile secret refuses the signup, it
// never silently opens the tap. Reuses the code-record factory (byte-compatible
// with admin-created codes) and the existing magic-link mint handler wholesale,
// so a kid never has to retype the code.

import { generateUniqueCodeForName, buildCodeRecord } from './_code-factory.js';
import { onRequestPost as mintLinkForCode } from './admin/codes/[code]/links.js';
import { getClientIp, checkSignupIpLimit, recordSignupIp } from './_rate-limit.js';

const SIGNUP_USES_TOTAL = 3;
const SIGNUP_EXPIRY_DAYS = 90;
const DEFAULT_DAILY_CAP = 50;
const GLOBAL_COUNTER_TTL_SECONDS = 60 * 60 * 48; // mirrors minny-conversation.js's daily/global counter TTL

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function globalCounterKey() {
  return `signup-global:${todayKey()}`;
}

// Exported for tests — real Turnstile verification is a single POST to
// Cloudflare's siteverify endpoint (no client library, no new dependency).
export async function verifyTurnstile(secret, token, ip, fetchImpl = fetch) {
  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
  const data = await res.json();
  return data?.success === true;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.READ2LEAD_CODES;
  if (!kv) return json({ ok: false, error: 'kv_missing' }, 500);

  // --- Ships dark until Phương flips config:signup_enabled ---
  let enabled = false;
  try {
    enabled = (await kv.get('config:signup_enabled', { type: 'json' })) === true;
  } catch {
    enabled = false; // fail closed
  }
  if (!enabled) {
    return json({
      ok: false,
      error: 'signup_disabled',
      message: 'Đăng ký chưa mở. Nhắn Zalo Felix để được cấp mã nhé.',
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  // --- Turnstile — fail closed: flag on + no secret configured = refuse ---
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return json({
      ok: false,
      error: 'turnstile_not_configured',
      message: 'Đăng ký chưa sẵn sàng. Nhắn Zalo Felix nhé.',
    }, 503);
  }

  const turnstileToken = body.turnstile_token || body['cf-turnstile-response'];
  if (!turnstileToken || typeof turnstileToken !== 'string') {
    return json({ ok: false, error: 'turnstile_required' }, 400);
  }

  const ip = getClientIp(request);
  let turnstileOk = false;
  try {
    turnstileOk = await verifyTurnstile(secret, turnstileToken, ip, context.fetchImpl || fetch);
  } catch {
    turnstileOk = false; // network/API failure => fail closed, never treat as pass
  }
  if (!turnstileOk) {
    return json({
      ok: false,
      error: 'turnstile_failed',
      message: 'Xác minh không thành công. Vui lòng thử lại.',
    }, 403);
  }

  // --- Abuse fences (read-only checks; counters only advance on success) ---
  const ipCheck = await checkSignupIpLimit(kv, ip);
  if (ipCheck.blocked) {
    return json({
      ok: false,
      error: 'rate_limited',
      message: 'Bạn đã đăng ký quá số lần cho phép hôm nay. Vui lòng thử lại vào ngày mai.',
    }, 429);
  }

  let dailyCap = DEFAULT_DAILY_CAP;
  try {
    const configuredCap = await kv.get('config:signup_daily_cap', { type: 'json' });
    if (Number.isFinite(configuredCap) && configuredCap > 0) dailyCap = configuredCap;
  } catch {
    // best-effort read of the cap override — default stays in effect
  }

  const gKey = globalCounterKey();
  let globalCount;
  try {
    const gRaw = await kv.get(gKey, { type: 'json' });
    globalCount = Number.isFinite(gRaw) ? gRaw : 0;
  } catch {
    globalCount = dailyCap; // fail closed: an unreadable counter reads as "at cap"
  }
  if (globalCount >= dailyCap) {
    return json({
      ok: false,
      error: 'global_cap',
      message: 'Hôm nay đã đủ số lượng đăng ký mới. Vui lòng quay lại vào ngày mai.',
    }, 429);
  }

  // --- Field validation (same fields/bounds admin already requires) ---
  const student_name = (body.student_name || '').trim().slice(0, 50);
  const student_age = parseInt(body.student_age, 10);
  const child_gender = ['boy', 'girl'].includes(body.child_gender) ? body.child_gender : '';
  const parent_zalo = (body.parent_zalo || '').trim().slice(0, 30);

  if (!student_name) {
    return json({ ok: false, error: 'student_name_required', message: 'student_name is required' }, 400);
  }
  if (!Number.isFinite(student_age) || student_age < 5 || student_age > 14) {
    return json({ ok: false, error: 'student_age_invalid', message: 'student_age must be 5-14' }, 400);
  }
  if (!child_gender) {
    return json({ ok: false, error: 'child_gender_required', message: 'child_gender is required' }, 400);
  }

  // --- Mint the code (factory-built, byte-compatible with admin-created records) ---
  const code = await generateUniqueCodeForName(kv, student_name);
  const record = buildCodeRecord({
    parent_zalo,
    student_name,
    student_age,
    child_gender,
    uses_total: SIGNUP_USES_TOTAL,
    expiry_days: SIGNUP_EXPIRY_DAYS,
    is_test: false,
    is_shared: false,
    origin: 'self_serve',
  });
  await kv.put(code, JSON.stringify(record));

  // --- Mint the magic link by reusing the existing admin mint handler wholesale
  // (same token generation, KV record shape, and reverse index the resolver
  // in r2l-link.js already knows how to read) ---
  const linkRequest = new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const linkResponse = await mintLinkForCode({ request: linkRequest, env, params: { code } });
  const linkBody = await linkResponse.json();
  if (!linkBody.ok) {
    // Should be unreachable (the code we just wrote must exist), but never
    // hand back a code with no working link.
    return json({ ok: false, error: 'link_mint_failed' }, 500);
  }

  // --- Best-effort abuse-counter bookkeeping — only after a successful mint,
  // so a refused/invalid request never burns a legitimate parent's allowance ---
  await recordSignupIp(kv, ip);
  try {
    await kv.put(gKey, JSON.stringify(globalCount + 1), { expirationTtl: GLOBAL_COUNTER_TTL_SECONDS });
  } catch {
    // best-effort — a missed counter increment undercounts, never overcounts
  }

  return json({ ok: true, code, link: linkBody.link, record });
}
