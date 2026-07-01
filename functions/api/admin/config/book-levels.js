export async function onRequestGet({ env }) {
  if (!env.ADMIN_PASSWORD) return json({ error: 'no admin' }, 500);
  const stored = await env.READ2LEAD_CODES.get('config:book_levels', { type: 'json' });
  return json({ book_levels: stored || [] });
}

export async function onRequestPost({ request, env }) {
  const secret = request.headers.get('X-Read2Lead-Secret') || '';
  if (!env.READ2LEAD_BACKEND_SECRET || secret !== env.READ2LEAD_BACKEND_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }
  const { levels } = await request.json().catch(() => ({}));
  if (!Array.isArray(levels) || !levels.every((l) => /^L[0-5]$/.test(l))) {
    return json({ error: 'levels must be array of L0-L5' }, 400);
  }
  const sorted = [...new Set(levels)].sort();
  await env.READ2LEAD_CODES.put('config:book_levels', JSON.stringify(sorted));
  return json({ ok: true, book_levels: sorted });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
