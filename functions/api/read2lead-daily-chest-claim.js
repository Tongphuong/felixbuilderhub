import {
  claimDailyLoginChest,
  loadProgressState,
  previewDailyLoginChest,
  saveProgressState,
  vietnamDateKey,
} from './_read2lead-v2-state.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_json', 400);
  }

  const accessCode = String(body.code || body.access_code || '').trim().toUpperCase();
  if (!accessCode) return jsonError('missing_code', 400);

  try {
    const kv = env.READ2LEAD_PROGRESS || env.READ2LEAD_CODES;
    if (!kv) return jsonError('config_error', 500);
    const raw = await kv.get(`progress:${accessCode}`, { type: 'json' });
    if (!raw) return jsonError('code_not_found', 404);
    const state = await loadProgressState(env, accessCode);
    const dateKey = vietnamDateKey();
    const result = claimDailyLoginChest(state, dateKey);
    if (result.error) return jsonError(result.error, 400);

    await saveProgressState(env, accessCode, result.state);
    return json({
      ok: true,
      reward: result.reward,
      diamonds: result.state.diamonds,
      preview: previewDailyLoginChest(result.state, dateKey),
    });
  } catch (err) {
    return jsonError(`server_error: ${err?.message || 'unknown'}`, 500);
  }
}

function jsonError(error, status) {
  return json({ ok: false, error }, status);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
