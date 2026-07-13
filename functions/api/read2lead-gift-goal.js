// Sets the child's one chosen gift goal, which drives the progress-bar
// marketing surfaces (lesson-completion card, profile, parent report, R2L
// home, header, leaderboard — Steve's UI). `gift_id: null` clears it.
import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { loadProgressState, saveProgressState } from './_read2lead-v2-state.js';
import { loadGiftStore } from './admin/_gifts.js';
import { isGiftAvailable } from './_gifts-v2.js';

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

  const rawGiftId = body.gift_id;
  const giftId = rawGiftId === null || rawGiftId === undefined || rawGiftId === ''
    ? null
    : String(rawGiftId).trim();

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

  if (giftId) {
    const giftStore = await loadGiftStore(env);
    const gift = giftStore.gifts.find((item) => item.id === giftId);
    if (!gift) {
      return json({ ok: false, error: 'gift_not_found', message: 'Không tìm thấy món quà này.' }, 400);
    }
    // Fix (Buffet HIGH, backend half): a gift that's inactive or whose
    // budget cap is exhausted can never be delivered — don't let a kid pin
    // it as a goal. Existing goals are left alone even if a gift becomes
    // unavailable later (Steve's UI handles that case); this only blocks
    // NEW bad goals.
    if (!isGiftAvailable(gift)) {
      return json(
        { ok: false, error: 'gift_unavailable', message: 'Món quà này tạm thời chưa đổi được. Con chọn món khác nhé!' },
        400,
      );
    }
  }

  const state = await loadProgressState(env, accessCode, codeData);

  const saved = await saveProgressState(env, accessCode, { ...state, gift_goal: giftId });

  return json({ ok: true, gift_goal: saved.gift_goal });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
