// Founder on/off switch for public sign-up (R2L-FINAL, "Sign-up on/off switch for the founder").
//   GET  /api/admin/signup-config → { ok, enabled, daily_cap, today_count }
//   POST /api/admin/signup-config { enabled?: boolean, daily_cap?: integer 0-500 } → same shape
//
// Reads/writes the SAME keys, in the SAME store and JSON shape, that functions/api/signup.js reads
// (config:signup_enabled, config:signup_daily_cap, signup-global:<date>), so signup.js picks changes
// up unchanged. Admin auth is NOT checked here, exactly like every other /api/admin/* handler: the
// Pages middleware Basic Auth gate runs first (functions/_middleware.js), and the account-service
// admin branch re-runs that same middleware on the Worker path. Tests exercise both.

import { globalCounterKey, DEFAULT_DAILY_CAP } from '../signup.js';

const ENABLED_KEY = 'config:signup_enabled';
const CAP_KEY = 'config:signup_daily_cap';
const CAP_MAX = 500;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function readState(kv) {
  const enabled = (await kv.get(ENABLED_KEY, { type: 'json' })) === true;
  const storedCap = await kv.get(CAP_KEY, { type: 'json' });
  // Same reading rule as signup.js: a stored non-negative number wins, otherwise the default.
  const daily_cap = Number.isFinite(storedCap) && storedCap >= 0 ? storedCap : DEFAULT_DAILY_CAP;
  const count = await kv.get(globalCounterKey(), { type: 'json' });
  return { ok: true, enabled, daily_cap, today_count: Number.isFinite(count) ? count : 0 };
}

export async function onRequestGet({ env }) {
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'kv_missing', message: 'Chưa kết nối được kho dữ liệu.' }, 500);
  return json(await readState(env.READ2LEAD_CODES));
}

export async function onRequestPost({ request, env }) {
  const kv = env.READ2LEAD_CODES;
  if (!kv) return json({ ok: false, error: 'kv_missing', message: 'Chưa kết nối được kho dữ liệu.' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Không đọc được thông tin gửi lên. Bạn thử lại nhé.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, error: 'invalid_json', message: 'Không đọc được thông tin gửi lên. Bạn thử lại nhé.' }, 400);
  }

  const hasEnabled = Object.hasOwn(body, 'enabled');
  const hasCap = Object.hasOwn(body, 'daily_cap');
  if (!hasEnabled && !hasCap) {
    return json({ ok: false, error: 'nothing_to_change', message: 'Chưa có gì để thay đổi. Hãy gửi "enabled" hoặc "daily_cap".' }, 400);
  }
  if (hasEnabled && typeof body.enabled !== 'boolean') {
    return json({ ok: false, error: 'enabled_invalid', message: 'Giá trị Bật/Tắt phải là đúng (bật) hoặc sai (tắt).' }, 400);
  }
  if (hasCap && !(Number.isInteger(body.daily_cap) && body.daily_cap >= 0 && body.daily_cap <= CAP_MAX)) {
    return json({ ok: false, error: 'daily_cap_invalid', message: `Số lượt đăng ký mỗi ngày phải là số nguyên từ 0 đến ${CAP_MAX}.` }, 400);
  }

  if (hasEnabled) await kv.put(ENABLED_KEY, JSON.stringify(body.enabled));
  if (hasCap) await kv.put(CAP_KEY, JSON.stringify(body.daily_cap));
  return json(await readState(kv));
}
