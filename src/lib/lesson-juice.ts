type SynthTone = 'correct' | 'wrong' | 'coin' | 'level-up';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function playSynthTone(tone: SynthTone, muted = false) {
  if (muted || typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = 'sine';
    const toneMap: Record<SynthTone, { start: number; end: number; duration: number; volume: number }> = {
      correct: { start: 660, end: 988, duration: 0.22, volume: 0.18 },
      wrong: { start: 320, end: 220, duration: 0.2, volume: 0.14 },
      coin: { start: 880, end: 1318, duration: 0.18, volume: 0.15 },
      'level-up': { start: 523, end: 988, duration: 0.35, volume: 0.17 },
    };
    const profile = toneMap[tone];
    osc.frequency.setValueAtTime(profile.start, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(profile.end, 1), now + profile.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(profile.volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + profile.duration + 0.02);
    osc.onended = () => {
      ctx.close().catch(() => {});
    };
  } catch {
    /* optional juice */
  }
}

export async function fireStreakConfetti() {
  if (prefersReducedMotion()) return;
  const confetti = (await import('canvas-confetti')).default;
  confetti({
    particleCount: 45,
    spread: 60,
    origin: { y: 0.72 },
    colors: ['#ffd700', '#4ade80', '#ffffff'],
  });
}

export async function fireLessonPassConfetti() {
  if (prefersReducedMotion()) return;
  const confetti = (await import('canvas-confetti')).default;
  confetti({
    particleCount: 90,
    spread: 85,
    startVelocity: 36,
    origin: { y: 0.6 },
    colors: ['#ffd700', '#4ade80', '#5b8def', '#ffffff'],
  });
}
