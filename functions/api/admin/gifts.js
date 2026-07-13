// Admin CRUD for the "Quà thật" gift catalogue. Auth is free via the Basic
// Auth gate in functions/_middleware.js for all /api/admin/* paths — no
// manual auth check needed here (mirrors functions/api/admin/classes.js).
import { json, loadGiftStore, saveGiftStore } from './_gifts.js';

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const store = await loadGiftStore(env);
    return json({ ok: true, gifts: store.gifts });
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  if (!Array.isArray(body.gifts)) {
    return json({ ok: false, error: 'gifts_required' }, 400);
  }

  try {
    const next = await saveGiftStore(env, { gifts: body.gifts });
    return json({ ok: true, gifts: next.gifts });
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }
}
