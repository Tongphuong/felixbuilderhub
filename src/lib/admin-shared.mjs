/**
 * Shared admin utilities — used by codes.astro and classes.astro.
 * Extracted from the duplicated inline code in the original monolithic codes.astro.
 */

/** HTML-escape a string for safe template-literal injection. */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

/** Format ISO date to dd/mm/yyyy in Vietnamese locale. */
export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** Human-readable file size. */
export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format a signed number with + prefix for positive values. */
export function signed(value, suffix = '') {
  const n = Number(value) || 0;
  if (!n) return '';
  return `${n > 0 ? '+' : ''}${n}${suffix}`;
}

/** Format a preset's diamond/coins delta as a readable string. */
export function presetText(preset) {
  const parts = [
    signed(preset.diamond_delta ?? preset.xp_delta, ' 💎'),
    signed(preset.coins_delta, ' 🪙'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'ghi nhận';
}

/** Test account level options. */
export const TEST_LEVELS = [
  ['L0', 'L0 · Mầm non'],
  ['L1', 'L1 · Đồng'],
  ['L2', 'L2 · Bạc'],
  ['L3', 'L3 · Vàng'],
  ['L4', 'L4 · Kim cương'],
  ['L5', 'L5 · Huyền thoại'],
];

/** Gifts above this many diamonds need an explicit admin confirm. */
export const DIAMOND_CONFIRM_THRESHOLD = 10000;

/**
 * Confirm text for a big diamond gift, or null when no confirm is needed
 * (amount at or below the threshold; negatives are never confirmed).
 */
export function bigDiamondConfirmMessage(diamonds, studentName) {
  const n = Number(diamonds);
  if (!Number.isFinite(n) || n <= DIAMOND_CONFIRM_THRESHOLD) return null;
  const formatted = new Intl.NumberFormat('vi-VN').format(n);
  return `Tặng ${formatted} 💎 cho ${studentName}?`;
}
