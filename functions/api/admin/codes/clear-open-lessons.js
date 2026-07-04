// POST /api/admin/codes/clear-open-lessons
// Clears unfinished current_pack on access codes without touching progress:{code} rank/XP.

import {
  clearOpenLessonsFromKv,
  normalizeClearStatuses,
} from '../../_read2lead-clear-open-lessons.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  let body = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const dryRun = body.dry_run === true || body.dryRun === true;
  const statuses = normalizeClearStatuses(body.statuses);
  const onlyCodes = Array.isArray(body.codes) ? body.codes : null;

  const result = await clearOpenLessonsFromKv(env.READ2LEAD_CODES, {
    dryRun,
    statuses,
    onlyCodes,
  });

  const refundCount = result.refunded_use_count || 0;
  const message = dryRun
    ? `Dry run — no KV writes performed. Would refund ${refundCount} use(s).`
    : `Cleared open lessons. Refunded ${refundCount} use(s). progress:{code} rank/XP untouched.`;
  return json({
    ok: true,
    message,
    ...result,
  });
}
