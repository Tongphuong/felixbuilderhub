import { isW1Enabled } from '../config/flags';
import { bindRankUpModalClose } from '../lib/rank-up-celebration';

const KID_BTN: Record<string, string> = {
  primary: 'r2l-kid-btn r2l-kid-btn--primary r2l-kid-btn--md',
  ghost: 'r2l-kid-btn r2l-kid-btn--ghost r2l-kid-btn--md',
  danger: 'r2l-kid-btn r2l-kid-btn--danger r2l-kid-btn--md',
};

/** Client bootstrap: apply r2l-kid shell when ?w1=1 or env flag (after SSR). */
export function applyW1PageShell(mainId = 'main'): void {
  if (!isW1Enabled()) return;

  bindRankUpModalClose();

  const main = document.getElementById(mainId);
  if (main) {
    main.classList.add('r2l-kid');
    main.classList.remove('bg-navy-950', 'bg-navy-900');
  }

  const legacyHeader = document.querySelector('[data-r2l-legacy-header]');
  if (legacyHeader?.getAttribute('data-r2l-header-kid-slot') === '1') {
    const kidHeader = document.querySelector('[data-r2l-kid-header]');
    if (kidHeader instanceof HTMLElement) kidHeader.hidden = false;
    if (legacyHeader instanceof HTMLElement) legacyHeader.hidden = true;
  }
}

/** Upgrade legacy controls marked with data-r2l-kid-upgrade when ?w1=1 without SSR kid markup. */
export function upgradeKidControls(root: ParentNode | null): void {
  if (!isW1Enabled() || !root) return;
  root.querySelectorAll<HTMLElement>('[data-r2l-kid-upgrade]').forEach((el) => {
    const variant = el.getAttribute('data-r2l-kid-upgrade') || 'primary';
    el.className = `${KID_BTN[variant] || KID_BTN.primary} ${el.className}`.trim();
    if (el.tagName === 'INPUT') el.classList.add('r2l-kid-input');
  });
  root.querySelectorAll<HTMLElement>('[data-r2l-kid-card]').forEach((el) => {
    el.classList.add('r2l-kid-card');
  });
}
