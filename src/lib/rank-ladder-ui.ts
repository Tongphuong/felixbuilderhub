export type RankLadderView = {
  tier_color: string;
  label_vi: string;
  stars: number;
  stars_per_division: number;
  is_apex?: boolean;
  tier_index?: number;
  stars_to_next?: number;
  next_label_vi?: string | null;
};

export const RANK_LADDER_TIERS_UI = [
  { tier_index: 0, tier_name_vi: 'Đồng', tier_color: '#cd7f32' },
  { tier_index: 1, tier_name_vi: 'Bạc', tier_color: '#c0c0c0' },
  { tier_index: 2, tier_name_vi: 'Vàng', tier_color: '#ffd700' },
  { tier_index: 3, tier_name_vi: 'Bạch Kim', tier_color: '#4fd1c5' },
  { tier_index: 4, tier_name_vi: 'Kim Cương', tier_color: '#5b8def' },
  { tier_index: 5, tier_name_vi: 'Tinh Anh', tier_color: '#a855f7' },
  { tier_index: 6, tier_name_vi: 'Cao Thủ', tier_color: '#ef4444' },
  { tier_index: 7, tier_name_vi: 'Thách Đấu', tier_color: '#ffd700' },
] as const;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function rankStarRow(stars: number, starsPerDivision: number) {
  const total = starsPerDivision || 3;
  return Array.from({ length: total }, (_, index) => {
    const filled = index < stars;
    return `<span class="r2l-rank-star${filled ? ' r2l-rank-star--filled' : ''}" aria-hidden="true">${filled ? '⭐' : '☆'}</span>`;
  }).join('');
}

export function rankBadgeStyle(ladder: RankLadderView) {
  if (ladder.is_apex) {
    return 'background: linear-gradient(135deg, #ffd700 0%, #ff8c00 100%); border-color: #ffd700;';
  }
  const color = ladder.tier_color || '#c0c0c0';
  return `border-color: ${color}; background: color-mix(in srgb, ${color} 20%, transparent);`;
}

export function rankBadgeHtml(ladder: RankLadderView, variant: 'compact' | 'large' = 'compact') {
  const sizeClass = variant === 'large' ? 'r2l-rank-badge--large' : 'r2l-rank-badge--compact';
  const stars = rankStarRow(ladder.stars || 0, ladder.stars_per_division || 3);
  return `<div class="r2l-rank-badge ${sizeClass}" style="${rankBadgeStyle(ladder)}" role="status" aria-label="Hạng ${escapeHtml(ladder.label_vi)}">
    <span class="r2l-rank-badge__label">${escapeHtml(ladder.label_vi)}</span>
    <span class="r2l-rank-badge__stars">${stars}</span>
  </div>`;
}

export function rankLadderPanelHtml(currentTierIndex: number) {
  return RANK_LADDER_TIERS_UI.map((tier) => {
    const current = tier.tier_index === currentTierIndex;
    const apex = tier.tier_index === 7;
    return `<div class="r2l-ladder-tier${current ? ' r2l-ladder-tier--current' : ''}" style="--tier-color: ${tier.tier_color}">
      <span class="r2l-ladder-tier__dot" aria-hidden="true"></span>
      <span class="r2l-ladder-tier__name">${escapeHtml(tier.tier_name_vi)}${apex ? ' ★' : ''}</span>
    </div>`;
  }).join('');
}

export function rankProgressLineHtml(ladder: RankLadderView) {
  if (ladder.is_apex || !ladder.next_label_vi) {
    return '<p class="r2l-rank-progress r2l-rank-progress--apex">Con đã ở đỉnh Thách Đấu — Minny tự hào lắm!</p>';
  }
  const remaining = ladder.stars_to_next ?? 0;
  if (!remaining) return '';
  return `<p class="r2l-rank-progress">Còn <strong>${remaining}</strong> sao nữa lên <strong>${escapeHtml(ladder.next_label_vi)}</strong></p>`;
}
