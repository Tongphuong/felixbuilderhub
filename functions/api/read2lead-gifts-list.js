// Mirrors functions/api/read2lead-shop-list.js.
import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { loadProgressState } from './_read2lead-v2-state.js';
import { loadGiftStore, publicGift } from './admin/_gifts.js';
import { buildGiftView } from './_gifts-v2.js';

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
  if (!accessCode) {
    return json({ ok: false, error: 'missing_code', message: 'Thiếu mã học sinh.' }, 400);
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
  const publicCatalog = giftStore.gifts.map(publicGift);

  return json({
    ok: true,
    items: buildGiftView(state, publicCatalog),
    diamonds: state.diamonds || 0,
    redemptions: state.redemptions,
    gift_goal: state.gift_goal,
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
