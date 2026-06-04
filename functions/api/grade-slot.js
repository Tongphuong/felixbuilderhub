// POST /api/grade-slot
//
// Stateless lightweight grader for inline per-slot feedback. Called by
// lesson.astro's "Tiếp theo" handler so a kid can see "🔄 Câu này sai"
// the moment they advance past a slot, instead of only at final submit.
//
// Read-only: does NOT mutate KV state, does NOT grant stars, does NOT
// decrement uses, does NOT promote pack status. The kid still must
// hit final submit via /api/submit-read2lead-lesson to finish.
//
// Body: { access_code, pack_id, slot_id, answers: {<type>: {<index>: <value>}} }
// Returns: { ok: true, wrong_items: [{type, index}, ...] }
//
// Auth: same access_code rate-limit pattern as submit endpoint.

import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { gradeSingleSlot, isPackReviewed, normalizeProgress } from './_read2lead-lesson.js';

const ALLOWED_SLOTS = new Set([
  'cum_cau_con',
  'dung_cum_cau',
  'nghe_doc_theo',
  'hieu_truyen',
  'ke_chuyen_con',
]);

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'config_error' }, 500);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  // Honeypot — if a bot posted the website field, return ok with no work.
  if (data.website) {
    return json({ ok: true, wrong_items: [] });
  }

  const accessCode = (data.access_code || '').toString().trim().toUpperCase();
  const packId = (data.pack_id || '').toString().trim();
  const slotId = (data.slot_id || '').toString().trim();
  const answers = data.answers && typeof data.answers === 'object' ? data.answers : null;

  if (!accessCode || !packId || !slotId || !answers) {
    return json({ ok: false, error: 'missing_fields' }, 400);
  }
  if (!ALLOWED_SLOTS.has(slotId)) {
    return json({ ok: false, error: 'invalid_slot' }, 400);
  }

  const clientIp = getClientIp(request);
  const rl = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rl.blocked) {
    return rateLimitedResponse(rl.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found' }, 404);
  }

  const progress = normalizeProgress(codeData);
  const currentPack = progress.current_pack;
  if (!currentPack || currentPack.pack_id !== packId) {
    return json({ ok: false, error: 'pack_not_found' }, 404);
  }

  // Reviewed packs already done — return empty wrong_items, no need to grade again.
  if (isPackReviewed(currentPack)) {
    return json({ ok: true, wrong_items: [] });
  }

  const lessonContext = currentPack.review_context;
  if (!lessonContext) {
    // Pack missing review_context (data inconsistency) — fail gracefully so the
    // frontend pagination doesn't block. Frontend treats failure as "advance".
    return json({ ok: false, error: 'missing_context' }, 400);
  }

  const result = gradeSingleSlot(lessonContext, answers, slotId);
  return json({ ok: true, wrong_items: Array.isArray(result?.wrong_items) ? result.wrong_items : [] });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
