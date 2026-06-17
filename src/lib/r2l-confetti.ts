import confetti from 'canvas-confetti';

const MAX_PARTICLES = 30;
const COMBO_MAX_PARTICLES = 20;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function fireConfetti(config?: { particleCount?: number; spread?: number }): void {
  if (prefersReducedMotion()) return;
  const particleCount = Math.min(config?.particleCount ?? MAX_PARTICLES, MAX_PARTICLES);
  confetti({
    particleCount,
    spread: config?.spread ?? 60,
    origin: { y: 0.65 },
    disableForReducedMotion: true,
  });
}

export function fireCoinRain(): void {
  if (prefersReducedMotion()) return;
  const count = Math.min(COMBO_MAX_PARTICLES, MAX_PARTICLES);
  confetti({
    particleCount: count,
    spread: 100,
    startVelocity: 35,
    scalar: 1.1,
    colors: ['#FFD700', '#FFA500', '#FFE066', '#F5C542'],
    origin: { x: 0.5, y: 0 },
    gravity: 1.2,
    ticks: 200,
    disableForReducedMotion: true,
  });
}

export function fireComboFx(level: 'fire' | 'lightning' | 'rainbow'): void {
  if (prefersReducedMotion()) return;
  const colors =
    level === 'rainbow'
      ? ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff']
      : level === 'lightning'
        ? ['#fff176', '#ffeb3b', '#ffc107']
        : ['#ff7043', '#ff5722', '#ff9800'];
  confetti({
    particleCount: COMBO_MAX_PARTICLES,
    spread: 50,
    colors,
    origin: { y: 0.7 },
    disableForReducedMotion: true,
  });
}
