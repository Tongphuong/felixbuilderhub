import {
  archiveStudentProfile,
  checkTokenAuth,
  cleanStudentId,
  createStudentProfile,
  findStudentProfile,
  getStudentProfileDb,
  json,
  readJson,
  updateStudentProfile,
  validateProfilePayload,
  validateStudentId,
} from '../_shared/student-profile.ts';

export async function onRequestGet(context) {
  const setup = authorizeAndBind(context);
  if (!setup.ok) return setup.response;

  const url = new URL(context.request.url);
  const checked = validateStudentId(url.searchParams.get('student_id'));
  if (!checked.ok) {
    return json({ ok: false, error: checked.error }, 400);
  }

  const profile = await findStudentProfile(setup.db, checked.studentId);
  if (!profile) {
    return json({ ok: false, error: 'student_profile_not_found' }, 404);
  }

  return json({ ok: true, profile });
}

export async function onRequestPost(context) {
  const setup = authorizeAndBind(context);
  if (!setup.ok) return setup.response;

  const parsed = await readJson(context.request);
  if (!parsed.ok) return parsed.response;

  const validated = validateProfilePayload(parsed.body, { requireStudentId: true });
  if (!validated.ok) {
    return json({ ok: false, error: 'invalid_payload', errors: validated.errors }, 400);
  }

  const existing = await findStudentProfile(setup.db, validated.profile.student_id);
  if (existing) {
    return json({ ok: false, error: 'student_profile_exists' }, 409);
  }

  const profile = await createStudentProfile(setup.db, validated.profile, nowIso());
  return json({ ok: true, profile }, 201);
}

export async function onRequestPut(context) {
  const setup = authorizeAndBind(context);
  if (!setup.ok) return setup.response;

  const parsed = await readJson(context.request);
  if (!parsed.ok) return parsed.response;

  const studentId = cleanStudentId(new URL(context.request.url).searchParams.get('student_id') || parsed.body.student_id);
  const checked = validateStudentId(studentId);
  if (!checked.ok) {
    return json({ ok: false, error: checked.error }, 400);
  }

  const validated = validateProfilePayload({ ...parsed.body, student_id: undefined });
  if (!validated.ok) {
    return json({ ok: false, error: 'invalid_payload', errors: validated.errors }, 400);
  }

  const profile = await updateStudentProfile(setup.db, checked.studentId, validated.profile, nowIso());
  if (!profile) {
    return json({ ok: false, error: 'student_profile_not_found' }, 404);
  }

  return json({ ok: true, profile });
}

export async function onRequestDelete(context) {
  const setup = authorizeAndBind(context);
  if (!setup.ok) return setup.response;

  const url = new URL(context.request.url);
  const checked = validateStudentId(url.searchParams.get('student_id'));
  if (!checked.ok) {
    return json({ ok: false, error: checked.error }, 400);
  }

  const archived = await archiveStudentProfile(setup.db, checked.studentId, nowIso());
  if (!archived) {
    return json({ ok: false, error: 'student_profile_not_found' }, 404);
  }

  return json({ ok: true, archived: true });
}

function authorizeAndBind(context) {
  const auth = checkTokenAuth(context.request, context.env);
  if (!auth.ok) return auth;

  const db = getStudentProfileDb(context.env);
  if (!db) {
    return { ok: false, response: json({ ok: false, error: 'config_error' }, 500) };
  }

  return { ok: true, db };
}

function nowIso() {
  return new Date().toISOString();
}
