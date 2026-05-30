// Per-code admin endpoints.
// PATCH  /api/admin/codes/:code  → update parent info / uses / expiry / notes
// DELETE /api/admin/codes/:code  → revoke (remove from KV)

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const EDITABLE_STRING_FIELDS = ['parent_name', 'parent_zalo', 'notes', 'expires_at'];

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const code = params.code;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  const existing = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!existing) return json({ ok: false, error: 'not_found' }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const updated = { ...existing };

  for (const field of EDITABLE_STRING_FIELDS) {
    if (typeof body[field] === 'string') {
      updated[field] = body[field].trim().slice(0, 500);
    }
  }

  if (body.uses_remaining !== undefined) {
    const n = parseInt(body.uses_remaining, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 10000) {
      updated.uses_remaining = n;
    } else {
      return json({ ok: false, error: 'uses_remaining_invalid' }, 400);
    }
  }

  if (body.uses_total !== undefined) {
    const n = parseInt(body.uses_total, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 10000) {
      updated.uses_total = n;
    } else {
      return json({ ok: false, error: 'uses_total_invalid' }, 400);
    }
  }

  await env.READ2LEAD_CODES.put(code, JSON.stringify(updated));
  return json({ ok: true, code, record: updated });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const code = params.code;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  await env.READ2LEAD_CODES.delete(code);
  return json({ ok: true, code });
}
