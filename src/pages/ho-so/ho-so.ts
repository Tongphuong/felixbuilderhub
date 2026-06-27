/**
 * Unified profile controller — code entry, role picker, view routing.
 */

const ROLE_STORAGE_PREFIX = 'r2l_profile_role:';

export type ProgressPayload = {
  ok?: boolean;
  message?: string;
  state?: string;
  progress?: Record<string, unknown>;
  read2lead_state?: Record<string, unknown>;
  story_progress?: Record<string, unknown>;
  weekly_growth?: Record<string, unknown>;
  is_test?: boolean;
  is_shared?: boolean;
};

type Role = 'kid' | 'parent';

let currentAccessCode = '';
let dashboardData: ProgressPayload | null = null;
let currentRole: Role | null = null;
let kidViewCleanup: (() => void) | null = null;

// ── DOM helpers ──

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
  const t = String(full || '').trim();
  return t ? t.split(/\s+/)[0] : 'bé';
}

// ── Role persistence ──

function savedRole(code: string): Role | null {
  try {
    const v = localStorage.getItem(ROLE_STORAGE_PREFIX + code);
    return v === 'kid' || v === 'parent' ? v : null;
  } catch {
    return null;
  }
}

function saveRole(code: string, role: Role) {
  try {
    localStorage.setItem(ROLE_STORAGE_PREFIX + code, role);
  } catch {
    /* ignore */
  }
}

function clearRole(code: string) {
  try {
    localStorage.removeItem(ROLE_STORAGE_PREFIX + code);
  } catch {
    /* ignore */
  }
}

// ── View management ──

function showEntry() {
  qs('#ho-so-entry')?.classList.remove('hidden');
  qs('#ho-so-session-bar')?.classList.add('hidden');
  qs('#ho-so-role-picker')?.classList.add('hidden');
  qs('#ho-so-dashboard')?.classList.add('hidden');
  qs('#ho-so-loading')?.classList.add('hidden');
  qs('#ho-so-error')?.classList.add('hidden');
  qs('#ho-so-role-toggle')?.classList.add('hidden');

  const input = qs<HTMLInputElement>('#ho-so-code-input');
  if (input) {
    input.value = '';
    input.focus();
  }
}

function showLoading() {
  qs('#ho-so-loading')?.classList.remove('hidden');
  qs('#ho-so-role-picker')?.classList.add('hidden');
  qs('#ho-so-dashboard')?.classList.add('hidden');
}

function hideLoading() {
  qs('#ho-so-loading')?.classList.add('hidden');
}

function showError(msg: string) {
  const el = qs('#ho-so-error');
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

function clearError() {
  const el = qs('#ho-so-error');
  if (el) {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

function showSessionBar(name: string) {
  qs('#ho-so-entry')?.classList.add('hidden');
  const bar = qs('#ho-so-session-bar');
  if (bar) bar.classList.remove('hidden');

  const nameEl = qs('#ho-so-student-name');
  if (nameEl) nameEl.textContent = firstName(name);
}

function showRolePicker() {
  qs('#ho-so-role-picker')?.classList.remove('hidden');
  qs('#ho-so-dashboard')?.classList.add('hidden');
}

function showDashboard() {
  qs('#ho-so-role-picker')?.classList.add('hidden');
  qs('#ho-so-dashboard')?.classList.remove('hidden');

  const toggle = qs('#ho-so-role-toggle');
  if (toggle) {
    toggle.classList.remove('hidden');
    toggle.textContent = currentRole === 'kid' ? 'Bố/Mẹ' : 'Con';
  }
}

// ── Role auto-detection (5-lens audit fix #1) ──

function autoDetectRole(data: ProgressPayload): Role | null {
  const state = data.read2lead_state as Record<string, unknown> | undefined;
  if (state && state.avatar_stage && state.avatar_stage !== 'egg') {
    return 'kid';
  }
  return null;
}

// ── View rendering ──

async function renderView(role: Role) {
  const previousRole = currentRole;
  if (kidViewCleanup) {
    kidViewCleanup();
    kidViewCleanup = null;
  }

  currentRole = role;
  saveRole(currentAccessCode, role);

  const main = qs('#main');
  if (main) {
    main.classList.toggle('ho-so-parent', role === 'parent');
    main.classList.toggle('r2l-kid', role === 'kid');
  }

  const dashboard = qs('#ho-so-dashboard');
  if (!dashboard || !dashboardData) return;

  showDashboard();

  if (role === 'kid') {
    const { renderKidView, cleanupKidView } = await import('./ho-so-kid-view');
    kidViewCleanup = cleanupKidView;
    renderKidView(dashboard, dashboardData, currentAccessCode);
  } else {
    const { renderParentView, invalidateParentCache } = await import('./ho-so-parent-view');
    if (previousRole === 'kid') invalidateParentCache();
    renderParentView(dashboard, dashboardData, currentAccessCode);
  }
}

// ── Code validation + load ──

async function loadProfile() {
  clearError();
  const input = qs<HTMLInputElement>('#ho-so-code-input');
  const code = (input?.value || '').trim().toUpperCase();
  if (!code) {
    showError('Vui lòng nhập mã học sinh.');
    return;
  }

  const loadBtn = qs<HTMLButtonElement>('#ho-so-load-btn');
  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Đang tải...';
  }

  showLoading();

  try {
    const res = await fetch(`/api/read2lead-progress?code=${encodeURIComponent(code)}`);
    const data = (await res.json()) as ProgressPayload;

    if (!res.ok || !data.ok) {
      hideLoading();
      showError(data.message || 'Không tìm thấy mã học sinh.');
      qs('#ho-so-entry')?.classList.remove('hidden');
      return;
    }

    currentAccessCode = code;
    dashboardData = data;

    const studentName = String(
      (data.progress as Record<string, unknown>)?.student_name || 'Bé yêu',
    );
    showSessionBar(studentName);
    hideLoading();

    const url = new URL(window.location.href);
    url.searchParams.set('code', code);
    window.history.replaceState({}, '', url);

    // Determine role: URL param > localStorage > auto-detect > show picker
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    const role =
      (urlRole === 'kid' || urlRole === 'parent' ? urlRole : null) ||
      preSelectedRole ||
      savedRole(code) ||
      autoDetectRole(data);

    if (role) {
      await renderView(role);
    } else {
      showRolePicker();
    }
  } catch {
    hideLoading();
    showError('Mạng không ổn định. Vui lòng thử lại.');
    qs('#ho-so-entry')?.classList.remove('hidden');
  } finally {
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Xem hồ sơ';
    }
  }
}

// ── Change code ──

function handleChangeCode() {
  if (kidViewCleanup) {
    kidViewCleanup();
    kidViewCleanup = null;
  }
  if (currentAccessCode) clearRole(currentAccessCode);
  currentAccessCode = '';
  dashboardData = null;
  currentRole = null;

  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('role');
  window.history.replaceState({}, '', url);

  showEntry();
}

// ── Role toggle ──

function handleRoleToggle() {
  if (!dashboardData || !currentAccessCode) return;
  const nextRole: Role = currentRole === 'kid' ? 'parent' : 'kid';
  void renderView(nextRole);
}

// ── Init ──

let preSelectedRole: Role | null = null;

function selectEntryRole(role: Role) {
  preSelectedRole = role;
  const parentBtn = qs<HTMLElement>('#ho-so-role-parent-entry');
  const kidBtn = qs<HTMLElement>('#ho-so-role-kid-entry');
  if (parentBtn) parentBtn.style.outline = role === 'parent' ? '3px solid var(--accent)' : '';
  if (kidBtn) kidBtn.style.outline = role === 'kid' ? '3px solid var(--gold)' : '';
  qs<HTMLInputElement>('#ho-so-code-input')?.focus();
}

export function initHoSo() {
  const params = new URLSearchParams(window.location.search);
  const initialCode = params.get('code');
  if (initialCode) {
    const input = qs<HTMLInputElement>('#ho-so-code-input');
    if (input) input.value = initialCode.toUpperCase();
    void loadProfile();
  }

  qs('#ho-so-role-parent-entry')?.addEventListener('click', () => selectEntryRole('parent'));
  qs('#ho-so-role-kid-entry')?.addEventListener('click', () => selectEntryRole('kid'));

  qs('#ho-so-load-btn')?.addEventListener('click', () => void loadProfile());
  qs('#ho-so-change-code')?.addEventListener('click', handleChangeCode);
  qs('#ho-so-role-toggle')?.addEventListener('click', handleRoleToggle);

  qs('#ho-so-role-kid')?.addEventListener('click', () => void renderView('kid'));
  qs('#ho-so-role-parent')?.addEventListener('click', () => void renderView('parent'));

  const input = qs<HTMLInputElement>('#ho-so-code-input');
  input?.addEventListener('paste', () => {
    setTimeout(() => {
      if (input) input.value = input.value.trim().toUpperCase();
    }, 0);
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void loadProfile();
  });
}
