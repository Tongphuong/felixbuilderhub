// POST /api/admin/codes/reset-levels
// Reset all existing Read2Lead codes and V2 progress states back to L1.

const START_LEVEL = 'L1';
const LEVEL_RESET_VERSION = 20260606;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  let cursor = undefined;
  let scanned = 0;
  let reset = 0;

  do {
    const page = await env.READ2LEAD_CODES.list({ limit: 100, cursor });
    cursor = page.list_complete ? undefined : page.cursor;

    for (const key of page.keys) {
      if (key.name.startsWith('task:') || key.name.startsWith('progress:')) continue;
      scanned += 1;
      const record = await env.READ2LEAD_CODES.get(key.name, { type: 'json' });
      if (!record || typeof record !== 'object') continue;

      const updated = resetCodeRecord(record);
      await env.READ2LEAD_CODES.put(key.name, JSON.stringify(updated));
      await env.READ2LEAD_CODES.put(
        `progress:${key.name}`,
        JSON.stringify(resetProgressState(key.name, updated)),
      );
      reset += 1;
    }
  } while (cursor);

  return json({ ok: true, scanned, reset, level: START_LEVEL, level_reset_version: LEVEL_RESET_VERSION });
}

function resetCodeRecord(record) {
  const profile = record.student_profile || {};
  const progress = record.progress || {};
  return {
    ...record,
    student_profile: {
      ...profile,
      level: START_LEVEL,
    },
    progress: {
      ...progress,
      student_name: profile.student_name || progress.student_name || '',
      age: profile.age || progress.age || null,
      child_gender: profile.child_gender || progress.child_gender || '',
      current_level: START_LEVEL,
      level: START_LEVEL,
      xp: 0,
      xp_in_level: 0,
      total_xp: 0,
      unlocked_levels: [START_LEVEL],
      level_progress: { L1: 0, L2: 0, L3: 0 },
      level_reset_version: LEVEL_RESET_VERSION,
    },
  };
}

function resetProgressState(accessCode, record) {
  const profile = record.student_profile || {};
  const progress = record.progress || {};
  const now = new Date().toISOString();
  return {
    schema_version: 2,
    level_reset_version: LEVEL_RESET_VERSION,
    access_code: String(accessCode || '').trim().toUpperCase(),
    student_name: profile.student_name || progress.student_name || '',
    current_level: START_LEVEL,
    initial_level: START_LEVEL,
    unlocked_levels: [START_LEVEL],
    rank_title: 'Story Starter',
    coins: 0,
    total_xp: 0,
    xp_in_level: 0,
    xp_to_next_level: 100,
    completed_packs: 0,
    completed_pack_ids: [],
    penalized_pack_ids: [],
    level_progress: { L1: 0, L2: 0, L3: 0 },
    streak_days: 0,
    last_activity_date_vn: '',
    last_activity_at: null,
    voice_attempts: 0,
    pack_history: [],
    badges: [],
    avatar: {
      enabled: false,
      preset_id: null,
      gender: null,
      equipped: {},
    },
    created_at: now,
    updated_at: now,
  };
}
