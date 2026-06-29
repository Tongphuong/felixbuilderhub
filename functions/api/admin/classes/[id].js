import {
  codeAssignedElsewhere,
  codeExists,
  enrichClass,
  findClass,
  json,
  loadClassStore,
  normalizeCode,
  normalizePresets,
  saveClassStore,
  todayVN,
  DEFAULT_NEEDS_WORK_PRESETS,
  DEFAULT_POSITIVE_PRESETS,
} from '../_classes.js';

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  try {
    const store = await loadClassStore(env);
    const klass = findClass(store, params.id);
    if (!klass) return json({ ok: false, error: 'class_not_found' }, 404);

    const updated = {
      ...klass,
      student_codes: [...klass.student_codes],
      attendance_by_date: { ...(klass.attendance_by_date || {}) },
    };

    if (typeof body.name === 'string') {
      updated.name = body.name.trim().slice(0, 80) || updated.name;
    }

    if (Array.isArray(body.positive_presets)) {
      updated.positive_presets = normalizePresets(body.positive_presets, DEFAULT_POSITIVE_PRESETS);
    }

    if (Array.isArray(body.needs_work_presets)) {
      updated.needs_work_presets = normalizePresets(body.needs_work_presets, DEFAULT_NEEDS_WORK_PRESETS);
    }

    if (body.add_code) {
      const code = normalizeCode(body.add_code);
      if (!await codeExists(env, code)) return json({ ok: false, error: 'code_not_found' }, 404);
      const duplicate = codeAssignedElsewhere(store, code, klass.id);
      if (duplicate) {
        return json({ ok: false, error: 'student_already_in_class', class_id: duplicate.id, class_name: duplicate.name }, 409);
      }
      if (!updated.student_codes.includes(code)) updated.student_codes.push(code);
    }

    if (body.remove_code) {
      const code = normalizeCode(body.remove_code);
      updated.student_codes = updated.student_codes.filter((item) => item !== code);
    }

    if (body.attendance && typeof body.attendance === 'object') {
      const code = normalizeCode(body.attendance.code);
      const date = String(body.attendance.date || todayVN());
      const status = body.attendance.status;
      if (!updated.student_codes.includes(code)) return json({ ok: false, error: 'student_not_in_class' }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: 'invalid_attendance_date' }, 400);
      if (status !== 'present' && status !== 'absent' && status !== null) return json({ ok: false, error: 'invalid_attendance_status' }, 400);
      updated.attendance_by_date[date] = { ...(updated.attendance_by_date[date] || {}) };
      if (status === null) delete updated.attendance_by_date[date][code];
      else updated.attendance_by_date[date][code] = status;
    }

    updated.updated_at = new Date().toISOString();
    const nextStore = await saveClassStore(env, {
      ...store,
      classes: store.classes.map((item) => item.id === klass.id ? updated : item),
    });
    const saved = findClass(nextStore, klass.id) || updated;
    return json({ ok: true, class: await enrichClass(env, saved) });
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }
}
