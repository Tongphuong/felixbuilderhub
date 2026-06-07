// POST /api/admin/codes/:code/set-level
// Test accounts only — snap V2 progress to L1–L5 for pilot validation.

import {
  LEVELS,
  LEVEL_RESET_VERSION,
  RANK_ASSETS,
  RANK_TITLES,
  buildAdminTestLevelState,
  loadProgressState,
  publicProgressState,
  saveProgressState,
} from '../../../_read2lead-v2-state.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { env, params, request } = context;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  const code = String(params.code || '').trim().toUpperCase();
  if (!code) return json({ ok: false, error: 'code_required' }, 400);

  const record = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!record) return json({ ok: false, error: 'not_found' }, 404);
  if (!record.is_test) {
    return json(
      {
        ok: false,
        error: 'test_only',
        message: 'Chỉ mã test mới được set level. Bật Test ON trước.',
      },
      403,
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const level = String(body.level || '').trim().toUpperCase();
  if (!LEVELS.includes(level)) {
    return json({ ok: false, error: 'level_invalid', message: 'level must be L1–L5' }, 400);
  }

  let existingProgress = null;
  try {
    existingProgress = await loadProgressState(env, code, record);
  } catch {
    existingProgress = null;
  }

  const nextProgress = buildAdminTestLevelState(existingProgress, level, {
    accessCode: code,
    codeData: record,
  });
  await saveProgressState(env, code, nextProgress);

  const profile = record.student_profile || {};
  const progress = record.progress || {};
  const updatedRecord = {
    ...record,
    student_profile: {
      ...profile,
      level,
    },
    progress: {
      ...progress,
      student_name: profile.student_name || progress.student_name || nextProgress.student_name || '',
      age: profile.age || progress.age || null,
      child_gender: profile.child_gender || progress.child_gender || '',
      current_level: level,
      level,
      rank_title: RANK_TITLES[level],
      rank_asset_url: RANK_ASSETS[level],
      xp: 0,
      xp_in_level: 0,
      unlocked_levels: nextProgress.unlocked_levels,
      level_progress: nextProgress.level_progress,
      level_reset_version: LEVEL_RESET_VERSION,
    },
  };
  await env.READ2LEAD_CODES.put(code, JSON.stringify(updatedRecord));

  return json({
    ok: true,
    code,
    level,
    read2lead_state: publicProgressState(nextProgress),
  });
}
