import { isValidBookPack } from './read2lead-lesson.js';

const VALID_LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4']);
const BAND_ORDER = ['L0', 'L1', 'L2', 'L3', 'L4'];

// SPEC_R2L_PAGE_BANDS.md: books are shelved by PAGE COUNT (stamina), not
// StoryWeaver text level. Non-finite/<1 input means "caller should reject",
// signalled by returning null rather than guessing a shelf.
export function bandForPageCount(pages) {
  if (!Number.isFinite(pages) || pages < 1) return null;
  if (pages <= 6) return 'L0';
  if (pages <= 9) return 'L1';
  if (pages <= 12) return 'L2';
  if (pages <= 15) return 'L3';
  return 'L4';
}

function isValidReindexIndexes(indexes) {
  if (!indexes || typeof indexes !== 'object' || Array.isArray(indexes)) return false;
  const seen = new Set();
  for (const level of BAND_ORDER) {
    const slugs = indexes[level];
    if (!Array.isArray(slugs)) return false;
    for (const slug of slugs) {
      if (typeof slug !== 'string' || !/^book_[0-9]+$/.test(slug)) return false;
      if (seen.has(slug)) return false; // disjoint across levels (and within one)
      seen.add(slug);
    }
  }
  return true;
}

// Read side of the same machine-secret contract: lets the enrichment batch
// (process_books.py --enrich-published) load published packs and slug indexes
// without direct KV credentials. ?index=L1 -> slug list; ?slug=book_123 -> pack.
export async function onRequestGet({ request, env }) {
  const providedSecret = request.headers.get('X-Read2Lead-Secret') || '';
  const expectedSecret = env.READ2LEAD_BACKEND_SECRET || '';
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error' }, 500);
  }
  const url = new URL(request.url);
  const level = String(url.searchParams.get('index') || '').toUpperCase();
  if (level) {
    if (!VALID_LEVELS.has(level)) return json({ ok: false, error: 'invalid_level' }, 400);
    const slugs = await env.READ2LEAD_CODES.get(`book_index:${level}`, { type: 'json' });
    return json({ ok: true, level, slugs: Array.isArray(slugs) ? slugs : [] });
  }
  const slug = String(url.searchParams.get('slug') || '').trim();
  if (!/^book_[0-9]+$/.test(slug)) return json({ ok: false, error: 'invalid_slug' }, 400);
  const pack = await env.READ2LEAD_CODES.get(`book:${slug}`, { type: 'json' });
  if (!pack) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, slug, pack });
}

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

  if (data?.reindex_only === true) {
    const indexes = data?.indexes;
    if (!isValidReindexIndexes(indexes)) {
      return json({ ok: false, error: 'invalid_reindex_indexes' }, 400);
    }
    const counts = {};
    for (const level of BAND_ORDER) {
      await env.READ2LEAD_CODES.put(`book_index:${level}`, JSON.stringify(indexes[level]));
      counts[level] = indexes[level].length;
    }
    return json({ ok: true, counts });
  }

  if (data?.activate_only === true) {
    const level = String(data?.level || '').toUpperCase();
    if (!VALID_LEVELS.has(level)) return json({ ok: false, error: 'invalid_level' }, 400);
    const active = await env.READ2LEAD_CODES.get('config:book_levels', { type: 'json' });
    const nextActive = Array.from(new Set([...(Array.isArray(active) ? active : []), level])).sort();
    await env.READ2LEAD_CODES.put('config:book_levels', JSON.stringify(nextActive));
    return json({ ok: true, book_levels: nextActive });
  }

  const pack = data?.pack;
  const level = String(data?.level || pack?.level || '').toUpperCase();

  // Cross-check page count before the generic pack-shape check so a
  // mismatch is reported distinctly (page_count_mismatch) rather than
  // folded into invalid_book_pack — never guess a shelf.
  const pages = (pack?.book_images || []).length;
  const paragraphCount = (pack?.story?.paragraphs_en || []).length;
  if (pack && pages !== paragraphCount) {
    return json({ ok: false, error: 'page_count_mismatch' }, 400);
  }

  if (!VALID_LEVELS.has(level) || !isValidBookPack(pack)) {
    return json({ ok: false, error: 'invalid_book_pack' }, 400);
  }

  const activityTypes = (pack.activities || []).map((activity) => activity?.type);
  if (activityTypes.join(',') !== 'read_aloud') {
    return json({ ok: false, error: 'invalid_book_activities' }, 400);
  }

  const band = bandForPageCount(pages);
  if (!band) {
    return json({ ok: false, error: 'invalid_book_pack' }, 400);
  }

  const indexKey = `book_index:${band}`;
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
