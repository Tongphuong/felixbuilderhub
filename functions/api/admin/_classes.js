import {
  loadProgressState,
  publicProgressState,
  saveProgressState,
} from '../_read2lead-v2-state.js';

export const CLASS_STORE_KEY = 'admin:classes:v1';
export const DEFAULT_CLASS_NAME = 'Felix coaching group';

export const DEFAULT_POSITIVE_PRESETS = [
  { id: 'brave_speaking', label: 'Can đảm nói', diamond_delta: 10, coins_delta: 5, kind: 'positive' },
  { id: 'focus', label: 'Tập trung tốt', diamond_delta: 5, coins_delta: 0, kind: 'positive' },
  { id: 'full_sentence', label: 'Câu đầy đủ', diamond_delta: 10, coins_delta: 0, kind: 'positive' },
  { id: 'pronunciation', label: 'Phát âm tốt', diamond_delta: 10, coins_delta: 0, kind: 'positive' },
  { id: 'help_friend', label: 'Giúp bạn', diamond_delta: 0, coins_delta: 5, kind: 'positive' },
  { id: 'homework', label: 'Làm bài về nhà', diamond_delta: 15, coins_delta: 10, kind: 'positive' },
];

export const DEFAULT_NEEDS_WORK_PRESETS = [
  { id: 'forgot_homework', label: 'Quên bài', diamond_delta: -5, coins_delta: 0, kind: 'needs_work' },
  { id: 'distracted', label: 'Mất tập trung', diamond_delta: -5, coins_delta: 0, kind: 'needs_work' },
  { id: 'late', label: 'Đi trễ', diamond_delta: -3, coins_delta: 0, kind: 'needs_work' },
  { id: 'practice_more', label: 'Cần luyện thêm', diamond_delta: 0, coins_delta: 0, kind: 'needs_work' },
];

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function classKv(env) {
  return env.READ2LEAD_CODES || env.READ2LEAD_PROGRESS || null;
}

export function todayVN() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function cleanId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function makeClassId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `class-${Date.now().toString(36)}-${rand}`;
}

function normalizePreset(raw, fallback, index) {
  const base = fallback || {};
  const label = String(raw?.label || base.label || '').trim().slice(0, 40);
  if (!label) return null;
  const kind = raw?.kind === 'needs_work' || base.kind === 'needs_work' ? 'needs_work' : 'positive';
  const fallbackId = cleanId(base.id || label) || `${kind}-${index + 1}`;
  return {
    id: cleanId(raw?.id || fallbackId) || fallbackId,
    label,
    // Migrate from legacy xp_delta to diamond_delta; fall back to 0 for new presets.
    diamond_delta: clampDelta(raw?.diamond_delta ?? base.diamond_delta ?? raw?.xp_delta ?? 0),
    coins_delta: clampDelta(raw?.coins_delta ?? base.coins_delta ?? 0),
    kind,
  };
}

export function normalizePresets(raw, defaults) {
  const source = Array.isArray(raw) && raw.length ? raw : defaults;
  return source
    .slice(0, 12)
    .map((preset, index) => normalizePreset(preset, defaults[index], index))
    .filter(Boolean);
}

function normalizeAttendance(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [date, rows] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !rows || typeof rows !== 'object') continue;
    out[date] = {};
    for (const [code, status] of Object.entries(rows)) {
      const cleanCode = normalizeCode(code);
      if (!cleanCode) continue;
      if (status === 'present' || status === 'absent') out[date][cleanCode] = status;
    }
  }
  return out;
}

export function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function normalizeClass(raw = {}, index = 0) {
  const now = new Date().toISOString();
  const studentCodes = Array.isArray(raw.student_codes)
    ? Array.from(new Set(raw.student_codes.map(normalizeCode).filter(Boolean))).slice(0, 40)
    : [];
  return {
    id: cleanId(raw.id) || makeClassId(),
    name: String(raw.name || DEFAULT_CLASS_NAME).trim().slice(0, 80) || DEFAULT_CLASS_NAME,
    student_codes: studentCodes,
    positive_presets: normalizePresets(raw.positive_presets, DEFAULT_POSITIVE_PRESETS),
    needs_work_presets: normalizePresets(raw.needs_work_presets, DEFAULT_NEEDS_WORK_PRESETS),
    attendance_by_date: normalizeAttendance(raw.attendance_by_date),
    created_at: raw.created_at || now,
    updated_at: raw.updated_at || now,
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
  };
}

export async function loadClassStore(env) {
  const kv = classKv(env);
  if (!kv) throw new Error('READ2LEAD_CODES binding missing');
  const raw = await kv.get(CLASS_STORE_KEY, { type: 'json' });
  const classes = Array.isArray(raw?.classes) ? raw.classes : [];
  return {
    schema_version: 1,
    classes: classes.map(normalizeClass),
  };
}

export async function saveClassStore(env, store) {
  const kv = classKv(env);
  if (!kv) throw new Error('READ2LEAD_CODES binding missing');
  const next = {
    schema_version: 1,
    classes: (Array.isArray(store.classes) ? store.classes : []).map(normalizeClass),
    updated_at: new Date().toISOString(),
  };
  await kv.put(CLASS_STORE_KEY, JSON.stringify(next));
  return next;
}

export function findClass(store, id) {
  const clean = cleanId(id);
  return (store.classes || []).find((klass) => klass.id === clean) || null;
}

export function codeAssignedElsewhere(store, code, classId = '') {
  const cleanCode = normalizeCode(code);
  return (store.classes || []).find(
    (klass) => klass.id !== classId && klass.student_codes.includes(cleanCode),
  ) || null;
}

export async function codeExists(env, code) {
  const kv = classKv(env);
  if (!kv) throw new Error('READ2LEAD_CODES binding missing');
  const cleanCode = normalizeCode(code);
  if (!cleanCode) return false;
  return Boolean(await kv.get(cleanCode, { type: 'json' }));
}

function attendanceStreak(attendanceByDate, code) {
  const cleanCode = normalizeCode(code);
  const dates = Object.keys(attendanceByDate || {}).sort().reverse();
  let streak = 0;
  for (const date of dates) {
    const status = attendanceByDate?.[date]?.[cleanCode];
    if (status === 'present') streak += 1;
    else if (status === 'absent') break;
  }
  return streak;
}

export async function enrichClass(env, klass) {
  const kv = classKv(env);
  const today = todayVN();
  const students = [];
  for (const code of klass.student_codes) {
    const codeData = await kv.get(code, { type: 'json' });
    if (!codeData) {
      students.push({
        code,
        missing: true,
        student_name: '',
        age: null,
        attendance_today: klass.attendance_by_date?.[today]?.[code] || null,
      });
      continue;
    }
    const state = await loadProgressState(env, code, codeData);
    const publicState = publicProgressState(state);
    const profile = codeData.student_profile || {};
    students.push({
      code,
      missing: false,
      student_name: publicState.student_name || profile.student_name || codeData.progress?.student_name || '',
      age: profile.age ?? codeData.progress?.age ?? null,
      attendance_today: klass.attendance_by_date?.[today]?.[code] || null,
      class_attendance_streak: attendanceStreak(klass.attendance_by_date, code),
      read2lead_state: publicState,
    });
  }
  return {
    ...klass,
    today,
    students,
  };
}

function clampDelta(value) {
  const parsed = Math.trunc(Number(value) || 0);
  return Math.max(-500, Math.min(500, parsed));
}

export function applyManualReward(state, { diamondDelta = 0, coinsDelta = 0 } = {}) {
  const diamondChange = clampDelta(diamondDelta);
  let coinChange = clampDelta(coinsDelta);
  const startedRankPoints = state.rank_points;

  // Diamonds are a coaching-only currency — they do NOT affect XP, level
  // progression, or rank points. This isolates coaching rewards from the
  // reading level system so kids who attend lots of coaching don't
  // artificially inflate their reading level.
  const diamonds = Math.max(0, (Number(state.diamonds) || 0) + diamondChange);

  const coins = Math.max(0, (Number(state.coins) || 0) + coinChange);
  coinChange = coins - (Number(state.coins) || 0);
  return {
    ...state,
    coins,
    diamonds,
    ...(startedRankPoints !== undefined ? { rank_points: startedRankPoints } : {}),
    last_manual_reward_at: new Date().toISOString(),
  };
}

export async function rewardStudent(env, code, reward) {
  const cleanCode = normalizeCode(code);
  const kv = classKv(env);
  const codeData = await kv.get(cleanCode, { type: 'json' });
  if (!codeData) return { error: 'code_not_found' };
  const state = await loadProgressState(env, cleanCode, codeData);
  const beforeRankPoints = state.rank_points;
  const nextState = applyManualReward(state, reward);
  const saved = await saveProgressState(env, cleanCode, nextState);
  return {
    ok: true,
    code: cleanCode,
    applied: {
      diamond_delta: Number(saved.diamonds || 0) - Number(state.diamonds || 0),
      coins_delta: Number(saved.coins || 0) - Number(state.coins || 0),
    },
    rank_points_unchanged: beforeRankPoints === saved.rank_points,
    read2lead_state: publicProgressState(saved),
  };
}
