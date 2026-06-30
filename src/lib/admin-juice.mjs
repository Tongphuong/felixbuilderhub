/**
 * Admin gamification module — confetti, sounds, emoji, and presentation mode
 * for the Felix Class Hub live coaching experience.
 * Reuses existing project libraries: canvas-confetti, lesson-juice, r2l-audio.
 */

const GOLD_COLORS = ['#ffd700', '#f2cc7e', '#c88f38'];
const DIAMOND_COLORS = ['#8fd3ff', '#c89bff', '#ffffff'];
const SUCCESS_COLORS = ['#4ade80', '#6fcf97', '#ffd700'];

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fire a directional confetti burst from a reward button location. */
export async function fireRewardCannon(xpDelta, coinsDelta) {
  if (prefersReducedMotion()) return;
  const confetti = (await import('canvas-confetti')).default;
  const colors = coinsDelta > 0 ? GOLD_COLORS : xpDelta > 0 ? SUCCESS_COLORS : ['#f87171'];
  const count = Math.min(80, 30 + Math.abs(xpDelta || 0) + Math.abs(coinsDelta || 0) * 2);
  confetti({
    particleCount: count,
    spread: 70,
    startVelocity: 32,
    origin: { y: 0.7, x: 0.5 },
    colors,
    disableForReducedMotion: true,
  });
}

/** Big celebration for level-up after a reward. */
export async function fireLevelUpConfetti() {
  if (prefersReducedMotion()) return;
  const confetti = (await import('canvas-confetti')).default;
  const end = Date.now() + 1200;
  const colors = [...GOLD_COLORS, ...DIAMOND_COLORS];

  (function frame() {
    confetti({
      particleCount: 6,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 6,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors,
      disableForReducedMotion: true,
    });
    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();
}

/** Fire a small streak burst for attendance streaks. */
export async function fireStreakBurst() {
  if (prefersReducedMotion()) return;
  const confetti = (await import('canvas-confetti')).default;
  confetti({
    particleCount: 25,
    spread: 50,
    origin: { y: 0.75, x: 0.5 },
    colors: ['#4ade80', '#6fcf97', '#ffd700'],
    disableForReducedMotion: true,
  });
}

/** Play the appropriate reward sound. */
export async function playRewardSound(kind, xpDelta = 0, coinsDelta = 0) {
  try {
    const { playSynthTone } = await import('./lesson-juice');
    if (kind === 'needs_work') {
      playSynthTone('wrong');
    } else if (coinsDelta > 0 && xpDelta > 0) {
      playSynthTone('coin');
      setTimeout(() => playSynthTone('correct'), 220);
    } else if (coinsDelta > 0) {
      playSynthTone('coin');
    } else if (xpDelta > 0) {
      playSynthTone('correct');
    } else {
      playSynthTone('correct');
    }
  } catch {
    /* optional audio */
  }
}

/** Play a level-up fanfare. */
export async function playLevelUpSound() {
  try {
    const { playSynthTone } = await import('./lesson-juice');
    playSynthTone('level-up');
  } catch {
    /* optional audio */
  }
}

/** Spawn a floating emoji burst from a DOM element. */
export function showEmojiBurst(anchorEl, emoji = '🎉') {
  if (prefersReducedMotion() || typeof document === 'undefined') return;
  const rect = anchorEl?.getBoundingClientRect?.();
  if (!rect) return;

  const el = document.createElement('span');
  el.textContent = emoji;
  el.style.cssText = `
    position: fixed;
    left: ${rect.left + rect.width / 2}px;
    top: ${rect.top}px;
    font-size: 2.5rem;
    pointer-events: none;
    z-index: 9999;
  `;
  document.body.appendChild(el);

  el.animate(
    [
      { transform: 'translate(-50%, 0) scale(0.5)', opacity: 0 },
      { transform: 'translate(-50%, -20px) scale(1.2)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -60px) scale(1)', opacity: 0.8, offset: 0.6 },
      { transform: 'translate(-50%, -100px) scale(0.8)', opacity: 0 },
    ],
    { duration: 1200, easing: 'cubic-bezier(.2,.8,.2,1)' }
  ).finished.finally(() => el.remove());
}

/** Show a floating XP/coins popup near a reward button. */
export function showXpPopup(anchorEl, text) {
  if (typeof document === 'undefined' || !anchorEl || !text) return;
  const rect = anchorEl.getBoundingClientRect();
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText = `
    position: fixed;
    left: ${rect.left + rect.width / 2}px;
    top: ${rect.top - 8}px;
    font-size: 1.1rem;
    font-weight: 700;
    color: #ffd700;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
    pointer-events: none;
    z-index: 9999;
    white-space: nowrap;
  `;
  document.body.appendChild(el);

  el.animate(
    [
      { transform: 'translate(-50%, 0) scale(0.8)', opacity: 0 },
      { transform: 'translate(-50%, -12px) scale(1)', opacity: 1 },
      { transform: 'translate(-50%, -40px) scale(1)', opacity: 0 },
    ],
    { duration: 1400, easing: 'cubic-bezier(.2,.8,.2,1)' }
  ).finished.finally(() => el.remove());
}

/** Toggle presentation mode for projector display. */
export function togglePresentationMode() {
  if (typeof document === 'undefined') return;
  const body = document.body;
  const isOn = body.dataset.presentation === 'true';
  body.dataset.presentation = isOn ? 'false' : 'true';

  // Add/remove presentation CSS if not present
  if (!document.getElementById('admin-presentation-css')) {
    const style = document.createElement('style');
    style.id = 'admin-presentation-css';
    style.textContent = `
      body[data-presentation="true"] .admin-nav,
      body[data-presentation="true"] .admin-footer,
      body[data-presentation="true"] .admin-chrome { display: none !important; }
      body[data-presentation="true"] .admin-page-title { font-size: 2.5rem !important; }
      body[data-presentation="true"] .student-card { font-size: 1.35rem !important; }
      body[data-presentation="true"] .student-card h3 { font-size: 2.5rem !important; }
      body[data-presentation="true"] .student-card .avatar-box { width: 10rem !important; height: 10rem !important; }
      body[data-presentation="true"] .student-card .reward-btn { font-size: 1.25rem !important; padding: 1rem 1.5rem !important; }
      body[data-presentation="true"] .student-card .attendance-btn { font-size: 1.15rem !important; padding: 0.75rem 1.25rem !important; }
      body[data-presentation="true"] .xp-bar { height: 0.75rem !important; }
    `;
    document.head.appendChild(style);
  }
}

/** Check if presentation mode is currently on. */
export function isPresentationMode() {
  return typeof document !== 'undefined' && document.body?.dataset.presentation === 'true';
}
