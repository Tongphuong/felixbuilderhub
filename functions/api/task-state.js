// Internal endpoint dùng cho Render Python publish task state lên CF KV.
// Auth bằng X-Read2Lead-Secret (cùng secret với /generate-async).
// KV key format: `task:{task_id}`, TTL 30 phút auto-expire.

const TASK_TTL_SECONDS = 30 * 60;

export async function onRequestPost(context) {
  const { request, env } = context;

  const providedSecret = request.headers.get('X-Read2Lead-Secret') || '';
  const expectedSecret = env.READ2LEAD_BACKEND_SECRET || '';
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error' }, 500);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const taskId = (data.task_id || '').toString().trim();
  const status = (data.status || '').toString().trim();
  if (!taskId || !['pending', 'done', 'error'].includes(status)) {
    return json({ ok: false, error: 'invalid_payload' }, 400);
  }

  const value = {
    status,
    started_at: data.started_at || null,
    updated_at: new Date().toISOString(),
  };
  if (typeof data.queue_position === 'number') {
    value.queue_position = data.queue_position;
  }
  if (status === 'done' && data.result && typeof data.result === 'object') {
    value.result = data.result;
  }
  if (status === 'error' && typeof data.error === 'string') {
    value.error = data.error;
  }

  await env.READ2LEAD_CODES.put(`task:${taskId}`, JSON.stringify(value), {
    expirationTtl: TASK_TTL_SECONDS,
  });

  return json({ ok: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const providedSecret = request.headers.get('X-Read2Lead-Secret') || '';
  const expectedSecret = env.READ2LEAD_BACKEND_SECRET || '';
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error' }, 500);
  }

  const url = new URL(request.url);
  const taskId = (url.searchParams.get('task_id') || '').trim();
  if (!taskId) {
    return json({ ok: false, error: 'missing_task_id' }, 400);
  }

  const value = await env.READ2LEAD_CODES.get(`task:${taskId}`, { type: 'json' });
  if (!value) {
    return json({ ok: false, error: 'task_not_found' }, 404);
  }

  return json({ ok: true, ...value });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
