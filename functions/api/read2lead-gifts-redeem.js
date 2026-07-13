// Mirrors functions/api/read2lead-shop-buy.js, but with NO rank gate (the
// diamond price is the gate, not the Silver rank the monster shop requires).
import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { loadProgressState, saveProgressState } from './_read2lead-v2-state.js';
import { loadGiftStore, saveGiftStore } from './admin/_gifts.js';
import { executeRedeem, PENDING_STATUSES } from './_gifts-v2.js';

const GIFT_QUEUE_KEY = 'admin:gift-redemptions:v1';

// No inventory/"hết hàng" language — gift_unavailable reads the same as
// gift_inactive from a kid's point of view (the budget cap is the founder's
// private concern, never surfaced as "sold out").
const ERROR_MESSAGES = {
  gift_not_found: 'Không tìm thấy món quà này.',
  gift_inactive: 'Món quà này tạm thời không đổi được.',
  gift_unavailable: 'Món quà này tạm thời không đổi được.',
  insufficient_diamonds: 'Chưa đủ kim cương. Con học thêm để tích lũy nhé!',
  pending_request_exists: 'Con đang có một yêu cầu đổi quà chờ xử lý rồi.',
  missing_code: 'Thiếu mã học sinh.',
  missing_gift_id: 'Thiếu mã quà tặng.',
};

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chưa cấu hình quà tặng.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Không đọc được yêu cầu.' }, 400);
  }

  const accessCode = String(body.code || body.access_code || '').trim().toUpperCase();
  const giftId = String(body.gift_id || '').trim();
  if (!accessCode) {
    return json({ ok: false, error: 'missing_code', message: ERROR_MESSAGES.missing_code }, 400);
  }
  if (!giftId) {
    return json({ ok: false, error: 'missing_gift_id', message: ERROR_MESSAGES.missing_gift_id }, 400);
  }

  const clientIp = getClientIp(request);
  const rateLimit = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rateLimit.blocked) {
    return rateLimitedResponse(rateLimit.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Mã học sinh không tồn tại.' }, 404);
  }

  const state = await loadProgressState(env, accessCode, codeData);

  const giftStore = await loadGiftStore(env);
  const gift = giftStore.gifts.find((item) => item.id === giftId);

  const result = executeRedeem(state, giftStore.gifts, giftId);
  if (result.error) {
    return json(
      { ok: false, error: result.error, message: ERROR_MESSAGES[result.error] || 'Không thể đổi món quà này.' },
      400,
    );
  }

  // Fix (Buffet HIGH, 2a): KV has no transactions, so two near-simultaneous
  // redeems from the same kid can both load the state above before either
  // one writes. Re-read fresh, immediately before we commit, and bail if a
  // pending redemption now exists that wasn't there when `result` was
  // computed — that means a concurrent redeem already landed, and writing
  // here would clobber it. This closes most (not all — KV still can't be
  // made perfectly atomic) of the race window.
  const freshState = await loadProgressState(env, accessCode, codeData);
  const freshRedemptions = Array.isArray(freshState.redemptions) ? freshState.redemptions : [];
  if (freshRedemptions.some((entry) => PENDING_STATUSES.has(entry?.status))) {
    return json(
      { ok: false, error: 'pending_request_exists', message: ERROR_MESSAGES.pending_request_exists },
      400,
    );
  }

  const nextGifts = giftStore.gifts.map((item) =>
    (item.id === giftId ? { ...item, redeemed_count: (item.redeemed_count || 0) + 1 } : item));

  // Fix (Buffet HIGH, 2b): write order matters for the residual race the
  // guard above doesn't close. The queue entry is written FIRST, before the
  // diamond debit. If the two requests still race past the guard, or the
  // process dies between these writes, the failure mode this produces is a
  // queue entry with no matching debit — recoverable, the founder rejects
  // or clears it and nothing was ever taken from the child. The alternative
  // order (debit first, queue second) risks the opposite: a debit with no
  // queue entry, which is NOT recoverable — the child paid and the founder
  // never finds out. Always fall on the recoverable side.
  await appendGiftQueueEntry(env, {
    redemption_id: result.redemption.id,
    code: accessCode,
    student_name: state.student_name || codeData?.student_profile?.student_name || '',
    gift_id: gift.id,
    name_vi: gift.name_vi,
    price_diamonds: result.redemption.price_diamonds,
    status: result.redemption.status,
    ts: result.redemption.ts,
  });

  const saved = await saveProgressState(env, accessCode, result.state);
  await saveGiftStore(env, { ...giftStore, gifts: nextGifts });

  return json({
    ok: true,
    redemption: result.redemption,
    diamonds: saved.diamonds || 0,
    redemptions: saved.redemptions || result.state.redemptions,
  });
}

// Append-only queue index so the admin queue never scans every student code.
async function appendGiftQueueEntry(env, entry) {
  const kv = env.READ2LEAD_CODES;
  const raw = await kv.get(GIFT_QUEUE_KEY, { type: 'json' });
  const queue = Array.isArray(raw?.entries) ? raw.entries : [];
  const next = [entry, ...queue].slice(0, 500);
  await kv.put(GIFT_QUEUE_KEY, JSON.stringify({ entries: next, updated_at: new Date().toISOString() }));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
