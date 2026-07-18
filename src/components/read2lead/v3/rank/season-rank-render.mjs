/** Pure season rank render helpers — safe for node --test imports. */

/** @type {import('./season-rank-types').SeasonPayload} */
export const SEASON_FIXTURE = {
  id: '2026-S1',
  name_vi: 'Amazing Summer',
  emoji: '🌞',
  ends_at: '2026-08-31',
  rp: 14,
  ladder: {
    tier_index: 1,
    label_vi: 'Bạc II',
    stars: 1,
    stars_per_division: 3,
    stars_to_next: 2,
    capped: false,
    cap_unlock_hint_vi: null,
  },
  peak_label_vi: 'Bạc I',
};

export const MEDALS_FIXTURE = [
  {
    season_id: '2026-S0',
    name_vi: 'Mùa Khởi Đầu',
    emoji: '🌱',
    peak_label_vi: 'Vàng II',
    peak_tier_index: 2,
    reward_diamonds: 35,
    ts: '2026-05-31T12:00:00.000Z',
  },
];

export const LAST_MEDAL_SEEN_KEY = 'r2l_last_medal_seen';
export const LAST_TIER_PREFIX = 'r2l_last_season_tier:';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isSeasonPayload(value) {
  if (!value || typeof value !== 'object') return false;
  const s = value;
  return (
    typeof s.id === 'string' &&
    typeof s.name_vi === 'string' &&
    typeof s.emoji === 'string' &&
    typeof s.ends_at === 'string' &&
    !!s.ladder &&
    typeof s.ladder.tier_index === 'number'
  );
}

export function parseMedals(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((m) => {
    if (!m || typeof m !== 'object') return false;
    return typeof m.season_id === 'string' && typeof m.ts === 'string';
  });
}

export function daysUntilSeasonEnd(endsAt, now = new Date()) {
  const end = new Date(`${endsAt}T23:59:59`);
  if (Number.isNaN(end.getTime())) return 0;
  const ms = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function renderSeasonBannerHtml(season) {
  const days = daysUntilSeasonEnd(season.ends_at);
  const dayLabel = days === 1 ? 'còn 1 ngày' : `còn ${days} ngày`;
  return `<div class="r2l-season-banner" data-r2l-season-banner role="status">
    <span class="r2l-season-banner__theme" aria-hidden="true">${escapeHtml(season.emoji)}</span>
    <span class="r2l-season-banner__text">${escapeHtml(season.name_vi)} ${escapeHtml(season.emoji)} · ${escapeHtml(dayLabel)}</span>
    <span class="r2l-season-banner__pill">🏅 ${escapeHtml(season.ladder.label_vi)}</span>
  </div>`;
}

export function renderCapLockHintHtml(season) {
  if (!season.ladder.capped || !season.ladder.cap_unlock_hint_vi) return '';
  return `<p class="r2l-season-cap-hint" data-r2l-season-cap-hint role="note">
    <span aria-hidden="true">🔒</span> ${escapeHtml(season.ladder.cap_unlock_hint_vi)}
  </p>`;
}

export function renderMedalCabinetHtml(medals) {
  const sorted = [...medals].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const body =
    sorted.length === 0
      ? `<p class="r2l-medal-cabinet__empty">Mùa đầu tiên của con đang diễn ra — huy chương sẽ xuất hiện ở đây!</p>`
      : `<div class="r2l-medal-cabinet__scroll" role="list">
          ${sorted
            .map(
              (medal) => `<article class="r2l-medal-card" role="listitem" data-r2l-medal-card>
                <span class="r2l-medal-card__emoji" aria-hidden="true">${escapeHtml(medal.emoji)}</span>
                <p class="r2l-medal-card__name">${escapeHtml(medal.name_vi)}</p>
                <p class="r2l-medal-card__rank">${escapeHtml(medal.peak_label_vi)}</p>
                <p class="r2l-medal-card__diamonds">💎 ${Number(medal.reward_diamonds || 0)}</p>
              </article>`,
            )
            .join('')}
        </div>`;

  return `<section class="r2l-medal-cabinet" data-r2l-medal-cabinet aria-label="Tủ huy chương">
    <h2 class="r2l-medal-cabinet__title">Tủ huy chương</h2>
    ${body}
  </section>`;
}

export function renderMedalCongratsHtml(medal) {
  return `<div class="r2l-medal-congrats" data-r2l-medal-congrats role="status">
    <p>Mùa ${escapeHtml(medal.name_vi)} khép lại — con đạt ${escapeHtml(medal.peak_label_vi)}, nhận ${Number(medal.reward_diamonds || 0)} 💎! 🎉</p>
    <button type="button" class="r2l-kid-btn r2l-kid-btn--primary r2l-kid-btn--md" data-r2l-medal-congrats-dismiss>Tuyệt lắm!</button>
  </div>`;
}

export function getLastSeenMedalTs(storage = globalThis.localStorage) {
  try {
    return storage.getItem(LAST_MEDAL_SEEN_KEY);
  } catch {
    return null;
  }
}

export function setLastSeenMedalTs(ts, storage = globalThis.localStorage) {
  try {
    storage.setItem(LAST_MEDAL_SEEN_KEY, ts);
  } catch {
    /* ignore */
  }
}

export function newestMedalForCongrats(medals, storage = globalThis.localStorage) {
  if (!medals.length) return null;
  const sorted = [...medals].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const newest = sorted[0];
  const lastSeen = getLastSeenMedalTs(storage);
  if (lastSeen && String(newest.ts) <= lastSeen) return null;
  return newest;
}

function lastTierStorageKey(accessCode) {
  return `${LAST_TIER_PREFIX}${accessCode}`;
}

export function readLastSeasonTier(accessCode, storage = globalThis.sessionStorage) {
  try {
    const raw = storage.getItem(lastTierStorageKey(accessCode));
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeLastSeasonTier(accessCode, tierIndex, storage = globalThis.sessionStorage) {
  try {
    storage.setItem(lastTierStorageKey(accessCode), String(tierIndex));
  } catch {
    /* ignore */
  }
}

export function detectSeasonRankJump(accessCode, season, storage = globalThis.sessionStorage) {
  if (!season) return { jumped: false, label: '' };
  const current = season.ladder.tier_index;
  const previous = readLastSeasonTier(accessCode, storage);
  writeLastSeasonTier(accessCode, current, storage);
  if (previous == null) return { jumped: false, label: '' };
  if (current - previous >= 2) {
    return { jumped: true, label: season.ladder.label_vi };
  }
  return { jumped: false, label: '' };
}
