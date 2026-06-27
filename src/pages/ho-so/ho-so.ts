/** Unified profile controller — code entry, role routing, errors, and history. */

const ROLE_STORAGE_PREFIX = 'r2l_profile_role:';
const CODE_PATTERN = /^R2L-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export type SkillQuality = {
  window_days?: number;
  skills?: Array<{ key: string; label_vi: string; emoji: string; score_percent: number | null; sample_count: number }>;
};

export type ProgressPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  state?: string;
  progress?: Record<string, unknown>;
  read2lead_state?: Record<string, unknown>;
  story_progress?: Record<string, unknown>;
  weekly_growth?: Record<string, unknown>;
  skill_quality?: SkillQuality;
  is_test?: boolean;
  is_shared?: boolean;
};

type Role = 'kid' | 'parent';

let currentAccessCode = '';
let dashboardData: ProgressPayload | null = null;
let currentRole: Role | null = null;
let selectedEntryRole: Role = 'kid';
let entryRoleTouched = false;
let kidViewCleanup: (() => void) | null = null;
let loading = false;

export function qs<T extends Element = Element>(sel: string, root: ParentNode = document) {
  return root.querySelector<T>(sel);
}

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function firstName(full: string) {
  const text = String(full || '').trim();
  return text ? text.split(/\s+/)[0] : 'bé';
}

function savedRole(code: string): Role | null {
  try {
    const value = localStorage.getItem(ROLE_STORAGE_PREFIX + code);
    return value === 'kid' || value === 'parent' ? value : null;
  } catch { return null; }
}

function saveRole(code: string, role: Role) {
  try { localStorage.setItem(ROLE_STORAGE_PREFIX + code, role); } catch { /* optional */ }
}

function clearRole(code: string) {
  try { localStorage.removeItem(ROLE_STORAGE_PREFIX + code); } catch { /* optional */ }
}

function setVisibleState(state: 'entry' | 'loading' | 'kid' | 'parent') {
  qs('#ho-so-entry')?.classList.toggle('hidden', state !== 'entry');
  qs('#ho-so-loading')?.classList.toggle('hidden', state !== 'loading');
  qs('#ho-so-kid')?.classList.toggle('hidden', state !== 'kid');
  qs('#ho-so-parent')?.classList.toggle('hidden', state !== 'parent');
}

function setEntryError(message = '') {
  const error = qs<HTMLElement>('#ho-so-entry-error');
  if (!error) return;
  error.textContent = message;
  error.classList.toggle('hidden', !message);
}

function setGlobalError(message = '') {
  const root = qs<HTMLElement>('#ho-so-error');
  const text = qs<HTMLElement>('[data-ho-so-error-message]', root || document);
  if (text) text.textContent = message;
  root?.classList.toggle('hidden', !message);
}

function updateUrl(code: string, role: Role | null) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('code', code);
  else url.searchParams.delete('code');
  if (role) url.searchParams.set('role', role);
  else url.searchParams.delete('role');
  window.history.replaceState({}, '', url);
}

function setEntryRole(role: Role, focusInput = true) {
  selectedEntryRole = role;
  if (focusInput) entryRoleTouched = true;
  document.querySelectorAll<HTMLElement>('[data-role]').forEach((button) => {
    const selected = button.dataset.role === role;
    button.dataset.selected = String(selected);
    button.setAttribute('aria-checked', String(selected));
  });
  if (focusInput) qs<HTMLInputElement>('#ho-so-code-input')?.focus();
}

function showEntry() {
  if (kidViewCleanup) { kidViewCleanup(); kidViewCleanup = null; }
  setGlobalError();
  setEntryError();
  setVisibleState('entry');
  qs<HTMLInputElement>('#ho-so-code-input')?.focus();
}

async function renderView(role: Role) {
  if (!dashboardData || !currentAccessCode) return;
  const previousRole = currentRole;
  if (kidViewCleanup) { kidViewCleanup(); kidViewCleanup = null; }
  currentRole = role;
  saveRole(currentAccessCode, role);
  updateUrl(currentAccessCode, role);
  setGlobalError();
  setVisibleState(role);

  if (role === 'kid') {
    const { renderKidView, cleanupKidView } = await import('./ho-so-kid-view');
    kidViewCleanup = cleanupKidView;
    renderKidView(qs('#ho-so-kid')!, dashboardData, currentAccessCode);
  } else {
    const { renderParentView, invalidateParentCache } = await import('./ho-so-parent-view');
    if (previousRole === 'kid') invalidateParentCache();
    await renderParentView(qs('#ho-so-parent')!, dashboardData, currentAccessCode);
  }
}

function profileErrorMessage(error: string | undefined, fallback: string | undefined) {
  if (error === 'code_not_found') return 'Felix chưa tìm thấy mã này. Nếu mới đăng kí, đợi 24h hoặc nhắn Zalo Felix.';
  if (error === 'rate_limited') return fallback || 'Bạn thử lại sau ít phút nhé.';
  return fallback || 'Chưa tải được hồ sơ. Vui lòng thử lại.';
}

async function loadProfile() {
  if (loading) return;
  const input = qs<HTMLInputElement>('#ho-so-code-input');
  const code = String(input?.value || currentAccessCode).trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    setVisibleState('entry');
    setEntryError('Mã không đúng định dạng. Kiểm tra lại trong tin nhắn Zalo của Felix.');
    input?.focus();
    return;
  }

  loading = true;
  setEntryError();
  setGlobalError();
  setVisibleState('loading');
  const button = qs<HTMLButtonElement>('#ho-so-load-btn');
  if (button) { button.disabled = true; button.textContent = 'Đang tải...'; }

  try {
    const response = await fetch(`/api/read2lead-progress?code=${encodeURIComponent(code)}`);
    const data = (await response.json()) as ProgressPayload;
    if (!response.ok || !data.ok) {
      currentAccessCode = '';
      dashboardData = null;
      setVisibleState('entry');
      setEntryError(profileErrorMessage(data.error, data.message));
      return;
    }

    currentAccessCode = code;
    dashboardData = data;
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    const role = (urlRole === 'kid' || urlRole === 'parent' ? urlRole : null)
      || (entryRoleTouched ? selectedEntryRole : null)
      || savedRole(code)
      || selectedEntryRole;
    await renderView(role);
  } catch {
    if (dashboardData && currentRole) {
      setVisibleState(currentRole);
      setGlobalError('Mất kết nối. Thử lại ↻');
    } else {
      setVisibleState('entry');
      setEntryError('Mất kết nối. Kiểm tra mạng rồi thử lại.');
    }
  } finally {
    loading = false;
    if (button) { button.disabled = false; button.textContent = 'Xem hồ sơ →'; }
  }
}

function handleChangeCode() {
  if (currentAccessCode) clearRole(currentAccessCode);
  if (kidViewCleanup) { kidViewCleanup(); kidViewCleanup = null; }
  currentAccessCode = '';
  dashboardData = null;
  currentRole = null;
  updateUrl('', null);
  const input = qs<HTMLInputElement>('#ho-so-code-input');
  if (input) input.value = '';
  showEntry();
}

function bindDelegatedActions() {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (target?.closest('[data-ho-so-change-code]')) handleChangeCode();
    const switchButton = target?.closest<HTMLElement>('[data-ho-so-switch-role]');
    if (switchButton && dashboardData) void renderView(currentRole === 'kid' ? 'parent' : 'kid');
    if (target?.closest('[data-ho-so-print]')) window.print();
  });
}

export function initHoSo() {
  const params = new URLSearchParams(window.location.search);
  const requestedRole = params.get('role');
  setEntryRole(requestedRole === 'parent' ? 'parent' : 'kid', false);

  qs('#ho-so-role-parent-entry')?.addEventListener('click', () => setEntryRole('parent'));
  qs('#ho-so-role-kid-entry')?.addEventListener('click', () => setEntryRole('kid'));
  qs('#ho-so-load-btn')?.addEventListener('click', () => void loadProfile());
  qs('#ho-so-retry')?.addEventListener('click', () => void loadProfile());
  bindDelegatedActions();

  const input = qs<HTMLInputElement>('#ho-so-code-input');
  input?.addEventListener('input', () => { input.value = input.value.toUpperCase(); setEntryError(); });
  input?.addEventListener('keydown', (event) => { if (event.key === 'Enter') void loadProfile(); });

  window.addEventListener('popstate', () => window.location.reload());
  const initialCode = String(params.get('code') || '').trim().toUpperCase();
  if (initialCode && input) { input.value = initialCode; void loadProfile(); }
  else showEntry();
}
