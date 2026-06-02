// Per-code admin endpoints.
// PATCH  /api/admin/codes/:code  → update parent info / uses / expiry / notes
// DELETE /api/admin/codes/:code  → revoke (remove from KV)

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const EDITABLE_STRING_FIELDS = ['parent_name', 'parent_zalo', 'notes', 'expires_at'];
const EDITABLE_BOOLEAN_FIELDS = ['is_test', 'is_shared'];

function boolFromBodyValue(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const code = params.code;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  const existing = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!existing) return json({ ok: false, error: 'not_found' }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const updated = { ...existing };

  for (const field of EDITABLE_STRING_FIELDS) {
    if (typeof body[field] === 'string') {
      updated[field] = body[field].trim().slice(0, 500);
    }
  }

  for (const field of EDITABLE_BOOLEAN_FIELDS) {
    if (body[field] !== undefined) {
      updated[field] = boolFromBodyValue(body[field]);
    }
  }

  if (body.uses_remaining !== undefined) {
    const n = parseInt(body.uses_remaining, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 10000) {
      updated.uses_remaining = n;
    } else {
      return json({ ok: false, error: 'uses_remaining_invalid' }, 400);
    }
  }

  if (body.uses_total !== undefined) {
    const n = parseInt(body.uses_total, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 10000) {
      updated.uses_total = n;
    } else {
      return json({ ok: false, error: 'uses_total_invalid' }, 400);
    }
  }

  if (body.student_profile && typeof body.student_profile === 'object') {
    const existingProfile = updated.student_profile || {};
    const profile = { ...existingProfile };
    if (typeof body.student_profile.student_name === 'string') {
      profile.student_name = body.student_profile.student_name.trim().slice(0, 50);
    }
    if (body.student_profile.age !== undefined) {
      const age = parseInt(body.student_profile.age, 10);
      if (!Number.isFinite(age) || age < 5 || age > 14) return json({ ok: false, error: 'student_age_invalid' }, 400);
      profile.age = age;
    }
    if (body.student_profile.level !== undefined) {
      if (!['L1', 'L2', 'L3'].includes(body.student_profile.level)) return json({ ok: false, error: 'student_level_invalid' }, 400);
      profile.level = body.student_profile.level;
    }
    if (body.student_profile.child_gender !== undefined) {
      if (!['boy', 'girl'].includes(body.student_profile.child_gender)) return json({ ok: false, error: 'child_gender_invalid' }, 400);
      profile.child_gender = body.student_profile.child_gender;
    }
    updated.student_profile = profile;
    updated.progress = {
      ...(updated.progress || {}),
      student_name: profile.student_name || updated.progress?.student_name || '',
      age: profile.age || updated.progress?.age || null,
      child_gender: profile.child_gender || updated.progress?.child_gender || '',
      current_level: profile.level || updated.progress?.current_level || 'L2',
      stars: updated.progress?.stars || 0,
      rank: updated.progress?.rank || 'Rookie Reader',
      badges: Array.isArray(updated.progress?.badges) ? updated.progress.badges : [],
      packs_created: updated.progress?.packs_created || 0,
      current_pack: updated.progress?.current_pack || null,
      review_history: Array.isArray(updated.progress?.review_history) ? updated.progress.review_history : [],
    };
  }

  await env.READ2LEAD_CODES.put(code, JSON.stringify(updated));
  return json({ ok: true, code, record: updated });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const code = params.code;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  await env.READ2LEAD_CODES.delete(code);
  return json({ ok: true, code });
}
