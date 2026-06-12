import { fireRankUpConfetti } from '../../../../lib/rank-up-celebration';

export {
  SEASON_FIXTURE,
  MEDALS_FIXTURE,
  LAST_MEDAL_SEEN_KEY,
  isSeasonPayload,
  parseMedals,
  daysUntilSeasonEnd,
  renderSeasonBannerHtml,
  renderCapLockHintHtml,
  renderMedalCabinetHtml,
  renderMedalCongratsHtml,
  getLastSeenMedalTs,
  setLastSeenMedalTs,
  newestMedalForCongrats,
  readLastSeasonTier,
  writeLastSeasonTier,
  detectSeasonRankJump,
} from './season-rank-render.mjs';

export type SeasonLadder = {
  tier_index: number;
  label_vi: string;
  stars: number;
  stars_per_division: number;
  stars_to_next: number;
  capped: boolean;
  cap_unlock_hint_vi: string | null;
};

export type SeasonPayload = {
  id: string;
  name_vi: string;
  emoji: string;
  ends_at: string;
  rp: number;
  ladder: SeasonLadder;
  peak_label_vi: string;
};

export type MedalPayload = {
  season_id: string;
  name_vi: string;
  emoji: string;
  peak_label_vi: string;
  peak_tier_index: number;
  reward_coins: number;
  ts: string;
};

export function showSeasonRankJumpModal(label: string) {
  const modal = document.getElementById('rank-up-modal');
  const labelEl = document.getElementById('rank-up-label');
  const copyEl = document.getElementById('rank-up-minny-copy');
  if (!modal || !labelEl || !copyEl) return;

  labelEl.textContent = label;
  copyEl.textContent = `Mở khoá rank mới! Con đã lên ${label}!`;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  void fireRankUpConfetti(undefined, true);
}
