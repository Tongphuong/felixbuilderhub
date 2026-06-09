import { isV3Enabled } from '../config/flags';
import { rankBadgeHtml, type RankLadderView } from './rank-ladder-ui';

type Read2LeadHeaderState = {
  current_level?: string;
  rank_title?: string;
  rank_asset_url?: string;
  rank_ladder?: RankLadderView;
  xp_in_level?: number;
  xp_to_next_level?: number;
  xp_percent?: number;
  coins?: number;
  streak_days?: number;
};

export function applyV3HeaderRank(state: Read2LeadHeaderState, root: ParentNode = document) {
  const v3 = isV3Enabled();
  const badgeSlot = root.querySelector('[data-r2l-v3-rank-badge]');
  const rankImage = root.querySelector('[data-r2l-rank-image]') as HTMLImageElement | null;
  const legacyBlock = root.querySelector('[data-r2l-legacy-rank-block]');
  const levelChip = root.querySelector('[data-r2l-level]');
  const readingLevel = root.querySelector('[data-r2l-reading-level]');
  const rankText = root.querySelector('[data-r2l-rank]');

  if (v3 && state.rank_ladder && badgeSlot) {
    badgeSlot.innerHTML = rankBadgeHtml(state.rank_ladder, 'compact');
    badgeSlot.classList.remove('hidden');
    badgeSlot.classList.add('inline-flex');
    rankImage?.classList.add('hidden');
    legacyBlock?.classList.add('hidden');
    levelChip?.classList.add('hidden');
    rankText?.classList.add('hidden');
    if (readingLevel) {
      readingLevel.textContent = `Cấp độ đọc: ${state.current_level || 'L1'}`;
      readingLevel.classList.remove('hidden');
    }
    return;
  }

  badgeSlot?.classList.add('hidden');
  badgeSlot?.classList.remove('inline-flex');
  rankImage?.classList.remove('hidden');
  legacyBlock?.classList.remove('hidden');
  levelChip?.classList.remove('hidden');
  readingLevel?.classList.add('hidden');
  if (rankText) rankText.textContent = state.rank_title || 'Read2Lead';
  if (rankImage && state.rank_asset_url) {
    rankImage.src = state.rank_asset_url;
    rankImage.alt = `Rank ${state.rank_title || state.current_level || 'Read2Lead'}`;
  }
}
