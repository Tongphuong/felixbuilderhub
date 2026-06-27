import type { RankLadderView } from './rank-ladder-ui';

type RankUpPayload = { changed: boolean; from_label: string; to_label: string; tier_changed: boolean };
type RankUpContext = {
  kidName?: string;
  rewards?: { coins?: number; avatars?: number; unlock?: string };
  shareText?: string;
  onDismiss?: () => void;
};

let bound = false;
let lastFocused: HTMLElement | null = null;
let currentContext: RankUpContext = {};
let currentShareText = '';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export async function fireRankUpConfetti(ladder: RankLadderView | undefined, tierChanged: boolean) {
  if (prefersReducedMotion()) return;
  const confetti = (await import('canvas-confetti')).default;
  const color = ladder?.tier_color || '#ffd700';
  if (tierChanged) {
    confetti({ particleCount: 120, spread: 100, startVelocity: 42, origin: { y: 0.62 }, colors: [color, '#ffffff', '#ffd700'], ticks: 220 });
    window.setTimeout(() => confetti({ particleCount: 80, spread: 70, origin: { y: 0.55 }, colors: [color, '#ffffff'] }), 280);
    return;
  }
  confetti({ particleCount: 60, spread: 70, origin: { y: 0.65 }, colors: [color, '#ffffff'] });
}

function rankClass(label: string) {
  const value = label.toLocaleLowerCase('vi');
  if (value.includes('đồng')) return 'bronze';
  if (value.includes('bạc') || value.includes('bạch kim')) return 'silver';
  if (value.includes('vàng')) return 'gold';
  if (value.includes('kim cương')) return 'diamond';
  return 'legend';
}

function setRankPill(element: HTMLElement | null, label: string) {
  if (!element) return;
  element.className = `fx-rank fx-rank--${rankClass(label)}`;
  element.innerHTML = `<span class="fx-rank__dot"></span><span></span>`;
  const text = element.lastElementChild;
  if (text) text.textContent = label;
}

function setReward(kind: 'coins' | 'avatars' | 'unlock', value: string | number | undefined) {
  const item = document.querySelector<HTMLElement>(`[data-rank-reward="${kind}"]`);
  if (!item) return false;
  const available = value !== undefined && value !== null && value !== '';
  item.classList.toggle('hidden', !available);
  const strong = item.querySelector('strong');
  if (strong) strong.textContent = available ? (kind === 'coins' ? `+${value}` : String(value)) : '';
  return available;
}

function closeRankUpModal() {
  const modal = document.getElementById('rank-up-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  currentContext.onDismiss?.();
  currentContext = {};
  lastFocused?.focus();
  lastFocused = null;
}

async function shareRankUp() {
  const status = document.getElementById('rank-up-status');
  try {
    if (navigator.share) await navigator.share({ text: currentShareText, title: 'Read2Lead' });
    else {
      await navigator.clipboard.writeText(currentShareText);
      if (status) { status.textContent = 'Đã sao chép lời nhắn để gửi cho bố mẹ.'; status.classList.remove('hidden'); }
    }
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') return;
    if (status) { status.textContent = 'Chưa chia sẻ được. Con có thể thử lại nhé.'; status.classList.remove('hidden'); }
  }
}

export function showRankUpModal(rankUp: RankUpPayload, ladder?: RankLadderView, context: RankUpContext = {}) {
  if (!rankUp?.changed) return;
  bindRankUpModalClose();
  const modal = document.getElementById('rank-up-modal');
  const label = document.getElementById('rank-up-label');
  const name = document.getElementById('rank-up-name');
  const copy = document.getElementById('rank-up-minny-copy');
  const rewards = document.getElementById('rank-up-rewards');
  const status = document.getElementById('rank-up-status');
  if (!modal || !label || !copy) return;

  currentContext = context;
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const kidName = String(context.kidName || 'Con');
  name!.textContent = kidName;
  label.textContent = rankUp.to_label;
  label.style.color = ladder?.tier_color || '';
  copy.textContent = rankUp.tier_changed
    ? `${rankUp.from_label} đã hoàn thành — thử thách ${rankUp.to_label} đang chờ con.`
    : `Tuyệt vời! Con lên ${rankUp.to_label} rồi. Minny thấy con cố gắng hết mình.`;
  setRankPill(document.getElementById('rank-up-old'), rankUp.from_label);
  setRankPill(document.getElementById('rank-up-new'), rankUp.to_label);
  const hasRewards = [
    setReward('coins', context.rewards?.coins),
    setReward('avatars', context.rewards?.avatars),
    setReward('unlock', context.rewards?.unlock),
  ].some(Boolean);
  rewards?.classList.toggle('hidden', !hasRewards);
  if (status) { status.textContent = ''; status.classList.add('hidden'); }
  currentShareText = context.shareText || `${kidName} vừa đạt bậc ${rankUp.to_label} trong Read2Lead! 🎉`;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  window.setTimeout(() => document.getElementById('rank-up-share')?.focus(), 0);
  void fireRankUpConfetti(ladder, rankUp.tier_changed);
}

export function bindRankUpModalClose() {
  if (bound) return;
  bound = true;
  document.getElementById('rank-up-close')?.addEventListener('click', closeRankUpModal);
  document.getElementById('rank-up-share')?.addEventListener('click', () => void shareRankUp());
  document.getElementById('rank-up-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeRankUpModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeRankUpModal();
  });
}
