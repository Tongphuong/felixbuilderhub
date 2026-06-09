import type { RankLadderView } from './rank-ladder-ui';

type RankUpPayload = {
  changed: boolean;
  from_label: string;
  to_label: string;
  tier_changed: boolean;
};

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export async function fireRankUpConfetti(ladder: RankLadderView | undefined, tierChanged: boolean) {
  if (prefersReducedMotion()) return;
  const confetti = (await import('canvas-confetti')).default;
  const color = ladder?.tier_color || '#ffd700';
  if (tierChanged) {
    confetti({
      particleCount: 120,
      spread: 100,
      startVelocity: 42,
      origin: { y: 0.62 },
      colors: [color, '#ffffff', '#ffd700'],
      ticks: 220,
    });
    window.setTimeout(() => {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.55 },
        colors: [color, '#ffffff'],
      });
    }, 280);
    return;
  }
  confetti({
    particleCount: 60,
    spread: 70,
    origin: { y: 0.65 },
    colors: [color, '#ffffff'],
  });
}

export function showRankUpModal(rankUp: RankUpPayload, ladder?: RankLadderView) {
  if (!rankUp?.changed) return;
  const modal = document.getElementById('rank-up-modal');
  const labelEl = document.getElementById('rank-up-label');
  const copyEl = document.getElementById('rank-up-minny-copy');
  if (!modal || !labelEl || !copyEl) return;

  labelEl.textContent = rankUp.to_label;
  copyEl.textContent = rankUp.tier_changed
    ? `Con vừa lên ${rankUp.to_label}! Minny tự hào quá — con học đều lắm.`
    : `Tuyệt vời! Con lên ${rankUp.to_label} rồi. Minny thấy con cố gắng hết mình.`;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  void fireRankUpConfetti(ladder, rankUp.tier_changed);
}

export function bindRankUpModalClose() {
  document.getElementById('rank-up-close')?.addEventListener('click', () => {
    const modal = document.getElementById('rank-up-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
  });
}
