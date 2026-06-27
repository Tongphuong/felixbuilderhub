import { vietnamWeekKey } from '../_read2lead-growth.js';
import { authorizeParentCode, json } from './portfolio.js';

export const PARENT_TASK_IDS = new Set([
  'current_pack',
  'weekly_goal',
  'maintain_streak',
  'next_suggestion',
]);

export function weeklyTaskKey(code, weekKey) {
  return `parent_tasks:${String(code || '').trim().toUpperCase()}:${weekKey}`;
}

function publicState(value, weekKey) {
  const completed = Array.isArray(value?.completed_task_ids)
    ? value.completed_task_ids.filter((id) => PARENT_TASK_IDS.has(id))
    : [];
  return { week_key: weekKey, completed_task_ids: completed };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const auth = await authorizeParentCode(context, url.searchParams.get('code'));
  if (auth.response) return auth.response;
  const weekKey = vietnamWeekKey();
  const value = await context.env.READ2LEAD_CODES.get(weeklyTaskKey(auth.code, weekKey), { type: 'json' });
  return json({ ok: true, ...publicState(value, weekKey) });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json', message: 'Dữ liệu không hợp lệ.' }, 400);
  }
  const auth = await authorizeParentCode(context, body?.code);
  if (auth.response) return auth.response;
  const taskId = String(body?.task_id || '');
  if (!PARENT_TASK_IDS.has(taskId) || typeof body?.completed !== 'boolean') {
    return json({ ok: false, error: 'invalid_task', message: 'Việc tuần không hợp lệ.' }, 400);
  }

  const weekKey = vietnamWeekKey();
  const key = weeklyTaskKey(auth.code, weekKey);
  const previous = await context.env.READ2LEAD_CODES.get(key, { type: 'json' });
  const completed = new Set(publicState(previous, weekKey).completed_task_ids);
  if (body.completed) completed.add(taskId);
  else completed.delete(taskId);
  const next = {
    schema_version: 1,
    week_key: weekKey,
    completed_task_ids: [...completed],
    updated_at: new Date().toISOString(),
  };
  await context.env.READ2LEAD_CODES.put(key, JSON.stringify(next));
  return json({ ok: true, ...publicState(next, weekKey) });
}
