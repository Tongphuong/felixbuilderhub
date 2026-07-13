import {
  loadClassStore,
  findClass,
  classKv,
  normalizeCode,
  json,
} from '../../_classes.js';
import { validateHomeworkInput, validateHomeworkTasksInput, buildHomeworkRecord } from '../../../_homework.js';

// Accepts BOTH the NEW schema v3 payload shape ({ tasks: [...] }) and the
// OLD payload shape ({ sentences_text, frame_text, frame_duration_s }) so
// nothing breaks mid-deploy while Steve's admin UI ships the new task
// builder. Either shape is parsed down to the same {tasks, note_vi, photo}
// value and saved as one v3 record via buildHomeworkRecord — see contract
// `homework-tasks-contract.md` §4.
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

    const validation = Array.isArray(body.tasks)
      ? validateHomeworkTasksInput({
          tasks: body.tasks,
          note_vi: body.note_vi,
          photo: body.photo,
          class_id: klass.id,
        })
      : validateHomeworkInput({
          sentences_text: body.sentences_text,
          frame_text: body.frame_text,
          frame_duration_s: body.frame_duration_s,
          note_vi: body.note_vi,
          photo: body.photo,
          class_id: klass.id,
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
