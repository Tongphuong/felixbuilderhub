// R2L Season Honors — admin endpoint. Auth is free via the Basic Auth gate
// in functions/_middleware.js for all /api/admin/* paths (mirrors
// functions/api/admin/gifts.js / classes.js) — no manual auth check needed
// here.
//
// GET  -> the FULL frozen snapshot as-is (admin may see access_code/excluded).
// POST {action:'publish'|'unpublish'} -> reads the existing snapshot, flips
//   ONLY the `published` boolean, writes it back. Every other field —
//   podium, honor_roll, excluded, prize amounts, paid_at/diamonds_before/
//   diamonds_after — passes through byte-identical. This endpoint must never
//   become a way to rewrite a paid podium; it only ever toggles visibility
//   of what scripts/grant-season-honors.mjs already froze and paid.
import { progressNamespace } from '../_read2lead-v2-state.js';

// Same KV key as scripts/grant-season-honors.mjs's HONORS_KV_KEY. Duplicated
// (not imported) because that script pulls in node:child_process/node:fs via
// scripts/_kv-remote.mjs and must never end up in the Workers bundle — see
// the identical note in ../read2lead-honors.js. Keep both in sync by hand.
const HONORS_KV_KEY = 'honors:2026-S1';

export async function onRequestGet(context) {
  const { env } = context;

  const kv = progressNamespace(env);
  if (!kv) {
    return json({ ok: false, error: 'config_error', message: 'READ2LEAD_PROGRESS/READ2LEAD_CODES binding missing.' }, 500);
  }

  let snapshot;
  try {
    snapshot = await kv.get(HONORS_KV_KEY, { type: 'json' });
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }

  if (!snapshot) {
    return json({ ok: false, error: 'honors_not_frozen' }, 404);
  }

  return json({ ok: true, honors: snapshot });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  if (body?.action !== 'publish' && body?.action !== 'unpublish') {
    return json({ ok: false, error: 'invalid_action', message: 'action must be "publish" or "unpublish".' }, 400);
  }

  const kv = progressNamespace(env);
  if (!kv) {
    return json({ ok: false, error: 'config_error', message: 'READ2LEAD_PROGRESS/READ2LEAD_CODES binding missing.' }, 500);
  }

  let snapshot;
  try {
    snapshot = await kv.get(HONORS_KV_KEY, { type: 'json' });
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }

  if (!snapshot) {
    return json({ ok: false, error: 'honors_not_frozen' }, 404);
  }

  // Flip exactly the one boolean — every other field carries through
  // untouched via the spread.
  const updated = { ...snapshot, published: body.action === 'publish' };

  try {
    await kv.put(HONORS_KV_KEY, JSON.stringify(updated));
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }

  return json({ ok: true, honors: updated });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
