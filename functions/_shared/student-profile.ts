export type ProfilePatch = {
  student_id?: string;
  display_name?: string;
  parent_name?: string | null;
  email?: string | null;
  phone?: string | null;
  cefr_level?: string | null;
  status?: string;
  goals?: string[];
  notes?: string | null;
  metadata?: Record<string, unknown>;
};
type ProfileCreate = ProfilePatch & { student_id: string; display_name: string };
type ProfileRow = Record<string, unknown>;
type WriteResult = { meta?: { changes?: number }; changes?: number };
type ProfileStatement = {
  bind(...values: unknown[]): ProfileStatement;
  first(): Promise<ProfileRow | null>;
  run(): Promise<WriteResult>;
};
export type ProfileDatabase = { prepare(sql: string): ProfileStatement };
export type ProfileEnvironment = {
  STUDENT_PROFILE_API_TOKEN?: unknown;
  STUDENT_PROFILE_DB?: ProfileDatabase;
  DB?: ProfileDatabase;
};
export type ResponseResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; response: Response };
type ValidationResult<T> = { ok: true; profile: T } | { ok: false; errors: string[] };

const PROFILE_STATUSES = new Set(['active', 'paused', 'archived']);
const CEFR_LEVELS = new Set(['pre_a1', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
const MAX_TEXT_LENGTH = 2000;
const MAX_SHORT_TEXT_LENGTH = 160;
const MAX_GOALS = 12;

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export function checkTokenAuth(request: Request, env: ProfileEnvironment): ResponseResult {
  const expected = String(env.STUDENT_PROFILE_API_TOKEN || '').trim();
  if (!expected) {
    return { ok: false, response: json({ ok: false, error: 'config_error' }, 500) };
  }

  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  const headerToken = request.headers.get('X-Student-Profile-Token') || '';
  const provided = bearer || headerToken.trim();

  if (!provided || provided !== expected) {
    return { ok: false, response: json({ ok: false, error: 'unauthorized' }, 401) };
  }

  return { ok: true };
}

export function getStudentProfileDb(env: ProfileEnvironment) {
  const db = env.STUDENT_PROFILE_DB || env.DB;
  if (!db) {
    return null;
  }
  return db;
}

export async function readJson(request: Request): Promise<ResponseResult<{ body: Record<string, unknown> }>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, response: json({ ok: false, error: 'invalid_json' }, 400) };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, response: json({ ok: false, error: 'invalid_json' }, 400) };
  }
}

export function cleanStudentId(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

export function validateStudentId(value: unknown): { ok: true; studentId: string } | { ok: false; error: string } {
  const studentId = cleanStudentId(value);
  if (!studentId || studentId.length > 64 || !/^[A-Z0-9][A-Z0-9_-]*$/.test(studentId)) {
    return { ok: false, error: 'invalid_student_id' };
  }
  return { ok: true, studentId };
}

export function validateProfilePayload(body: Record<string, unknown>, options: { requireStudentId: true }): ValidationResult<ProfileCreate>;
export function validateProfilePayload(body: Record<string, unknown>, options?: { requireStudentId?: boolean }): ValidationResult<ProfilePatch>;
export function validateProfilePayload(body: Record<string, unknown>, { requireStudentId = false } = {}): ValidationResult<ProfilePatch> {
  const errors = [];
  const profile: ProfilePatch = {};

  if (requireStudentId || body.student_id !== undefined) {
    const checked = validateStudentId(body.student_id);
    if (!checked.ok) {
      errors.push(checked.error);
    } else {
      profile.student_id = checked.studentId;
    }
  }

  if (requireStudentId && body.display_name === undefined) {
    errors.push('missing_display_name');
  }

  if (body.display_name !== undefined) {
    const displayName = cleanText(body.display_name, MAX_SHORT_TEXT_LENGTH);
    if (!displayName) {
      errors.push('invalid_display_name');
    } else {
      profile.display_name = displayName;
    }
  }

  if (body.parent_name !== undefined) {
    profile.parent_name = nullableText(body.parent_name, MAX_SHORT_TEXT_LENGTH);
  }

  if (body.email !== undefined) {
    const email = nullableText(body.email, MAX_SHORT_TEXT_LENGTH);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('invalid_email');
    } else {
      profile.email = email;
    }
  }

  if (body.phone !== undefined) {
    profile.phone = nullableText(body.phone, 64);
  }

  if (body.cefr_level !== undefined) {
    const level = String(body.cefr_level || '').trim().toLowerCase();
    if (level && !CEFR_LEVELS.has(level)) {
      errors.push('invalid_cefr_level');
    } else {
      profile.cefr_level = level || null;
    }
  }

  if (body.status !== undefined) {
    const status = String(body.status || '').trim().toLowerCase();
    if (!PROFILE_STATUSES.has(status)) {
      errors.push('invalid_status');
    } else {
      profile.status = status;
    }
  }

  if (body.goals !== undefined) {
    if (!Array.isArray(body.goals) || body.goals.length > MAX_GOALS) {
      errors.push('invalid_goals');
    } else {
      profile.goals = body.goals
        .map((goal) => cleanText(goal, MAX_SHORT_TEXT_LENGTH))
        .filter(Boolean);
    }
  }

  if (body.notes !== undefined) {
    profile.notes = nullableText(body.notes, MAX_TEXT_LENGTH);
  }

  if (body.metadata !== undefined) {
    if (!isPlainObject(body.metadata)) {
      errors.push('invalid_metadata');
    } else {
      profile.metadata = body.metadata;
    }
  }

  if (!requireStudentId && Object.keys(profile).length === 0) {
    errors.push('empty_payload');
  }

  return errors.length ? { ok: false, errors } : { ok: true, profile };
}

export function serializeProfile(profile: ProfileRow | null | undefined) {
  if (!profile) return null;
  return {
    ...profile,
    goals: parseJsonField(profile.goals, []),
    metadata: parseJsonField(profile.metadata, {}),
  };
}

export async function findStudentProfile(db: ProfileDatabase, studentId: string) {
  const row = await db
    .prepare(
      `SELECT student_id, display_name, parent_name, email, phone, cefr_level, status, goals, notes, metadata, created_at, updated_at, deleted_at
       FROM student_profiles
       WHERE student_id = ? AND deleted_at IS NULL`,
    )
    .bind(studentId)
    .first();
  return serializeProfile(row);
}

export async function createStudentProfile(db: ProfileDatabase, profile: ProfileCreate, now: string) {
  await db
    .prepare(
      `INSERT INTO student_profiles (
        student_id, display_name, parent_name, email, phone, cefr_level, status, goals, notes, metadata, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      profile.student_id,
      profile.display_name,
      profile.parent_name ?? null,
      profile.email ?? null,
      profile.phone ?? null,
      profile.cefr_level ?? null,
      profile.status ?? 'active',
      JSON.stringify(profile.goals ?? []),
      profile.notes ?? null,
      JSON.stringify(profile.metadata ?? {}),
      now,
      now,
    )
    .run();
  return findStudentProfile(db, profile.student_id);
}

export async function updateStudentProfile(db: ProfileDatabase, studentId: string, profile: ProfilePatch, now: string) {
  const updates = [];
  const values = [];
  const fields = [
    'display_name',
    'parent_name',
    'email',
    'phone',
    'cefr_level',
    'status',
    'notes',
  ] as const;

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(profile, field)) {
      updates.push(`${field} = ?`);
      values.push(profile[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(profile, 'goals')) {
    updates.push('goals = ?');
    values.push(JSON.stringify(profile.goals ?? []));
  }
  if (Object.prototype.hasOwnProperty.call(profile, 'metadata')) {
    updates.push('metadata = ?');
    values.push(JSON.stringify(profile.metadata ?? {}));
  }

  if (!updates.length) {
    return findStudentProfile(db, studentId);
  }

  updates.push('updated_at = ?');
  values.push(now, studentId);

  const result = await db
    .prepare(
      `UPDATE student_profiles
       SET ${updates.join(', ')}
       WHERE student_id = ? AND deleted_at IS NULL`,
    )
    .bind(...values)
    .run();

  if (!rowChanged(result)) {
    return null;
  }

  return findStudentProfile(db, studentId);
}

export async function archiveStudentProfile(db: ProfileDatabase, studentId: string, now: string) {
  const result = await db
    .prepare(
      `UPDATE student_profiles
       SET status = 'archived', deleted_at = ?, updated_at = ?
       WHERE student_id = ? AND deleted_at IS NULL`,
    )
    .bind(now, now, studentId)
    .run();

  return rowChanged(result);
}

function rowChanged(result: WriteResult | null | undefined) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
}

function cleanText(value: unknown, maxLength: number) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) return '';
  return text;
}

function nullableText(value: unknown, maxLength: number) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonField(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
