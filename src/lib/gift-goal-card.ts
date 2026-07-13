// GiftGoalCard — the shared "here's what I'm saving for" widget shown
// OUTSIDE the shop itself: end-of-lesson (read2lead/lesson.astro), the
// child's profile (ho-so-kid-view.ts), and the parent's weekly report
// (ho-so-parent-view.ts). Two size variants — wide (lesson-end / desktop)
// and narrow (mobile / profile) — per
// "Read2Lead Real Gifts Shop/HANDOFF.md" §4 + Qua-That-Gift-Shop.dc.html
// <section id="s4">.
//
// Deliberately NOT a thin wrapper around gift-ux.ts's renderGiftCard /
// renderPhotoWell: those are private to the shop module and styled via
// src/styles/qua-that.css, which is imported ONLY by
// src/pages/read2lead/gifts.astro. The three host pages for this card
// don't load that stylesheet (adding the import to ho-so/index.astro, or
// exporting gift-ux.ts's private renderers, is outside this packet's owned
// file set), so this card renders with plain inline styles instead, built
// from the same design tokens (var(--gold) etc — global via
// design-system.css, loaded by every page through BaseLayout) and the same
// exact photo-well gradient values from HANDOFF §2, so it matches the
// shop's look without depending on its CSS classes.
//
// State logic is IMPORTED from gift-ux.ts, never re-implemented here. Every
// consumer of this card is a real ES module (lesson.astro reaches it through
// a `r2l:gift-goal` CustomEvent handled in a module <script>, not the
// `?raw` + stripInlineExports inlining used elsewhere in that file), so a
// plain import works. That matters: a near-miss goal is the single most
// motivating state in the product, and if the shop and this card ever
// disagreed about what counts as one, the child would be told two different
// things on two different screens.
//
// Motion is intentionally OFF here (no qt-pulse/qt-shimmer keyframes) —
// those belong to the shop page itself, which owns the celebratory moment;
// this widget only needs to be truthful on someone else's screen, not
// theatrical.

import { deriveGiftCardState, type GiftCardState } from './gift-ux';

/** Structural subset of gift-ux.ts's GiftItem. Any real GiftItem satisfies
 * this shape as-is; `deriveGiftCardState` is deliberately typed to accept
 * exactly the fields it reads, so this subset can be passed straight to it. */
export type GiftGoalItem = {
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

/** Structural subset of gift-ux.ts's GiftRedemption. */
export type GiftGoalRedemption = {
  gift_id: string;
  status: 'requested' | 'preparing' | 'delivered' | 'rejected';
  ts: string;
  updated_at?: string;
};

type GiftGoalState = GiftCardState;

/** The shop's own classifier — imported, never re-implemented. A second copy
 * of these rules would silently drift: change the near-miss threshold in the
 * shop and this card would keep telling the child something different on the
 * lesson, profile and parent screens. One rule, one place. */
const deriveGoalState = deriveGiftCardState;

export type GiftGoalCardVariant = 'wide' | 'narrow';
export type GiftGoalCardAudience = 'kid' | 'parent';

export type GiftGoalCardOptions = {
  variant: GiftGoalCardVariant;
  /** Controls the pronoun in captions ("Con" vs "Bé"). Default 'kid'. */
  audience?: GiftGoalCardAudience;
  /** Access code — only used to build the "no goal yet" invitation link. */
  code?: string;
  /** Override the small "kim cương đến từ đâu" caption. Pass '' to omit it
   * entirely (e.g. when the host page renders its own longer explanation
   * alongside the card, as the parent report does). */
  noteVi?: string;
};

const DEFAULT_NOTE_VI = 'Kim cương đến từ lớp học và SpeakUp!';

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

/** Image src precedence per HANDOFF §2: uploaded photo -> pasted URL -> none
 * (emoji-only fallback). Mirrors gift-ux.ts's private photoSrc(). */
function photoSrc(item: GiftGoalItem): string | null {
  if (item.image_key) return `/api/read2lead-gift-image?id=${encodeURIComponent(item.id)}`;
  if (item.image_url) return item.image_url;
  return null;
}

function newestRedemptionFor(giftId: string, redemptions: GiftGoalRedemption[]): GiftGoalRedemption | undefined {
  const matching = (Array.isArray(redemptions) ? redemptions : []).filter((entry) => entry?.gift_id === giftId);
  return matching[matching.length - 1];
}

/** The photo well, sized per variant. Same three-tier fallback as the
 * shop's GiftPhotoWell (real photo -> pasted URL -> centered emoji) but
 * with inline styles so it renders correctly without qua-that.css. */
function renderWell(item: GiftGoalItem, variant: GiftGoalCardVariant, badgeHtml: string): string {
  const img = photoSrc(item);
  const boxStyle = variant === 'wide'
    ? 'position:relative; width:118px; height:96px; flex-shrink:0; border-radius:12px; overflow:hidden;'
    : 'position:relative; aspect-ratio:16/9; overflow:hidden;';
  const emojiSize = variant === 'wide' ? '40px' : '48px';
  const imgHtml = img
    ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(item.name_vi)}" loading="lazy" onerror="this.remove()" style="position:absolute; inset:0; width:100%; height:100%; object-fit:contain; padding:10%; box-sizing:border-box;" />`
    : '';
  return `
    <div style="${boxStyle}">
      <div style="position:absolute; inset:0; background:radial-gradient(120% 120% at 50% 22%, #274563 0%, #14304600 62%), linear-gradient(180deg,#1d3f58,#11283b); box-shadow:inset 0 0 0 1px rgba(245,230,200,.10), inset 0 -30px 40px -26px rgba(0,0,0,.72); display:grid; place-items:center; font-size:${emojiSize}; line-height:1;" aria-hidden="true">${escapeHtml(item.emoji)}</div>
      ${imgHtml}
      ${badgeHtml}
    </div>
  `;
}

function progressBarHtml(percent: number, colorVar?: string): string {
  const width = Math.max(0, Math.min(100, Math.round(percent)));
  const fillClass = colorVar ? 'fx-progress__fill' : 'fx-progress__fill fx-progress__fill--gradient';
  const style = colorVar ? ` style="width:${width}%; background:${colorVar};"` : ` style="width:${width}%;"`;
  return `<span class="fx-progress"><span class="${fillClass}"${style}></span></span>`;
}

/** Per-state caption, reusing deriveGiftCardState's classification so a
 * goal in flight (pending/preparing) or already delivered never gets
 * painted over with generic "still saving" copy. */
function stateCaption(
  item: GiftGoalItem,
  state: GiftGoalState,
  diamonds: number,
  redemption: GiftGoalRedemption | undefined,
  pronoun: string,
): { text: string; color?: string } {
  const deficit = Math.max(0, item.price_diamonds - diamonds);
  switch (state) {
    case 'nearmiss':
      return { text: `Chỉ còn ${escapeHtml(formatDiamonds(deficit))} 💎 nữa thôi! 🔥`, color: 'var(--gold-light)' };
    case 'affordable':
      return { text: `${pronoun} đủ kim cương rồi 🎉`, color: 'var(--success)' };
    case 'pending':
      return { text: 'Yêu cầu đang chờ Coach Felix duyệt.', color: 'var(--cream-muted)' };
    case 'preparing':
      return { text: 'Coach Felix đang chuẩn bị quà — sắp mang tới lớp rồi! 💛', color: 'var(--cream)' };
    case 'delivered':
      return { text: `Đã nhận quà ngày ${escapeHtml(formatDateVi(redemption?.updated_at || redemption?.ts))} 🏆`, color: 'var(--success)' };
    case 'unavailable':
      // Honest, calm, no false urgency — this gift is genuinely not
      // obtainable right now (see gift-ux.ts's deriveGiftCardState). A child
      // staring daily at a progress bar for something they can never have is
      // the worst outcome this card can produce, so renderGiftGoalCard also
      // appends a one-tap "choose a different goal" link when this state
      // renders (see renderChooseDifferentGoalLink below) — never leave it
      // as just this line with no way out.
      return { text: 'Món quà này tạm thời chưa đổi được. Coach Felix sẽ mở lại sau nhé!', color: 'var(--cream-muted)' };
    default: {
      const percent = item.price_diamonds > 0 ? Math.round((diamonds / item.price_diamonds) * 100) : 100;
      return percent >= 50
        ? { text: `${pronoun} đã đi được ${percent}% chặng đường · còn ${escapeHtml(formatDiamonds(deficit))} 💎` }
        : { text: `${pronoun} đã đi được ${Math.max(0, percent)}% chặng đường` };
    }
  }
}

/** One-tap escape hatch for an `unavailable` pinned goal — a child staring
 * daily at a progress bar for something they can never have is the worst
 * outcome this card can produce, so this is never left as just the honest
 * caption with no way out. Links straight to the shop (same destination as
 * renderInvite's "no goal yet" CTA) where the full catalogue — including
 * "Đặt làm mục tiêu ★" on every still-available card — is one screen away. */
function renderChooseDifferentGoalLink(options: GiftGoalCardOptions): string {
  const href = options.code ? `/read2lead/gifts?code=${encodeURIComponent(options.code)}` : '/read2lead/gifts';
  return `<a href="${escapeHtml(href)}" class="fx-btn fx-btn--secondary" style="margin-top:10px; min-height:44px; display:inline-flex; align-items:center; justify-content:center;">Chọn mục tiêu khác 🎁</a>`;
}

function renderInvite(options: GiftGoalCardOptions): string {
  const href = options.code ? `/read2lead/gifts?code=${encodeURIComponent(options.code)}` : '/read2lead/gifts';
  const copy = options.audience === 'parent'
    ? 'Con chưa chọn quà để dành dụm. Một mục tiêu rõ ràng giúp con háo hức đến lớp hơn!'
    : 'Con chưa chọn quà để dành dụm — chọn ngay một món quà con thích nhé!';
  const pad = options.variant === 'wide' ? '20px' : '16px';
  return `
    <div style="border-radius:16px; border:1px dashed var(--border-strong); background:color-mix(in srgb, var(--cream) 3%, transparent); padding:${pad}; text-align:center;">
      <span style="font-size:32px;" aria-hidden="true">🎁</span>
      <p style="margin:8px 0 0; color:var(--cream); font-family:var(--font-display); font-weight:800; font-size:15px;">Chưa có mục tiêu</p>
      <p style="margin:6px 0 0; color:var(--cream-muted); font-size:13px; line-height:1.5;">${escapeHtml(copy)}</p>
      <a href="${escapeHtml(href)}" class="fx-btn fx-btn--secondary" style="margin-top:12px; min-height:44px; display:inline-flex; align-items:center; justify-content:center;">Chọn quà ngay 🎁</a>
    </div>
  `;
}

/**
 * Renders the GiftGoalCard as an HTML string ready for `.innerHTML`.
 * `item === null` renders the "no goal yet" invitation — per the packet,
 * "a child with no goal is the one the whole mechanic is failing to reach."
 */
export function renderGiftGoalCard(
  item: GiftGoalItem | null,
  diamonds: number,
  redemptions: GiftGoalRedemption[],
  options: GiftGoalCardOptions,
): string {
  if (!item) return renderInvite(options);

  const variant = options.variant;
  const audience: GiftGoalCardAudience = options.audience || 'kid';
  const pronoun = audience === 'parent' ? 'Bé' : 'Con';
  const state = deriveGoalState(item, redemptions);
  const redemption = newestRedemptionFor(item.id, redemptions);
  const price = formatDiamonds(item.price_diamonds);
  const caption = stateCaption(item, state, diamonds, redemption, pronoun);
  const noteVi = options.noteVi ?? DEFAULT_NOTE_VI;

  const stateBorder: Partial<Record<string, string>> = {
    nearmiss: 'var(--gold-light)',
    affordable: 'color-mix(in srgb, var(--success) 40%, transparent)',
    delivered: 'color-mix(in srgb, var(--success) 40%, transparent)',
    // Quiet, not the excited gold-light nearmiss uses — this is a pause, not
    // the loudest moment in the app.
    unavailable: 'var(--border-subtle)',
  };
  const borderColor = stateBorder[state] || 'var(--accent-border)';
  const chooseDifferentGoalHtml = state === 'unavailable' ? renderChooseDifferentGoalLink(options) : '';

  const isDone = state === 'affordable' || state === 'delivered';
  // A gift priced 0 is a broken admin row, never obtainable (isGiftAvailable
  // in functions/api/_gifts-v2.js). This fallback used to read 100 — back when
  // a price-0 gift really WAS free — and after that changed it left a full
  // gold bar sitting directly above "Món quà này tạm thời chưa đổi được." on
  // the child's profile, the lesson-completion card AND the parent report.
  // 0 is the honest number: there is no progress toward a gift with no price.
  const percent = isDone
    ? 100
    : item.price_diamonds > 0 ? Math.round((diamonds / item.price_diamonds) * 100) : 0;
  const bar = progressBarHtml(percent, isDone ? 'var(--success)' : undefined);

  const captionStyle = `margin:8px 0 0; color:${caption.color || 'var(--cream-muted)'}; font-size:${variant === 'wide' ? '12.5px' : '12px'};${caption.color ? ' font-weight:700;' : ''}`;
  const noteHtml = noteVi
    ? `<p style="margin:6px 0 0; color:var(--cream-muted); font-size:${variant === 'wide' ? '12.5px' : '12px'};">${escapeHtml(noteVi)}</p>`
    : '';
  const eyebrowVi = audience === 'parent' ? '★ Mục tiêu của bé' : '★ Mục tiêu của con';

  if (variant === 'wide') {
    const well = renderWell(item, 'wide', '');
    return `
      <div class="qtgc-card" data-state="${escapeHtml(state)}" style="display:flex; gap:16px; align-items:center; padding:14px; border-radius:16px; border:1px solid ${borderColor}; background:linear-gradient(135deg, color-mix(in srgb,var(--gold) 13%,transparent), color-mix(in srgb,var(--navy-900) 82%,transparent) 60%);">
        ${well}
        <div style="flex:1; min-width:0;">
          <p class="fx-eyebrow" style="margin:0; color:var(--gold-light);">${eyebrowVi}</p>
          <div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-top:5px;"><strong style="font-family:var(--font-display); font-size:18px; color:var(--cream);">${escapeHtml(item.emoji)} ${escapeHtml(item.name_vi)}</strong><span style="font-family:var(--font-display); font-weight:800; color:var(--gold-light); font-size:14px; font-variant-numeric:tabular-nums;">${escapeHtml(formatDiamonds(diamonds))} / ${price} 💎</span></div>
          ${bar}
          <p style="${captionStyle}">${caption.text}</p>
          ${noteHtml}
          ${chooseDifferentGoalHtml}
        </div>
      </div>
    `;
  }

  // narrow
  const badge = '<span class="fx-badge fx-badge--gold" style="position:absolute; top:9px; left:9px;">★ Mục tiêu</span>';
  const well = renderWell(item, 'narrow', badge);
  return `
    <div class="qtgc-card" data-state="${escapeHtml(state)}" style="border-radius:16px; overflow:hidden; border:1px solid ${borderColor}; background:linear-gradient(160deg, color-mix(in srgb,var(--gold) 12%,transparent), color-mix(in srgb,var(--navy-900) 84%,transparent) 55%);">
      ${well}
      <div style="padding:14px 16px 16px;">
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px;"><strong style="font-family:var(--font-display); font-size:17px; color:var(--cream);">${escapeHtml(item.name_vi)}</strong><span style="font-family:var(--font-display); font-weight:800; color:var(--gold-light); font-size:13px; font-variant-numeric:tabular-nums;">${escapeHtml(formatDiamonds(diamonds))} / ${price} 💎</span></div>
        ${bar}
        <p style="${captionStyle}">${caption.text}</p>
        ${noteHtml}
        ${chooseDifferentGoalHtml}
      </div>
    </div>
  `;
}
