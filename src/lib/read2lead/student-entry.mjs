export const STUDENT_CODE_KEY = 'r2l_access_code';
export function normalizeStudentCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^R2L-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code) && code.length <= 100 ? code : '';
}

// Who is opening the app? Explicit input always wins and never falls back to a
// remembered child. Only the bare reader address (allowRemembered) may reopen the
// child this tab already signed in as; /r2l/start and an empty form never do.
export function studentEntry(params, { allowRemembered = false, remembered = '' } = {}) {
  if (params.has('t')) return { kind: 'link', token: params.get('t') || '' };
  if (params.has('code')) return { kind: 'code', code: normalizeStudentCode(params.get('code')) };
  const code = allowRemembered ? normalizeStudentCode(remembered) : '';
  return code ? { kind: 'remembered', code } : { kind: 'manual' };
}

// Server clears the HttpOnly reader cookie(s); only then is the tab's remembered child dropped.
export async function resetStudentSession(fetcher, storage) {
  const response = await fetcher('/api/read2lead-session-reset', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  if (response.status !== 204) throw Error('student_reset_failed');
  storage.removeItem(STUDENT_CODE_KEY);
  if (storage.getItem(STUDENT_CODE_KEY)) throw Error('student_reset_failed');
}
