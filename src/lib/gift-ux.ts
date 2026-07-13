// "Quà thật" (Real Gifts) shop client logic. Mirrors src/lib/shop-ux.ts's
// shape (single exported initGiftsPage(hooks), full re-render + rebind, no
// framework) — but this is a SEPARATE economy from the monster shop's coin
// currency: diamonds (💎) only, and no can_afford=false locked/greyed state
// (unaffordable = a progress bar, per HANDOFF §0 rule 6).

export type GiftItem = {
  id: string;
  name_vi: string;
  emoji: string;
  image_key: string | null;
  image_url: string | null;
  price_diamonds: number;
  can_afford: boolean;
  available: boolean;
  progress_percent: number;
};

export type GiftRedemptionStatus = 'requested' | 'preparing' | 'delivered' | 'rejected';

export type GiftRedemption = {
  id: string;
  gift_id: string;
  name_vi: string;
  price_diamonds: number;
  status: GiftRedemptionStatus;
  ts: string;
  updated_at?: string;
};

export type GiftCardState = 'saving' | 'nearmiss' | 'affordable' | 'pending' | 'preparing' | 'delivered' | 'unavailable';

export type GiftBand = 'now' | 'soon' | 'building' | 'unavailable';

export type GiftsPageHooks = {
  onError: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for reuse by later packets — admin queue, goal card
// on other pages, etc.)
// ---------------------------------------------------------------------------

/**
 * Derives the state a single gift card should render in. Only an IN-FLIGHT
 * redemption (requested/preparing) pins the card — a gift is consumable and
 * repeatable by founder decision (state.redemptions[] is an append-only
 * ledger, not an idempotent owned-set), so `delivered` must NOT lock the
 * card forever: it falls through to the normal affordability rules below,
 * same as `rejected` (terminal + refunded) and same as having no redemption
 * at all. A delivered gift returning to "affordable"/"saving" is correct —
 * the redemption still shows up separately in the trophy row (see
 * renderTrophyGroup), it just no longer overrides this card's own state.
 */
export function deriveGiftCardState(
  // Widened to the fields actually read, so gift-goal-card.ts can call THIS
  // function instead of keeping its own copy of the rules. One source of
  // truth: the near-miss threshold must never differ between the shop and
  // the goal card shown on the lesson/profile/parent screens.
  item: Pick<GiftItem, 'id' | 'can_afford' | 'progress_percent' | 'available'>,
  redemptions: Pick<GiftRedemption, 'gift_id' | 'status'>[],
): GiftCardState {
  const matching = (Array.isArray(redemptions) ? redemptions : []).filter((entry) => entry?.gift_id === item.id);
  const newest = matching[matching.length - 1];
  // An in-flight redemption (already requested/being prepared) wins first —
  // a child already waiting on a gift must keep seeing that, even if the
  // gift itself went unavailable (toggled off / budget cap hit) in the
  // meantime; the founder is honouring an already-accepted request.
  if (newest?.status === 'requested') return 'pending';
  if (newest?.status === 'preparing') return 'preparing';
  // `available` is false when a gift is toggled off OR its limit_total
  // budget cap is exhausted (functions/api/_gifts-v2.js isGiftAvailable).
  // redeemed_count is deliberately NOT restored on delivery, so this can
  // become permanent until the founder raises the cap. MUST be checked
  // before affordable/nearmiss/saving: can_afford and progress_percent say
  // nothing about whether the gift can actually be redeemed, so without this
  // check a child crossing 95% on a now-unavailable gift is told "sắp đủ
  // rồi 🔥" for something no amount of diamonds will ever unlock.
  if (item.available === false) return 'unavailable';
  if (item.can_afford) return 'affordable';
  if (item.progress_percent >= 95) return 'nearmiss';
  return 'saving';
}

/** Which of the 4 proximity bands a catalogue card belongs under. Unavailable
 * gifts get their own quiet band at the bottom (see renderBandSection) —
 * checked first so an unavailable gift never lands in "now"/"soon" just
 * because it happens to be affordable or close on progress. */
export function giftBand(item: GiftItem): GiftBand {
  if (item.available === false) return 'unavailable';
  if (item.can_afford) return 'now';
  if (item.progress_percent >= 50) return 'soon';
  return 'building';
}

/**
 * The backend enforces one open redemption per child at a time
 * (`pending_request_exists`) — this asks whether ANY gift on the page has an
 * in-flight redemption right now, across the whole ledger, not just the item
 * being rendered. Used to disable every "Đổi quà ngay 💎" CTA on the page
 * (goal card included) so the UI never invites a tap the server will refuse.
 */
export function hasInFlightRedemption(redemptions: GiftRedemption[]): boolean {
  return (Array.isArray(redemptions) ? redemptions : []).some(
    (entry) => entry?.status === 'requested' || entry?.status === 'preparing',
  );
}

/** Newest redemption entry for a gift id, or undefined. */
function newestRedemptionFor(giftId: string, redemptions: GiftRedemption[]): GiftRedemption | undefined {
  const matching = (Array.isArray(redemptions) ? redemptions : []).filter((entry) => entry?.gift_id === giftId);
  return matching[matching.length - 1];
}

/** True when THIS item's own current redemption is in-flight (pending or
 * preparing) — distinct from hasInFlightRedemption, which asks whether the
 * child has ANY open redemption anywhere. Used to pull a gift out of the
 * catalogue bands and into the "Quà của con" section: a gift being bought
 * for you is not a gift you can buy. */
function isItemInFlight(item: GiftItem, redemptions: GiftRedemption[]): boolean {
  const state = deriveGiftCardState(item, redemptions);
  return state === 'pending' || state === 'preparing';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDiamonds(value: number): string {
  return (Number(value) || 0).toLocaleString('vi-VN');
}

function formatDateVi(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function daysAgoVi(iso: string | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.max(0, Math.floor((Date.now() - then) / 86400000));
  if (days <= 0) return 'hôm nay';
  if (days === 1) return '1 ngày trước';
  return `${days} ngày trước`;
}

/**
 * Image src precedence per HANDOFF §2: uploaded photo → pasted URL → none (emoji only).
 *
 * The `v` param is the whole reason a replaced photo ever reaches a child.
 * read2lead-gift-image.js serves with `max-age=31536000, immutable`, and this URL
 * used to be just `?id=<id>` — identical before and after an upload. So a browser
 * (and the CDN edge) that had cached the OLD photo kept serving it for a year:
 * Coach Felix would swap a wrong photo for a right one, reload, still see the
 * wrong one, and reasonably conclude the upload was broken. He reported exactly
 * that once. `image_key` now carries an upload timestamp, so it changes on every
 * upload — which makes this URL change, which makes `immutable` finally honest.
 * The server ignores `v`; it exists only to be different.
 */
function photoSrc(item: GiftItem): string | null {
  if (item.image_key) {
    return `/api/read2lead-gift-image?id=${encodeURIComponent(item.id)}`
      + `&v=${encodeURIComponent(item.image_key)}`;
  }
  if (item.image_url) return item.image_url;
  return null;
}

// ---------------------------------------------------------------------------
// Rendering (HTML strings, mirroring shop-ux.ts's renderShopItem pattern)
// ---------------------------------------------------------------------------

type PhotoWellOptions = {
  emoji: string;
  name: string;
  imageSrc?: string | null;
  size?: 'sm' | 'md' | 'lg';
  aspect?: '4/3' | '16/9';
  modifier?: 'warm' | 'pending' | 'shimmer' | 'delivered' | 'unavailable';
  animateEmoji?: boolean;
  badgeHtml?: string;
  cornerHtml?: string;
};

/** GiftPhotoWell (HANDOFF §2). Three-tier fallback: photo -> pasted url -> emoji.
 * Exported for unit tests — see tests/gift-ux.test.mjs. */
export function renderPhotoWell(opts: PhotoWellOptions): string {
  const classes = ['qt-photo-well'];
  if (opts.aspect === '16/9') classes.push('qt-photo-well--banner');
  if (opts.size === 'lg') classes.push('qt-photo-well--lg');
  if (opts.size === 'sm') classes.push('qt-photo-well--sm');
  if (opts.modifier) classes.push(`qt-photo-well--${opts.modifier}`);
  if (opts.modifier === 'shimmer') classes.push('qt-shimmer');

  const emojiClasses = ['qt-photo-well__emoji'];
  if (opts.animateEmoji) emojiClasses.push('qt-float');

  const img = opts.imageSrc
    ? `<img class="qt-photo-well__img" src="${escapeHtml(opts.imageSrc)}" alt="${escapeHtml(opts.name)}" loading="lazy" onerror="this.remove()" onload="this.closest('.qt-photo-well')?.classList.add('qt-photo-well--has-img')" />`
    : '';

  return `
    <div class="${classes.join(' ')}">
      <span class="${emojiClasses.join(' ')}" aria-hidden="true">${escapeHtml(opts.emoji)}</span>
      ${img}
      ${opts.badgeHtml || ''}
      ${opts.cornerHtml || ''}
    </div>
  `;
}

function progressBarHtml(percent: number, gradient = true, colorVar?: string): string {
  const width = Math.max(0, Math.min(100, Math.round(percent)));
  const fillClass = gradient ? 'fx-progress__fill fx-progress__fill--gradient' : 'fx-progress__fill';
  const style = colorVar ? ` style="width:${width}%; background:${colorVar};"` : ` style="width:${width}%;"`;
  return `<span class="fx-progress"><span class="${fillClass}"${style}></span></span>`;
}

type GiftCardVariant = 'band' | 'goal';

/**
 * Renders one gift card. `variant: 'goal'` is the pinned-goal card — it MUST
 * go through the exact same per-state branches as a catalogue ('band') card,
 * not a separate hand-rolled layout: a child's goal is very often also their
 * nearest gift (that's the point of pinning it), so if the goal card had its
 * own generic "still saving" treatment, the loudest state in the app
 * (near-miss) — and the affordable redeem CTA — would almost never surface
 * in production. The only differences for 'goal' are cosmetic: a 16:9 photo
 * (vs 4:3), a "★ Mục tiêu của con" eyebrow, and — in the saving/nearmiss
 * branches only — "Đổi mục tiêu" (clear the goal) in place of "Đặt làm mục
 * tiêu ★" (you can't set as your goal what already is your goal).
 */
// Exported so tests can RENDER a card and inspect what a child is actually
// offered, rather than grepping this file's source text for a string. The dead
// "Đặt làm mục tiêu ★" button on an unavailable card survived a source-grep
// test that asserted its PRESENCE; only rendering it and calling the real
// endpoint exposed it.
export function renderGiftCard(
  item: GiftItem,
  state: GiftCardState,
  redemption: GiftRedemption | undefined,
  diamonds: number,
  variant: GiftCardVariant = 'band',
  blocked = false,
): string {
  const name = item.name_vi;
  const price = formatDiamonds(item.price_diamonds);
  const img = photoSrc(item);
  const isGoal = variant === 'goal';
  const aspect = isGoal ? '16/9' as const : undefined;
  const cardClass = isGoal ? 'qt-gift-card qt-gift-card--goal' : 'qt-gift-card';
  const goalEyebrow = isGoal ? '<p class="fx-eyebrow qt-goal-eyebrow">★ Mục tiêu của con</p>' : '';
  const savingAction = isGoal
    ? '<button type="button" class="fx-btn fx-btn--secondary fx-btn--block qt-clear-goal" style="margin-top:11px; min-height:44px;">Đổi mục tiêu</button>'
    : `<button type="button" class="fx-btn fx-btn--secondary fx-btn--block qt-set-goal" data-gift-id="${escapeHtml(item.id)}" style="margin-top:11px; min-height:44px;">Đặt làm mục tiêu ★</button>`;

  if (state === 'pending') {
    const well = renderPhotoWell({
      emoji: item.emoji,
      name,
      aspect,
      modifier: 'pending',
      badgeHtml: '<span class="fx-badge fx-badge--neutral qt-photo-well__badge">⏳ Đang chờ Coach Felix duyệt</span>',
    });
    return `
      <article class="${cardClass}" data-state="pending" data-gift-id="${escapeHtml(item.id)}">
        ${well}
        <div class="qt-gift-card__body">
          ${goalEyebrow}
          <div class="qt-gift-card__head">
            <strong class="qt-gift-card__name">${escapeHtml(name)}</strong>
            <span class="qt-gift-card__price" style="color:var(--cream-dim);">−${price} 💎</span>
          </div>
          <p style="margin:10px 0 0; color:var(--cream-muted); font-size:12.5px; line-height:1.5;">Con đã gửi yêu cầu. Coach Felix sẽ xem và chuẩn bị quà cho con nhé.</p>
          <button type="button" class="fx-btn fx-btn--secondary fx-btn--block" disabled aria-disabled="true" style="margin-top:11px; min-height:44px;">Đã gửi yêu cầu</button>
        </div>
      </article>
    `;
  }

  if (state === 'preparing') {
    const well = renderPhotoWell({
      emoji: '🎁',
      name,
      aspect,
      modifier: 'shimmer',
      animateEmoji: true,
      badgeHtml: '<span class="fx-badge qt-photo-well__badge" style="background:color-mix(in srgb,var(--gold) 90%,#fff); color:var(--navy-950); font-weight:800;">🎁 Coach Felix đang chuẩn bị</span>',
    });
    return `
      <article class="${cardClass}" data-state="preparing" data-gift-id="${escapeHtml(item.id)}">
        ${well}
        <div class="qt-gift-card__body">
          ${goalEyebrow}
          <strong class="qt-gift-card__name">${escapeHtml(name)}</strong>
          <p style="margin:9px 0 0; color:var(--cream); font-size:13.5px; line-height:1.55; font-weight:600;">Coach Felix đang chuẩn bị quà cho con — sắp mang tới lớp rồi! 💛</p>
          <p style="margin:6px 0 0; color:var(--cream-dim); font-size:12px;">Coach Felix nhận yêu cầu ${escapeHtml(daysAgoVi(redemption?.updated_at || redemption?.ts))}</p>
        </div>
      </article>
    `;
  }

  if (state === 'delivered') {
    const well = renderPhotoWell({
      emoji: item.emoji,
      name,
      aspect,
      imageSrc: img,
      modifier: 'delivered',
      badgeHtml: '<span class="fx-badge qt-photo-well__badge" style="background:var(--success); color:var(--navy-950); font-weight:800;">✓ Đã nhận quà</span>',
      cornerHtml: '<span class="qt-photo-well__badge qt-photo-well__badge--corner" aria-hidden="true">🏆</span>',
    });
    return `
      <article class="${cardClass}" data-state="delivered" data-gift-id="${escapeHtml(item.id)}">
        ${well}
        <div class="qt-gift-card__body">
          ${goalEyebrow}
          <strong class="qt-gift-card__name">${escapeHtml(name)}</strong>
          <p style="margin:9px 0 0; color:var(--cream-muted); font-size:13px;">Con đã nhận từ Coach Felix ở lớp 💛</p>
          <p style="margin:5px 0 0; color:var(--success); font-size:12.5px; font-weight:700;">Nhận ngày ${escapeHtml(formatDateVi(redemption?.updated_at || redemption?.ts))}</p>
        </div>
      </article>
    `;
  }

  if (state === 'unavailable') {
    // Genuinely not obtainable right now (toggled off, or its budget cap is
    // exhausted) — but this is a PAUSE, not the "locked/greyed wall" HANDOFF
    // §0 rule 6 forbids for unaffordable gifts. That rule is about a child
    // still on the saving journey; this gift is a different situation, so it
    // gets its own honest, calm treatment: real photo + real progress kept
    // (their saving was not wasted, their diamonds are untouched), no hype
    // copy/emoji/countdown, no redeem CTA, and none of the banned
    // out-of-stock phrasing from HANDOFF §0 rule 5 — supply is unlimited,
    // this is Coach Felix pausing the gift, not a shelf going empty.
    const well = renderPhotoWell({
      emoji: item.emoji,
      name,
      aspect,
      imageSrc: img,
      modifier: 'unavailable',
      badgeHtml: '<span class="fx-badge fx-badge--neutral qt-photo-well__badge">Tạm thời chưa mở</span>',
    });
    const percent = Math.max(0, Math.min(100, Math.round(item.progress_percent)));
    // Goal variant: this gift IS already the child's pinned goal (it went
    // unavailable after she pinned it), so "Đặt làm mục tiêu ★" would be
    // nonsensical — offer a one-tap way to pick a different goal instead.
    //
    // Band variant: NO action at all. This card used to offer "Đặt làm mục
    // tiêu ★" on the theory that the gift "may reopen later" — but the server
    // does not agree: read2lead-gift-goal.js gates on this same
    // isGiftAvailable() and answers 400 `gift_unavailable`. The button was a
    // DEAD CLICK: a child taps the only button on the card and is told no.
    // Verified live against the deployed endpoint, not assumed. The caption
    // already explains the situation; an action that always fails is worse
    // than no action.
    const action = isGoal
      ? '<button type="button" class="fx-btn fx-btn--secondary fx-btn--block qt-clear-goal" style="margin-top:11px; min-height:44px;">Chọn mục tiêu khác ★</button>'
      : '';
    return `
      <article class="${cardClass}" data-state="unavailable" data-gift-id="${escapeHtml(item.id)}">
        ${well}
        <div class="qt-gift-card__body">
          ${goalEyebrow}
          <div class="qt-gift-card__head">
            <strong class="qt-gift-card__name">${escapeHtml(name)}</strong>
            <span class="qt-gift-card__price">💎 ${price}</span>
          </div>
          ${progressBarHtml(percent)}
          <p style="margin:9px 0 0; color:var(--cream-muted); font-size:13px; line-height:1.5;">Món quà này tạm thời chưa đổi được. Coach Felix sẽ mở lại sau nhé!</p>
          ${action}
        </div>
      </article>
    `;
  }

  if (state === 'affordable') {
    const well = renderPhotoWell({
      emoji: item.emoji,
      name,
      aspect,
      imageSrc: img,
      badgeHtml: '<span class="fx-badge fx-badge--solid qt-photo-well__badge" style="background:var(--success); color:var(--navy-950); font-weight:800;">Đổi được rồi!</span>',
    });
    return `
      <article class="${cardClass}" data-state="affordable" data-gift-id="${escapeHtml(item.id)}">
        ${well}
        <div class="qt-gift-card__body">
          ${goalEyebrow}
          <div class="qt-gift-card__head">
            <strong class="qt-gift-card__name">${escapeHtml(name)}</strong>
            <span class="qt-gift-card__price">💎 ${price}</span>
          </div>
          ${progressBarHtml(100, false, 'var(--success)')}
          ${blocked
            ? '<p style="margin:8px 0 0; color:var(--cream-muted); font-size:12.5px; line-height:1.5;">Con đang chờ Coach Felix duyệt một món quà rồi. Nhận quà xong con đổi tiếp nhé!</p>'
            : '<p style="margin:8px 0 0; color:var(--success); font-size:12.5px;">Con đủ kim cương rồi 🎉</p>'}
          <button type="button" class="fx-btn fx-btn--primary fx-btn--block qt-redeem" data-gift-id="${escapeHtml(item.id)}"${blocked ? ' disabled aria-disabled="true"' : ''} style="margin-top:11px; min-height:56px; font-weight:800; font-size:16px;">Đổi quà ngay 💎</button>
        </div>
      </article>
    `;
  }

  if (state === 'nearmiss') {
    const deficit = Math.max(0, item.price_diamonds - diamonds);
    const well = renderPhotoWell({
      emoji: item.emoji,
      name,
      aspect,
      imageSrc: img,
      modifier: 'warm',
      animateEmoji: true,
      badgeHtml: '<span class="fx-badge qt-photo-well__badge" style="background:var(--gold-light); color:var(--navy-950); font-weight:800;">🔥 Sắp đổi được!</span>',
    });
    return `
      <article class="${cardClass} qt-pulse" data-state="nearmiss" data-gift-id="${escapeHtml(item.id)}">
        ${well}
        <div class="qt-gift-card__body">
          ${goalEyebrow}
          <div class="qt-gift-card__head">
            <strong class="qt-gift-card__name">${escapeHtml(name)}</strong>
            <span class="qt-gift-card__price">💎 ${price}</span>
          </div>
          ${progressBarHtml(item.progress_percent)}
          <p style="margin:9px 0 0; color:var(--gold-light); font-size:14px; font-weight:700;">Chỉ còn ${escapeHtml(formatDiamonds(deficit))} 💎 nữa thôi! 🔥</p>
          <p style="margin:4px 0 0; color:var(--cream-muted); font-size:12px;">Buổi học tới của con là đủ rồi!</p>
          ${savingAction}
        </div>
      </article>
    `;
  }

  // state === 'saving'
  const well = renderPhotoWell({ emoji: item.emoji, name, aspect, imageSrc: img });
  const percent = Math.max(0, Math.min(100, Math.round(item.progress_percent)));
  const deficit = Math.max(0, item.price_diamonds - diamonds);
  const caption = percent >= 50
    ? `Con đã đi được <strong style="color:var(--gold-light);">${percent}%</strong> chặng đường · còn <strong style="color:var(--gold-light);">${escapeHtml(formatDiamonds(deficit))} 💎</strong>`
    : `Con đã đi được <strong style="color:var(--gold-light);">${percent}%</strong> chặng đường`;
  return `
    <article class="${cardClass}" data-state="saving" data-gift-id="${escapeHtml(item.id)}">
      ${well}
      <div class="qt-gift-card__body">
        ${goalEyebrow}
        <div class="qt-gift-card__head">
          <strong class="qt-gift-card__name">${escapeHtml(name)}</strong>
          <span class="qt-gift-card__price">💎 ${price}</span>
        </div>
        ${progressBarHtml(percent)}
        <p class="qt-gift-card__caption" style="margin:9px 0 0; color:var(--cream-muted);">${caption}</p>
        ${savingAction}
      </div>
    </article>
  `;
}

function renderBandSection(band: GiftBand, items: GiftItem[], redemptions: GiftRedemption[], diamonds: number, blocked = false): string {
  if (!items.length) return '';
  const labels: Record<GiftBand, { title: string; className: string }> = {
    now: { title: '✓ Con có thể đổi ngay', className: 'qt-band-header--now' },
    soon: { title: 'Sắp đủ rồi', className: 'qt-band-header--soon' },
    building: { title: 'Con đang xây dựng', className: 'qt-band-header--building' },
    // Its own quiet group at the bottom, below "Con đang xây dựng" — never
    // mixed into "now"/"soon" where the band header itself would be a
    // promise ("✓ Con có thể đổi ngay") the gift can't keep.
    unavailable: { title: 'Tạm thời chưa mở', className: 'qt-band-header--unavailable' },
  };
  const label = labels[band];
  const cards = items
    .map((item) => renderGiftCard(item, deriveGiftCardState(item, redemptions), newestRedemptionFor(item.id, redemptions), diamonds, 'band', blocked))
    .join('');
  return `
    <section class="qt-band" data-band="${band}">
      <p class="fx-eyebrow qt-band-header ${label.className}">${label.title}</p>
      <div class="qt-band-grid">${cards}</div>
    </section>
  `;
}

/**
 * "🎁 Quà của con" — gifts with an in-flight redemption (pending Coach
 * Felix's review, or already being prepared). Rendered FIRST, above the
 * pinned goal card: a child who has spent months of savings and is waiting
 * should see it before anything else, not buried in a catalogue band. Reuses
 * the exact same renderGiftCard branches as a catalogue card (no forked
 * visual) — only the section it lives under is new. Only rendered when
 * non-empty.
 */
function renderInFlightGroup(items: GiftItem[], redemptions: GiftRedemption[], diamonds: number, blocked = false): string {
  const inFlight = items.filter((item) => isItemInFlight(item, redemptions));
  if (!inFlight.length) return '';
  const cards = inFlight
    .map((item) => renderGiftCard(item, deriveGiftCardState(item, redemptions), newestRedemptionFor(item.id, redemptions), diamonds, 'band', blocked))
    .join('');
  return `
    <section class="qt-band" data-band="inflight">
      <p class="fx-eyebrow qt-band-header qt-band-header--now">🎁 Quà của con</p>
      <div class="qt-band-grid">${cards}</div>
    </section>
  `;
}

/**
 * "🏆 Con đã nhận" — a compact keepsake strip of `delivered` redemptions:
 * emoji/photo + name + "Nhận ngày DD/MM/YYYY". Deliberately NOT a shop
 * listing (no price, no progress bar, no CTA) — it's a memory, not
 * something to act on. Iterates the redemption LEDGER, not deduped by gift
 * id: gifts are repeatable by founder decision (see deriveGiftCardState), so
 * a child who redeemed the same gift twice gets two keepsakes. A delivered
 * gift showing up here AND back in the catalogue (as something to earn
 * again) is the correct, deliberate consequence — not a bug to fix.
 */
function renderTrophyGroup(redemptions: GiftRedemption[], items: GiftItem[]): string {
  const delivered = (Array.isArray(redemptions) ? redemptions : [])
    .filter((entry) => entry?.status === 'delivered')
    .sort((a, b) => (Date.parse(b.updated_at || b.ts) || 0) - (Date.parse(a.updated_at || a.ts) || 0));
  if (!delivered.length) return '';
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const chips = delivered
    .map((entry) => {
      const item = itemsById.get(entry.gift_id);
      const emoji = item?.emoji || '🎁';
      const name = item?.name_vi || entry.name_vi;
      const img = item ? photoSrc(item) : null;
      const well = renderPhotoWell({
        emoji,
        name,
        imageSrc: img,
        size: 'sm',
        modifier: 'delivered',
        cornerHtml: '<span class="qt-photo-well__badge qt-photo-well__badge--corner" aria-hidden="true">🏆</span>',
      });
      return `
        <div class="qt-trophy-item">
          ${well}
          <strong class="qt-trophy-item__name">${escapeHtml(name)}</strong>
          <span class="qt-trophy-item__date">Nhận ngày ${escapeHtml(formatDateVi(entry.updated_at || entry.ts))}</span>
        </div>
      `;
    })
    .join('');
  return `
    <section class="qt-trophy-group">
      <p class="fx-eyebrow qt-band-header qt-band-header--now">🏆 Con đã nhận</p>
      <div class="qt-trophy-row">${chips}</div>
    </section>
  `;
}

function renderEmptyState(): string {
  return `
    <div class="qt-empty-state">
      <span style="font-size:44px;" aria-hidden="true">🎁</span>
      <strong style="font-family:var(--font-display); color:var(--cream); font-size:16px;">Chưa có quà nào</strong>
      <p style="margin:0; color:var(--cream-muted); font-size:13px; line-height:1.55;">Coach Felix đang chọn thêm quà thật cho các con. Quay lại sau nhé!</p>
      <a href="/ho-so" class="fx-btn fx-btn--secondary" style="margin-top:6px; min-height:44px;">Về hồ sơ của con</a>
    </div>
  `;
}

/** The pinned goal card — thin wrapper that puts the goal item through the
 * SAME state derivation + rendering as every other card (see renderGiftCard
 * for why: forking a second "saving-only" visual for the goal card is what
 * made near-miss goals invisible). */
function renderGoalCard(item: GiftItem, redemptions: GiftRedemption[], diamonds: number, blocked = false): string {
  const state = deriveGiftCardState(item, redemptions);
  const redemption = newestRedemptionFor(item.id, redemptions);
  return renderGiftCard(item, state, redemption, diamonds, 'goal', blocked);
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

type GiftsListResponse = {
  ok: boolean;
  items?: GiftItem[];
  diamonds?: number;
  redemptions?: GiftRedemption[];
  gift_goal?: string | null;
  message?: string;
};

type GiftsRedeemResponse = {
  ok: boolean;
  redemption?: GiftRedemption;
  diamonds?: number;
  redemptions?: GiftRedemption[];
  error?: string;
  message?: string;
};

async function fetchGiftsList(code: string): Promise<GiftsListResponse> {
  try {
    const res = await fetch('/api/read2lead-gifts-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    return await res.json();
  } catch {
    return { ok: false, message: 'Không thể mở cửa hàng.' };
  }
}

async function redeemGiftRequest(code: string, giftId: string): Promise<GiftsRedeemResponse> {
  try {
    const res = await fetch('/api/read2lead-gifts-redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, gift_id: giftId }),
    });
    return await res.json();
  } catch {
    return { ok: false, message: 'Không thể đổi quà. Con thử lại nhé.' };
  }
}

async function setGiftGoalRequest(code: string, giftId: string | null): Promise<{ ok: boolean; gift_goal?: string | null; message?: string }> {
  try {
    const res = await fetch('/api/read2lead-gift-goal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, gift_id: giftId }),
    });
    return await res.json();
  } catch {
    return { ok: false, message: 'Không thể lưu mục tiêu.' };
  }
}

// ---------------------------------------------------------------------------
// Page controller
// ---------------------------------------------------------------------------

export function initGiftsPage(hooks: GiftsPageHooks): void {
  let accessCode = '';
  let items: GiftItem[] = [];
  let diamonds = 0;
  let redemptions: GiftRedemption[] = [];
  let giftGoal: string | null = null;
  let pendingGiftId: string | null = null; // the gift the confirm modal is open for

  const qs = (sel: string) => document.querySelector(sel);

  const setBalance = (value: number) => {
    diamonds = Number(value) || 0;
    const heroValue = qs('#gifts-balance-hero-value');
    if (heroValue) heroValue.textContent = formatDiamonds(diamonds);
    const pillValue = qs('#gifts-balance-pill-value');
    if (pillValue) pillValue.textContent = formatDiamonds(diamonds);
  };

  // Shared by the goal slot and the band grid: wires whatever action button
  // a rendered card happens to carry (redeem / set-goal / clear-goal) —
  // the goal card can legitimately show any of them depending on its state
  // (e.g. "Đổi quà ngay 💎" when the goal itself is affordable), so this
  // can't be band-only.
  const bindCardActions = (host: Element | null) => {
    if (!host) return;
    host.querySelectorAll<HTMLButtonElement>('.qt-redeem').forEach((button) => {
      button.addEventListener('click', () => {
        const giftId = button.dataset.giftId || '';
        if (giftId) openConfirmModal(giftId);
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.qt-set-goal').forEach((button) => {
      button.addEventListener('click', () => {
        const giftId = button.dataset.giftId || '';
        if (giftId) void handleSetGoal(giftId);
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.qt-clear-goal').forEach((button) => {
      button.addEventListener('click', () => {
        void handleSetGoal(null);
      });
    });
  };

  // "🎁 Quà của con" — gifts already in flight (pending Coach Felix's review
  // or being prepared). Rendered first, above the goal card: a child who has
  // spent months saving and is waiting should see it before anything else.
  // Also excludes the pinned goal by id, same "one gift, one card" rule as
  // renderBands below — if the goal itself is in flight it already gets the
  // full pending/preparing treatment via renderGoalSlot, so listing it here
  // too would duplicate the same card back-to-back on screen.
  const renderInFlight = () => {
    const slot = qs('#gifts-inflight');
    if (!slot) return;
    const blocked = hasInFlightRedemption(redemptions);
    const catalogItems = items.filter((item) => item.id !== giftGoal);
    const html = renderInFlightGroup(catalogItems, redemptions, diamonds, blocked);
    slot.innerHTML = html;
    slot.classList.toggle('hidden', !html);
  };

  // "🏆 Con đã nhận" — the keepsake trophy row of delivered redemptions.
  // Deliberately NOT filtered against the catalogue bands: a delivered gift
  // is repeatable (founder decision), so it stays earnable again below.
  const renderTrophy = () => {
    const slot = qs('#gifts-trophy');
    if (!slot) return;
    const html = renderTrophyGroup(redemptions, items);
    slot.innerHTML = html;
    slot.classList.toggle('hidden', !html);
  };

  const renderGoalSlot = () => {
    const slot = qs('#gifts-goal');
    if (!slot) return;
    const goalItem = giftGoal ? items.find((item) => item.id === giftGoal) : undefined;
    if (!goalItem) {
      slot.innerHTML = '';
      slot.classList.add('hidden');
      return;
    }
    slot.classList.remove('hidden');
    slot.innerHTML = renderGoalCard(goalItem, redemptions, diamonds, hasInFlightRedemption(redemptions));
    bindCardActions(slot);
  };

  const renderBands = () => {
    const host = qs('#gifts-bands');
    if (!host) return;
    if (!items.length) {
      host.innerHTML = renderEmptyState();
      return;
    }
    const blocked = hasInFlightRedemption(redemptions);
    // The pinned goal always has its own card above (renderGoalSlot), fully
    // state-driven — including its own "Đổi quà ngay 💎" CTA when it becomes
    // affordable — so it is unconditionally excluded here. One gift, one
    // card: showing it a second time in a band (even just the "now" band)
    // would duplicate it on screen. Gifts already in flight (pending Coach
    // Felix's review or being prepared) live in the "🎁 Quà của con" section
    // above instead — a gift being bought for you is not a gift you can buy.
    const now = items.filter((item) => giftBand(item) === 'now' && item.id !== giftGoal && !isItemInFlight(item, redemptions));
    const soon = items.filter((item) => giftBand(item) === 'soon' && item.id !== giftGoal && !isItemInFlight(item, redemptions));
    const building = items.filter((item) => giftBand(item) === 'building' && item.id !== giftGoal && !isItemInFlight(item, redemptions));
    // Unavailable gifts (toggled off, or budget cap hit) get their own quiet
    // group at the very bottom, below "Con đang xây dựng" — see giftBand.
    const unavailable = items.filter((item) => giftBand(item) === 'unavailable' && item.id !== giftGoal && !isItemInFlight(item, redemptions));
    host.innerHTML = [
      renderBandSection('now', now, redemptions, diamonds, blocked),
      renderBandSection('soon', soon, redemptions, diamonds, blocked),
      renderBandSection('building', building, redemptions, diamonds, blocked),
      renderBandSection('unavailable', unavailable, redemptions, diamonds, blocked),
    ].join('');
    bindCardActions(host);
  };

  const render = () => {
    setBalance(diamonds);
    renderInFlight();
    renderGoalSlot();
    renderBands();
    renderTrophy();
  };

  const openConfirmModal = (giftId: string) => {
    const item = items.find((entry) => entry.id === giftId);
    if (!item) return;
    pendingGiftId = giftId;
    const dialog = qs('.qt-confirm-modal') as HTMLDialogElement | null;
    if (!dialog) return;

    const img = photoSrc(item);
    const photoHost = dialog.querySelector('.qt-confirm-photo');
    if (photoHost) {
      photoHost.innerHTML = renderPhotoWell({ emoji: item.emoji, name: item.name_vi, imageSrc: img, aspect: '16/9', size: 'lg', animateEmoji: !img });
    }
    const nameEl = dialog.querySelector('.qt-confirm-name');
    if (nameEl) nameEl.textContent = item.name_vi;
    const priceEl = dialog.querySelector('.qt-confirm-price');
    if (priceEl) priceEl.textContent = `${formatDiamonds(item.price_diamonds)} 💎`;
    const before = dialog.querySelector('.qt-confirm-before');
    if (before) before.textContent = `💎 ${formatDiamonds(diamonds)}`;
    const after = dialog.querySelector('.qt-confirm-after');
    if (after) after.textContent = `💎 ${formatDiamonds(Math.max(0, diamonds - item.price_diamonds))}`;

    const yesBtn = dialog.querySelector('.qt-confirm-yes') as HTMLButtonElement | null;
    if (yesBtn) yesBtn.disabled = false;

    if (typeof dialog.showModal === 'function') dialog.showModal();
  };

  const openSuccessModal = (item: GiftItem) => {
    const dialog = qs('.qt-success-modal') as HTMLDialogElement | null;
    if (!dialog) return;
    const emojiEl = dialog.querySelector('.qt-success-emoji');
    if (emojiEl) emojiEl.textContent = item.emoji;
    const nameEl = dialog.querySelector('.qt-success-name');
    if (nameEl) nameEl.textContent = item.name_vi;
    const emojiInlineEl = dialog.querySelector('.qt-success-emoji-inline');
    if (emojiInlineEl) emojiInlineEl.textContent = item.emoji;
    const balanceEl = dialog.querySelector('.qt-success-balance-value');
    if (balanceEl) balanceEl.textContent = `💎 ${formatDiamonds(diamonds)}`;
    if (typeof dialog.showModal === 'function') dialog.showModal();
  };

  // Race guard: disabled the instant the tap lands, re-enabled only on
  // failure — a second rapid tap while disabled is a no-op.
  const handleConfirmRedeem = async () => {
    const dialog = qs('.qt-confirm-modal') as HTMLDialogElement | null;
    const yesBtn = dialog?.querySelector('.qt-confirm-yes') as HTMLButtonElement | null;
    if (!dialog || !yesBtn || yesBtn.disabled || !pendingGiftId) return;
    const giftId = pendingGiftId;
    const item = items.find((entry) => entry.id === giftId);
    if (!item) return;

    yesBtn.disabled = true;
    qs('#gifts-error')?.classList.add('hidden');

    const payload = await redeemGiftRequest(accessCode, giftId);
    if (!payload.ok) {
      yesBtn.disabled = false;
      dialog.close();
      hooks.onError(payload.message || 'Không thể đổi quà. Con thử lại nhé.');
      return;
    }

    setBalance(payload.diamonds ?? diamonds);
    redemptions = Array.isArray(payload.redemptions) ? payload.redemptions : redemptions;
    items = items.map((entry) => (entry.id === giftId
      ? { ...entry, can_afford: false, progress_percent: entry.price_diamonds > 0 ? Math.max(0, Math.min(100, Math.round((diamonds / entry.price_diamonds) * 100))) : 100 }
      : entry));

    pendingGiftId = null;
    dialog.close();
    render();
    openSuccessModal(item);
  };

  const handleSetGoal = async (giftId: string | null) => {
    const payload = await setGiftGoalRequest(accessCode, giftId);
    if (!payload.ok) {
      hooks.onError(payload.message || 'Không thể lưu mục tiêu.');
      return;
    }
    giftGoal = payload.gift_goal ?? null;
    render();
  };

  const wireModals = () => {
    const confirmDialog = qs('.qt-confirm-modal') as HTMLDialogElement | null;
    confirmDialog?.querySelector('.qt-confirm-yes')?.addEventListener('click', () => {
      void handleConfirmRedeem();
    });
    confirmDialog?.querySelector('.qt-confirm-no')?.addEventListener('click', () => {
      pendingGiftId = null;
      confirmDialog.close();
    });

    const successDialog = qs('.qt-success-modal') as HTMLDialogElement | null;
    successDialog?.querySelector('.qt-success-view')?.addEventListener('click', () => {
      successDialog.close();
    });
    successDialog?.querySelector('.qt-success-close')?.addEventListener('click', () => {
      successDialog.close();
    });
  };

  const loadGifts = async () => {
    const codeInput = qs('#gifts-code') as HTMLInputElement | null;
    accessCode = (codeInput?.value || '').trim().toUpperCase();
    if (!accessCode) return;
    qs('#gifts-error')?.classList.add('hidden');

    const payload = await fetchGiftsList(accessCode);
    if (!payload.ok) {
      hooks.onError(payload.message || 'Không thể mở cửa hàng.');
      return;
    }

    items = Array.isArray(payload.items) ? payload.items : [];
    redemptions = Array.isArray(payload.redemptions) ? payload.redemptions : [];
    giftGoal = payload.gift_goal ?? null;
    diamonds = Number(payload.diamonds) || 0;

    // The reference goes straight from the top bar to the balance hero once
    // loaded — a child who arrived via ?code= should never see a form
    // re-asking for the code they just used.
    qs('#gifts-entry')?.classList.add('hidden');
    qs('#gifts-shell')?.classList.remove('hidden');
    qs('#gifts-balance-pill')?.classList.remove('hidden');
    render();
  };

  const handleLoadError = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Không thể mở cửa hàng.';
    hooks.onError(message);
  };

  wireModals();
  qs('#gifts-load')?.addEventListener('click', () => {
    loadGifts().catch(handleLoadError);
  });

  const params = new URLSearchParams(window.location.search);
  const code = (params.get('code') || '').trim().toUpperCase();
  const codeInput = qs('#gifts-code') as HTMLInputElement | null;
  if (code && codeInput) {
    codeInput.value = code;
    loadGifts().catch(handleLoadError);
  }
}
