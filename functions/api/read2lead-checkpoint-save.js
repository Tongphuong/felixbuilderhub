import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error' }, 500);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const accessCode = (data.access_code || '').toString().trim().toUpperCase();
  const packId = (data.pack_id || '').toString().trim();
  const snapshot = data.snapshot;

  if (!accessCode || !packId || !snapshot || typeof snapshot !== 'object') {
    return json({ ok: false, error: 'missing_fields' }, 400);
  }

  let serialized;
  try {
    serialized = JSON.stringify(snapshot);
  } catch {
    return json({ ok: false, error: 'invalid_snapshot' }, 400);
  }
  if (serialized.length > 20000) {
    return json({ ok: false, error: 'snapshot_too_large' }, 413);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found' }, 404);
  }

  const currentPack = codeData.progress?.current_pack;
  if (!currentPack || currentPack.pack_id !== packId || currentPack.status !== 'awaiting_review') {
    return json({ ok: true, stored: false });
  }

  const updated = {
    ...codeData,
    progress: {
      ...codeData.progress,
      current_pack: {
        ...currentPack,
        web_session_checkpoint: {
          saved_at: new Date().toISOString(),
          snapshot,
        },
      },
    },
  };
  await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(updated));
  return json({ ok: true, stored: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
