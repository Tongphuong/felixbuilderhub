import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { loadProgressState, progressKey, progressNamespace, saveProgressState } from './_read2lead-v2-state.js';
import { executeBuy, hydrateShopState } from './_read2lead-shop-v2.js';

const ERROR_MESSAGES = {
  already_owned: 'Con da so huu phan nay roi.',
  insufficient_coins: 'Chua du xu. Con hoc them de tich luy nhe!',
  common_parts_are_free: 'Phan nay mien phi, khong can mua.',
  missing_code: 'Thieu ma hoc sinh.',
  missing_part_id: 'Thieu ma phan trang bi.',
};

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chua cau hinh cua hang.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Khong doc duoc yeu cau cua hang.' }, 400);
  }

  const accessCode = String(body.code || body.access_code || '').trim().toUpperCase();
  const partId = String(body.part_id || '').trim();
  if (!accessCode) {
    return json({ ok: false, error: 'missing_code', message: ERROR_MESSAGES.missing_code }, 400);
  }
  if (!partId) {
    return json({ ok: false, error: 'missing_part_id', message: ERROR_MESSAGES.missing_part_id }, 400);
  }

  const clientIp = getClientIp(request);
  const rateLimit = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rateLimit.blocked) {
    return rateLimitedResponse(rateLimit.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Ma hoc sinh khong ton tai.' }, 404);
  }

  const state = await loadProgressState(env, accessCode, codeData);
  const kv = progressNamespace(env);
  const raw = kv ? await kv.get(progressKey(accessCode), { type: 'json' }) : null;
  const shopState = hydrateShopState(state, raw);
  const result = executeBuy(shopState, partId);
  if (result.error) {
    return json(
      {
        ok: false,
        error: result.error,
        message: ERROR_MESSAGES[result.error] || 'Khong the mua phan nay.',
      },
      400,
    );
  }

  const saved = await saveProgressState(env, accessCode, result.state);
  return json({
    ok: true,
    reward: result.reward,
    coins: saved.coins || 0,
    unlocked_parts: saved.unlocked_parts || result.state.unlocked_parts || [],
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
