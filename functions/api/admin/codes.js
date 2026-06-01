// Admin endpoints for managing Read2Lead access codes.
// POST /api/admin/codes  → create a new code with metadata
// GET  /api/admin/codes  → list all codes (sorted by issued_at desc)

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function randomChars(n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

async function generateUniqueCode(kv) {
  const month = MONTH_CODES[new Date().getUTCMonth()];
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = `R2L-${month}-${randomChars(4)}`;
    const exists = await kv.get(code);
    if (!exists) return code;
  }
  throw new Error('Could not generate unique code after 6 attempts');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const parent_name = (body.parent_name || '').trim().slice(0, 100);
  if (!parent_name) return json({ ok: false, error: 'parent_name_required' }, 400);

  const parent_zalo = (body.parent_zalo || '').trim().slice(0, 30);
  const notes = (body.notes || '').trim().slice(0, 500);
  const student_name = (body.student_name || '').trim().slice(0, 50);
  const student_age = parseInt(body.student_age, 10);
  const student_level = ['L1', 'L2', 'L3'].includes(body.student_level) ? body.student_level : '';
  const child_gender = ['boy', 'girl'].includes(body.child_gender) ? body.child_gender : '';
  const uses = parseInt(body.uses, 10);
  const expiry_days = parseInt(body.expiry_days, 10);

  if (!Number.isFinite(uses) || uses < 1 || uses > 1000) {
    return json({ ok: false, error: 'uses_invalid', message: 'uses must be 1-1000' }, 400);
  }
  if (!Number.isFinite(expiry_days) || expiry_days < 1 || expiry_days > 3650) {
    return json({ ok: false, error: 'expiry_days_invalid', message: 'expiry_days must be 1-3650' }, 400);
  }

  const code = await generateUniqueCode(env.READ2LEAD_CODES);
  const record = {
    parent_name,
    parent_zalo,
    notes,
    student_profile: student_name
      ? {
          student_name,
          age: Number.isFinite(student_age) && student_age >= 5 && student_age <= 14 ? student_age : null,
          level: student_level || 'L2',
          child_gender: child_gender || null,
        }
      : null,
    progress: student_name
      ? {
          student_name,
          age: Number.isFinite(student_age) && student_age >= 5 && student_age <= 14 ? student_age : null,
          child_gender: child_gender || null,
          current_level: student_level || 'L2',
          stars: 0,
          rank: 'Rookie Reader',
          badges: [],
          packs_created: 0,
          current_pack: null,
          review_history: [],
        }
      : null,
    issued_at: todayISO(),
    expires_at: addDaysISO(expiry_days),
    uses_total: uses,
    uses_remaining: uses,
    last_used_at: null,
  };
  await env.READ2LEAD_CODES.put(code, JSON.stringify(record));
  return json({ ok: true, code, record });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || undefined;

  const list = await env.READ2LEAD_CODES.list({ limit: 100, cursor });
  const items = [];
  for (const key of list.keys) {
    const value = await env.READ2LEAD_CODES.get(key.name, { type: 'json' });
    items.push({ code: key.name, ...(value || {}) });
  }

  items.sort((a, b) => (b.issued_at || '').localeCompare(a.issued_at || ''));

  return json({
    ok: true,
    items,
    cursor: list.list_complete ? null : list.cursor,
    list_complete: list.list_complete,
  });
}
