import { isValidBookPack } from './read2lead-lesson.js';

const VALID_LEVELS = new Set(['L1', 'L2', 'L3', 'L4']);

export async function onRequestPost({ request, env }) {
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

  const pack = data?.pack;
  const level = String(data?.level || pack?.level || '').toUpperCase();
  if (!VALID_LEVELS.has(level) || !isValidBookPack(pack)) {
    return json({ ok: false, error: 'invalid_book_pack' }, 400);
  }

  const activityTypes = (pack.activities || []).map((activity) => activity?.type);
  if (activityTypes.join(',') !== 'listening_fill_blank,listen_and_order,read_aloud') {
    return json({ ok: false, error: 'invalid_book_activities' }, 400);
  }

  const indexKey = `book_index:${level}`;
  const current = await env.READ2LEAD_CODES.get(indexKey, { type: 'json' });
  const nextIndex = Array.from(new Set([...(Array.isArray(current) ? current : []), pack.book_slug])).sort();

  await env.READ2LEAD_CODES.put(`book:${pack.book_slug}`, JSON.stringify(pack));
  await env.READ2LEAD_CODES.put(indexKey, JSON.stringify(nextIndex));
  if (data.activate_level === true) {
    const active = await env.READ2LEAD_CODES.get('config:book_levels', { type: 'json' });
    const nextActive = Array.from(new Set([...(Array.isArray(active) ? active : []), level])).sort();
    await env.READ2LEAD_CODES.put('config:book_levels', JSON.stringify(nextActive));
  }

  return json({ ok: true, book_slug: pack.book_slug, level, activated: data.activate_level === true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
