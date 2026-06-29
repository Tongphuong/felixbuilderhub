import {
  DEFAULT_CLASS_NAME,
  enrichClass,
  json,
  loadClassStore,
  normalizeClass,
  saveClassStore,
} from './_classes.js';

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const store = await loadClassStore(env);
    const classes = [];
    for (const klass of store.classes) {
      classes.push(await enrichClass(env, klass));
    }
    return json({ ok: true, classes });
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const store = await loadClassStore(env);
    const klass = normalizeClass({
      name: body.name || DEFAULT_CLASS_NAME,
      student_codes: [],
      order: store.classes.length,
    });
    const next = await saveClassStore(env, {
      ...store,
      classes: [...store.classes, klass],
    });
    return json({ ok: true, class: next.classes.find((item) => item.id === klass.id) || klass }, 201);
  } catch (err) {
    return json({ ok: false, error: 'server_error', message: err?.message || 'unknown' }, 500);
  }
}
