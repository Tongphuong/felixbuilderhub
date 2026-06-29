import {
  findClass,
  json,
  loadClassStore,
  normalizeCode,
  rewardStudent,
} from '../../_classes.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  try {
    const store = await loadClassStore(env);
    const klass = findClass(store, params.id);
    if (!klass) return json({ ok: false, error: 'class_not_found' }, 404);
    const code = normalizeCode(body.code || body.access_code);
    if (!klass.student_codes.includes(code)) return json({ ok: false, error: 'student_not_in_class' }, 400);

    const xpDelta = Math.trunc(Number(body.xp_delta) || 0);
    const coinsDelta = Math.trunc(Number(body.coins_delta) || 0);
    if (xpDelta === 0 && coinsDelta === 0) {
      return json({ ok: false, error: 'empty_reward' }, 400);
    }

    const result = await rewardStudent(env, code, {
      xpDelta,
      coinsDelta,
      reason: String(body.reason || '').trim().slice(0, 80),
      kind: body.kind === 'needs_work' ? 'needs_work' : 'positive',
    });
    if (result.error) return json({ ok: false, error: result.error }, result.error === 'code_not_found' ? 404 : 400);
    return json(result);
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }
}
