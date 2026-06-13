import {
  consumePendingChest,
  normalizeProgressState,
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

  const raw = await env.R2L_STATE.get(`progress:${accessCode}`, 'json');
  if (!raw) return jsonError('code_not_found', 404);
  const state = normalizeProgressState(raw, { accessCode });
  const result = consumePendingChest(state, vietnamDateKey(), accessCode);
  if (result.error) return jsonError(result.error, 400);

  await env.R2L_STATE.put(`progress:${accessCode}`, JSON.stringify(result.state));
  return json({
    ok: true,
    reward: result.reward,
    coins: result.state.coins,
    unlocked_parts: result.state.unlocked_parts,
  });
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
