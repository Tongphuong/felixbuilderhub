// Shared Read2Lead access-code generation + record-shape logic.
//
// Extracted from functions/api/admin/codes.js (R2L-OPEN-ACCESS packet) so the
// admin endpoint and the public self-serve signup endpoint (functions/api/signup.js)
// share ONE source of truth for what a code record looks like. Admin behavior is
// unchanged by this extraction — admin/codes.js calls the exact same functions it
// used to define locally.

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function randomChars(n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

function codeNamePart(studentName) {
  const ascii = studentName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[Đđ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

  return ascii.slice(0, 10);
}

export async function generateUniqueCodeForName(kv, studentName) {
  const month = MONTH_CODES[new Date().getUTCMonth()];
  const namePart = codeNamePart(studentName) || month;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = `R2L-${namePart}-${randomChars(4)}`;
    const exists = await kv.get(code);
    if (!exists) return code;
  }
  throw new Error('Could not generate unique code after 6 attempts');
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

export function boolFromFormValue(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

/**
 * Build the exact code-record shape admin/codes.js has always written.
 *
 * `origin` is the one new, additive field this packet introduces (R2L-OPEN-ACCESS):
 * self-serve signups pass `origin: 'self_serve'`; admin never passes it, so
 * `record.origin` stays `undefined` there and JSON.stringify drops the key —
 * admin-created records serialize byte-identically to before this extraction.
 */
export function buildCodeRecord({
  parent_name = '',
  parent_zalo = '',
  notes = '',
  student_name,
  student_age,
  child_gender,
  uses_total,
  expiry_days,
  is_test = false,
  is_shared = false,
  origin,
} = {}) {
  const record = {
    parent_name,
    parent_zalo,
    notes,
    student_profile: {
      student_name,
      age: student_age,
      level: 'L1',
      child_gender,
    },
    progress: {
      student_name,
      age: student_age,
      child_gender,
      current_level: 'L1',
      rank_title: 'Đồng',
      rank_asset_url: '/assets/r2l/ranks/rank-l1-bronze.svg',
      badges: [],
      packs_created: 0,
      current_pack: null,
      review_history: [],
    },
    issued_at: todayISO(),
    expires_at: addDaysISO(expiry_days),
    uses_total,
    uses_remaining: uses_total,
    last_used_at: null,
    is_test,
    is_shared,
  };
  if (origin) record.origin = origin;
  return record;
}
