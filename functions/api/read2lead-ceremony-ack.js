import {
  loadProgressState,
  saveProgressState,
} from './_read2lead-v2-state.js';
import {
  checkCodeRateLimit,
  getClientIp,
  rateLimitedResponse,
  recordCodeFailure,
} from './_rate-limit.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error', message: 'Felixar chua cau hinh.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Khong doc duoc yeu cau.' }, 400);
  }

  const accessCode = String(body.code || body.access_code || '').trim().toUpperCase();
  if (!accessCode) {
    return json({ ok: false, error: 'missing_code', message: 'Thieu ma hoc sinh.' }, 400);
  }

  const clientIp = getClientIp(request);
  const rateLimit = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rateLimit.blocked) return rateLimitedResponse(rateLimit.retryAfter);

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Ma hoc sinh khong ton tai.' }, 404);
  }

  const state = await loadProgressState(env, accessCode, codeData);
  const pending = state.pending_ceremony;
  const partId = String(body.part_id || '').trim();
  const timestamp = String(body.ts || '').trim();
  const matchesPending = pending
    && (!partId || pending.part_id === partId)
    && (!timestamp || pending.ts === timestamp);

  if (matchesPending) {
    await saveProgressState(env, accessCode, { ...state, pending_ceremony: null });
  }

  return json({ ok: true, cleared: Boolean(matchesPending) });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
