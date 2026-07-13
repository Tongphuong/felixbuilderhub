import { isValidBookPack } from './read2lead-lesson.js';

const VALID_LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4']);
const BAND_ORDER = ['L0', 'L1', 'L2', 'L3', 'L4'];

// SPEC_R2L_PAGE_BANDS.md shelved books by PAGE COUNT alone and logged its own follow-up:
// "page count != text difficulty; a words-per-page guard inside bands is the logged follow-up
// if pilot feedback demands it." Pilot feedback demanded it — a 5-page/206-word L4 book
// ("Never too late to accept your mistakes") reached an L0 child, because page count is blind
// to how much text is ON a page. Books are now shelved by READING LOAD: total words, with a
// words-per-page ceiling that promotes a short-but-dense book up a shelf.
//
// A book can only ever be promoted UP, never down, so no shelf loses stock to the guard.
// Non-finite/<1 input means "caller should reject" — signalled by null, never a guessed shelf.
const WORD_CUTS = [116, 202, 332, 531]; // quintiles of the published 394-book corpus
const WPP_CEILING = { L0: 20, L1: 30, L2: 45, L3: 60, L4: Infinity };

export function readingLoadOf(pack) {
  const pages = (pack?.book_images || []).length;
  const words = (pack?.story?.paragraphs_en || []).reduce(
    (sum, paragraph) => sum + String(paragraph ?? '').split(/\s+/).filter(Boolean).length,
    0,
  );
  return { words, pages };
}

export function bandForReadingLoad({ words, pages } = {}) {
  if (!Number.isFinite(words) || !Number.isFinite(pages) || words < 1 || pages < 1) return null;

  let band = WORD_CUTS.findIndex((cut) => words <= cut);
  if (band === -1) band = BAND_ORDER.length - 1;

  const wordsPerPage = words / pages;
  while (band < BAND_ORDER.length - 1 && wordsPerPage > WPP_CEILING[BAND_ORDER[band]]) band += 1;

  return BAND_ORDER[band];
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

  const band = bandForReadingLoad(readingLoadOf(pack));
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
