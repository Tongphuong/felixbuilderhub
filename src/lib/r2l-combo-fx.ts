import { playFx, type SfxName } from './r2l-howler';

const SHAKE_CLASS: Record<'light' | 'medium' | 'heavy', string> = {
  light: 'r2l-shake-light',
  medium: 'r2l-shake-medium',
  heavy: 'r2l-shake-heavy',
};

const SHAKE_MS: Record<'light' | 'medium' | 'heavy', number> = {
  light: 100,
  medium: 200,
  heavy: 300,
};

const COMBO_SFX: Record<'fire' | 'lightning' | 'rainbow', SfxName> = {
  fire: 'combo_fire',
  lightning: 'combo_lightning',
  rainbow: 'combo_rainbow',
};

const COMBO_EMOJI: Record<'fire' | 'lightning' | 'rainbow', string> = {
  fire: '🔥',
  lightning: '⚡',
  rainbow: '🌈',
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getRoot(): HTMLElement | null {
  return document.getElementById('lesson-shell');
}

export function shakeScreen(intensity: 'light' | 'medium' | 'heavy'): void {
  if (prefersReducedMotion()) return;
  const root = getRoot();
  if (!root) return;
  const cls = SHAKE_CLASS[intensity];
  root.classList.remove('r2l-shake-light', 'r2l-shake-medium', 'r2l-shake-heavy');
  root.classList.add(cls);
  window.setTimeout(() => root.classList.remove(cls), SHAKE_MS[intensity]);
}

export function showComboLevel(level: 'fire' | 'lightning' | 'rainbow'): void {
  if (prefersReducedMotion()) return;
  const overlay = document.getElementById('r2l-combo-level-overlay');
  if (!overlay) return;
  overlay.textContent = COMBO_EMOJI[level];
  overlay.dataset.show = 'true';
  playFx(COMBO_SFX[level]);
  window.setTimeout(() => {
    overlay.dataset.show = 'false';
  }, 1500);
}

export function showBadgeToast(badgeName: string, iconPath: string): void {
  const toast = document.getElementById('r2l-badge-toast');
  if (!toast) return;
  const icon = toast.querySelector('[data-badge-icon]') as HTMLImageElement | null;
  const label = toast.querySelector('[data-badge-name]');
  if (icon) {
    icon.src = iconPath;
    icon.alt = badgeName;
  }
  if (label) label.textContent = badgeName;
  toast.dataset.show = 'true';
  playFx('badge_unlock');
  window.setTimeout(() => {
    toast.dataset.show = 'false';
  }, 3000);
}
