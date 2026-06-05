import {
  LEVELS,
  loadProgressState,
  publicProgressState,
  saveProgressState,
  setProgressLevel,
} from '../_read2lead-v2-state.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const accessCode = String(body.access_code || body.code || '').trim().toUpperCase();
  const level = String(body.level || '').trim().toUpperCase();
  if (!accessCode || !LEVELS.includes(level)) {
    return json({ ok: false, error: 'invalid_fields', message: 'access_code and level L1-L5 required' }, 400);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) return json({ ok: false, error: 'not_found' }, 404);

  const state = await loadProgressState(env, accessCode, codeData);
  const nextState = setProgressLevel(state, level);
  const saved = await saveProgressState(env, accessCode, nextState);

  const updatedCodeData = {
    ...codeData,
    student_profile: {
      ...(codeData.student_profile || {}),
      level,
    },
    progress: {
      ...(codeData.progress || {}),
      current_level: level,
    },
  };
  await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(updatedCodeData));

  return json({
    ok: true,
    code: accessCode,
    read2lead_state: publicProgressState(saved),
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
