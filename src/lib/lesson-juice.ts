import type { PendingChest } from './lesson-result-chest';

type SynthTone = 'correct' | 'wrong' | 'coin' | 'level-up';

let nearMissTimer: number | undefined;

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

export async function playKenney(name: string): Promise<void> {
  try {
    const { play } = await import('./r2l-audio');
    await play(name);
  } catch {
    /* optional audio */
  }
}

export function showXpTicker(xpDelta: number, anchorSelector: string): void {
  if (typeof document === 'undefined' || !Number.isFinite(xpDelta) || xpDelta <= 0) return;
  const anchor = document.querySelector(anchorSelector);
  if (!anchor) return;

  const ticker = document.createElement('span');
  ticker.className = 'w2-xp-ticker';
  ticker.textContent = `+${Math.round(xpDelta)} XP`;
  ticker.setAttribute('role', 'status');
  ticker.dataset.visible = 'false';
  anchor.appendChild(ticker);
  requestAnimationFrame(() => {
    ticker.dataset.visible = 'true';
  });
  window.setTimeout(() => ticker.remove(), 1800);
}

export function showComboBadge(level: 1 | 2 | 3): void {
  if (typeof document === 'undefined') return;
  let counter = document.querySelector<HTMLElement>('.w2-combo-counter');
  if (!counter) {
    // Auto-create if Z4 component not mounted (lesson.astro doesn't include it yet)
    counter = document.createElement('aside');
    counter.className = 'w2-combo-counter';
    document.body.appendChild(counter);
  }
  const normalizedLevel = level >= 3 ? 3 : level >= 2 ? 2 : 1;
  counter.dataset.level = String(normalizedLevel);
  counter.dataset.visible = String(normalizedLevel > 1);
  counter.setAttribute('aria-hidden', String(normalizedLevel === 1));

  let badge = counter.querySelector<HTMLElement>('.w2-combo-badge');
  if (normalizedLevel > 1 && !badge) {
    badge = document.createElement('div');
    badge.className = 'w2-combo-badge';
    counter.appendChild(badge);
  }
  if (badge) badge.textContent = `x${normalizedLevel} COMBO`;
}

export async function openChest(pendingChest: PendingChest): Promise<void> {
  const { openChest: driveChest } = await import('./lesson-result-chest');
  await driveChest(pendingChest);
}

export function showNearMissBanner(text: string): void {
  if (typeof document === 'undefined' || !text) return;
  let banner = document.querySelector<HTMLElement>('.w2-nearmiss-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'w2-nearmiss-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    const message = document.createElement('span');
    message.className = 'w2-nearmiss-text';
    banner.appendChild(message);
    document.body.appendChild(banner);
  }
  const message = banner.querySelector<HTMLElement>('.w2-nearmiss-text');
  if (message) message.textContent = text;
  banner.dataset.visible = 'true';
  if (nearMissTimer) window.clearTimeout(nearMissTimer);
  nearMissTimer = window.setTimeout(() => {
    if (banner) banner.dataset.visible = 'false';
    nearMissTimer = undefined;
  }, 3000);
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem('r2l-w2-muted', muted ? '1' : '0');
  } catch {
    /* storage can be blocked */
  }
  void import('./r2l-audio')
    .then(({ setMuted: setAudioMuted }) => setAudioMuted(muted))
    .catch(() => {});
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem('r2l-w2-muted') === '1';
  } catch {
    return false;
  }
}

export async function claimDailyChest(): Promise<{ ok: boolean; reward?: { coins: number } }> {
  try {
    const response = await fetch('/api/read2lead-daily-chest-claim', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) return { ok: false };
    await playKenney('daily-chest-claim');
    return { ok: true, ...(data.reward ? { reward: data.reward } : {}) };
  } catch {
    return { ok: false };
  }
}
