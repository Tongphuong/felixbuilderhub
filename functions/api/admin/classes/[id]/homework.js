import {
  loadClassStore,
  findClass,
  classKv,
  normalizeCode,
  json,
} from '../../_classes.js';
import { validateHomeworkInput, buildHomeworkRecord } from '../../../_homework.js';

export async function onRequestPost(context) {
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

    const validation = validateHomeworkInput({
      sentences_text: body.sentences_text,
      frame_text: body.frame_text,
      frame_duration_s: body.frame_duration_s,
      note_vi: body.note_vi,
    });
    if (!validation.ok) {
      return json({ ok: false, error: 'validation_failed', error_vi: validation.error_vi }, 400);
    }

    const targetCodes = Array.isArray(body.codes) && body.codes.length
      ? body.codes.map(normalizeCode).filter(code => klass.student_codes.includes(code))
      : klass.student_codes;

    const kv = classKv(env);
    const results = [];
    let updatedCount = 0;
    let failedCount = 0;

    for (const code of targetCodes) {
      const codeData = await kv.get(code, { type: 'json' });
      if (!codeData) {
        results.push({ code, ok: false, error: 'code_not_found' });
        failedCount++;
        continue;
      }
      const nextHomework = buildHomeworkRecord(validation.value, codeData.homework);
      const updated = { ...codeData, homework: nextHomework };
      await kv.put(code, JSON.stringify(updated));
      results.push({ code, ok: true });
      updatedCount++;
    }

    return json({ ok: true, results, updated_count: updatedCount, failed_count: failedCount });
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }
}
