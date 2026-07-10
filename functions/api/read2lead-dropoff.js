import { loadProgressState } from './_read2lead-v2-state.js';

// Machine-readable drop-off report, gated by the shared READ2LEAD_BACKEND_SECRET
// (X-Read2Lead-Secret header) so a scheduled job can pull it without the human
// admin Basic-Auth. Lives at /api/ (not /api/admin/) on purpose: it is consumed
// by the weekly drop-off cron, not a browser. Reads the compact `dropoff:*`
// records written (best-effort) by read2lead-checkpoint-save.js and buckets the
// ABANDONED ones (kid left, never completed the pack) by lesson phase/stage and
// by page, so we can see WHERE kids stop instead of guessing "too long" vs
// "too hard".
//
// A record is treated as abandoned when:
//   - its (code, pack) is not in that kid's completed packs (authoritative v2
//     state via loadProgressState), AND
//   - it was last saved more than `stale_minutes` ago (default 30) so we don't
//     count sessions that are probably still in progress right now.
export async function onRequestGet({ request, env }) {
  if (!env.READ2LEAD_CODES) return json({ error: 'config_error' }, 500);

  const secret = request.headers.get('X-Read2Lead-Secret') || '';
  if (!env.READ2LEAD_BACKEND_SECRET || secret !== env.READ2LEAD_BACKEND_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const since = (url.searchParams.get('since') || '').trim(); // inclusive YYYY-MM-DD
  const staleMinutes = clampInt(url.searchParams.get('stale_minutes'), 30, 0, 1_000_000);

  // 1. Collect all drop-off records (paginated).
  const records = [];
  let cursor;
  do {
    const listed = await env.READ2LEAD_CODES.list({ prefix: 'dropoff:', cursor });
    for (const key of listed.keys || []) {
      const day = key.name.slice(8, 18); // after "dropoff:"
      if (since && day < since) continue;
      const rec = await env.READ2LEAD_CODES.get(key.name, { type: 'json' });
      if (rec && typeof rec === 'object') records.push(rec);
    }
    cursor = listed.list_complete ? null : listed.cursor;
  } while (cursor);

  // 2. Completion lookup per code (cached — authoritative v2 game state).
  const completedByCode = new Map();
  async function completedPacks(code) {
    if (completedByCode.has(code)) return completedByCode.get(code);
    const done = new Set();
    try {
      const codeData = await env.READ2LEAD_CODES.get(code, { type: 'json' });
      const state = await loadProgressState(env, code, codeData);
      for (const id of state?.completed_pack_ids || []) done.add(id);
      for (const h of state?.pack_history || []) if (h?.pack_id) done.add(h.pack_id);
    } catch {
      // if state can't be read, treat as nothing completed (conservative)
    }
    completedByCode.set(code, done);
    return done;
  }

  // 3. Filter to abandoned + bucket.
  const now = Date.now();
  const byStage = new Map(); // `${phase}/${stage}` -> count
  const byPage = new Map(); // `${page}/${pages_total}` -> count
  const abandoned = [];
  for (const rec of records) {
    const done = await completedPacks(rec.code);
    if (done.has(rec.pack)) continue; // finished -> not a drop-off
    const ageMin = rec.ts ? (now - Date.parse(rec.ts)) / 60000 : Infinity;
    if (ageMin < staleMinutes) continue; // probably still active
    abandoned.push(rec);
    bump(byStage, `${rec.phase || 'unknown'}/${rec.stage || 'unknown'}`);
    if (rec.page !== null && rec.page !== undefined) {
      bump(byPage, `${rec.page}/${rec.pages_total ?? '?'}`);
    }
  }

  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    filters: { since: since || null, stale_minutes: staleMinutes },
    total_records: records.length,
    abandoned_count: abandoned.length,
    by_stage: toSortedList(byStage),
    by_page: toSortedList(byPage),
    samples: abandoned
      .sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0))
      .slice(0, 25),
  });
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function toSortedList(map) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
