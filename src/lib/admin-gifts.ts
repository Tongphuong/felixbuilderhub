// "Quà thật" (Real Gifts) admin tools — R2L-REAL-GIFTS §6 + §7. Founder-only
// (Coach Felix, non-technical). Mirrors src/lib/gift-ux.ts's shape (pure
// helpers + template-string renderers + a single init*(...) controller, no
// framework) but this is the OTHER side of the same economy: full records
// including cost_vnd (never sent to a kid), and the two admin surfaces
// Felix actually opens — the gift manager (§6) and the redemption queue,
// i.e. his shopping list (§7).
//
// admin-shared.mjs's escapeHtml is a documented no-op (see its own comment
// history / HANDOFF) — this file does NOT import it and defines its own,
// same as gift-ux.ts does.

import { giftPhotoSrc } from './gift-photo';

export type AdminGift = {
  id: string;
  name_vi: string;
  emoji: string;
  image_key: string | null;
  image_url: string | null;
  price_diamonds: number;
  limit_total: number | null;
  redeemed_count: number;
  cost_vnd: number;
  active: boolean;
};

export type RedemptionStatus = 'requested' | 'preparing' | 'delivered' | 'rejected';

export type RedemptionRow = {
  redemption_id: string;
  code: string;
  student_name: string;
  gift_id: string;
  name_vi: string;
  price_diamonds: number;
  status: RedemptionStatus;
  ts: string;
  cost_vnd: number;
  days_waiting: number;
  diamonds_taken?: boolean;
};

export type RedemptionGroups = {
  requested: RedemptionRow[];
  preparing: RedemptionRow[];
  delivered: RedemptionRow[];
  rejected: RedemptionRow[];
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests — see tests/admin-gifts-page.test.mjs)
// ---------------------------------------------------------------------------

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatNumberVi(value: number): string {
  return (Number(value) || 0).toLocaleString('vi-VN');
}

export function formatVnd(value: number): string {
  return `${formatNumberVi(value)}₫`;
}

/**
 * The quiet ₫/💎 signal (HANDOFF §6): cost_vnd ÷ price_diamonds, rounded.
 * Exists so Felix notices his OWN pricing is inconsistent (milk tea ~3₫/💎,
 * Lego ~20₫/💎) — a useful number, never an alarm. Returns null when the
 * diamond price is 0 (nothing to divide by) so the caller renders "—".
 */
export function costPerDiamond(gift: Pick<AdminGift, 'cost_vnd' | 'price_diamonds'>): number | null {
  const price = Number(gift.price_diamonds) || 0;
  if (price <= 0) return null;
  return Math.round((Number(gift.cost_vnd) || 0) / price);
}

export function costPerDiamondLabel(gift: Pick<AdminGift, 'cost_vnd' | 'price_diamonds'>): string {
  const value = costPerDiamond(gift);
  return value === null ? '—' : `≈ ${formatNumberVi(value)}₫`;
}

/**
 * A ₫/💎 this high is worth Felix's attention when he's next repricing —
 * still not an alarm (no red/danger styling), just a slightly warmer
 * highlight. 10₫/💎 sits between milk tea (~3₫/💎) and Lego (~20₫/💎) in the
 * HANDOFF §3 real catalogue, so it separates "normal" gifts from the
 * Lego-like outliers without flagging every mid-priced item.
 */
export const NOTABLE_COST_PER_DIAMOND = 10;
export function isNotableCostPerDiamond(gift: Pick<AdminGift, 'cost_vnd' | 'price_diamonds'>): boolean {
  const value = costPerDiamond(gift);
  return value !== null && value >= NOTABLE_COST_PER_DIAMOND;
}

/** Which photo path is actually in use — same upload-wins-over-url
 * precedence as gift-ux.ts's photoSrc() on the kid-facing shop, so the
 * "Đang dùng" badge here always matches what a child would actually see. */
export type PhotoSource = 'upload' | 'url' | 'none';
export function activePhotoSource(gift: Pick<AdminGift, 'image_key' | 'image_url'>): PhotoSource {
  if (gift.image_key) return 'upload';
  if (gift.image_url) return 'url';
  return 'none';
}

/**
 * Delegates to the single source of truth (src/lib/gift-photo.ts). "Must stay in
 * lockstep with gift-ux.ts" was the old comment here, and lockstep is exactly what
 * a hand-copied function does not do: when the photo-cache bug was fixed, one of
 * the three copies was missed. It matters twice over on this surface — the admin
 * preview is where Coach Felix decides whether a photo is any good, so a stale one
 * would lie to him about the exact thing he opened it to check.
 */
export const adminPhotoSrc = (gift: Pick<AdminGift, 'id' | 'image_key' | 'image_url'>): string | null =>
  giftPhotoSrc(gift);

/**
 * A child waiting this many days for a "preparing" gift is a promise about
 * to break (HANDOFF §7's Ryan/9-days example) — tinted danger and called
 * out loudly. A week is the natural boundary: Felix coaches on a weekly
 * class cadence, so "preparing" past one full cycle means the gift has
 * already missed a class it could have been handed over in.
 */
export const URGENT_WAIT_DAYS = 7;
export function isUrgentWait(daysWaiting: number): boolean {
  return (Number(daysWaiting) || 0) >= URGENT_WAIT_DAYS;
}

export function waitingLabel(daysWaiting: number): string {
  const days = Math.max(0, Math.trunc(Number(daysWaiting) || 0));
  if (days <= 0) return 'hôm nay';
  if (days === 1) return 'chờ 1 ngày';
  return `chờ ${days} ngày`;
}

/** DD/MM, matching the reference mock's "✓ 02/07" exactly. Built by hand
 * rather than via Intl.DateTimeFormat's vi-VN day+month shorthand, which
 * renders "02-07" (hyphen, not slash) on this runtime's ICU data. */
export function formatDateVi(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

/**
 * A price-0 gift that is still `active` is not a real gift — it is an
 * unfinished admin row ("+ Thêm quà" creates one with price 0). Before this
 * guard existed such a row (the production "Quà 8" incident) went live as
 * FREE, since can_afford is `diamonds >= price`, which every child
 * satisfies. Mirrors the server-side guard in functions/api/_gifts-v2.js's
 * isGiftAvailable (Elon's file — not duplicated here, just the same rule
 * enforced client-side too, so Felix never even gets to the network call).
 */
export function isInvalidActiveGift(gift: Pick<AdminGift, 'active' | 'price_diamonds'>): boolean {
  return Boolean(gift.active) && (Number(gift.price_diamonds) || 0) < 1;
}

/** First row index that fails isInvalidActiveGift, or -1 when the whole
 * catalogue is save-safe. Index-based (not id-based) because a brand-new
 * "+ Thêm quà" row has no id yet. */
export function findInvalidActiveGiftIndex(gifts: AdminGift[]): number {
  return gifts.findIndex((gift) => isInvalidActiveGift(gift));
}

/** Known image-CDN hosts a pasted Shopee/Lazada/Tiki link resolves to — kept
 * alongside the file-extension check so a real image URL that happens to
 * have no extension in its path (common on these CDNs) is still accepted. */
const KNOWN_IMAGE_HOSTS = new Set([
  'down-vn.img.susercontent.com', // Shopee's actual image host
  'lzd-img-global.slatic.net',
  'cf.shopee.vn',
  'salt.tikicdn.com',
  'img.lazcdn.com',
]);
const IMAGE_URL_EXTENSION_RE = /\.(jpg|jpeg|png|webp|gif|avif)$/i;

/**
 * Does this pasted URL look like a direct image link, not a product page?
 * The production incident this guards against: Coach Felix pasted
 * `https://shopee.vn/...-i.1253087927.26035316034` (an HTML product page)
 * into this field and it was accepted silently — the gift then had no
 * working photo and nothing told him why. An empty value is valid (clearing
 * the field is always allowed; the gift just falls back to its emoji).
 */
export function isLikelyImageUrl(value: string): boolean {
  const trimmed = (value || '').trim();
  if (!trimmed) return true;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (IMAGE_URL_EXTENSION_RE.test(url.pathname)) return true;
  return KNOWN_IMAGE_HOSTS.has(url.hostname);
}

/**
 * Pure model of what deleting the gift at `index` does to the collected
 * catalogue array — order-preserving removal of exactly one element. The
 * live DOM flow (initGiftManager's delete-gift handler) reaches the
 * identical result by removing the `<div data-ag-row>` and letting the next
 * collectAll() read the remaining rows in their existing document order, so
 * this documents and unit-tests that invariant without needing a DOM
 * harness for it.
 */
export function removeGiftAt(gifts: AdminGift[], index: number): AdminGift[] {
  return gifts.filter((_, i) => i !== index);
}

// ---------------------------------------------------------------------------
// §6 — Gift manager rendering
// ---------------------------------------------------------------------------

export function renderGiftPhotoThumb(gift: Pick<AdminGift, 'id' | 'emoji' | 'image_key' | 'image_url'>, size = 56, extraClass = ''): string {
  const src = adminPhotoSrc(gift);
  const img = src
    ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.remove()" onload="this.closest('.ag-thumb')?.classList.add('ag-thumb--has-img')" class="ag-thumb__img" data-ag-thumb-img />`
    : '';
  return `
    <span class="ag-thumb${extraClass ? ` ${extraClass}` : ''}" style="width:${size}px; height:${size}px;">
      <span class="ag-thumb__emoji" aria-hidden="true" data-ag-thumb-emoji>${escapeHtml(gift.emoji || '🎁')}</span>
      ${img}
    </span>
  `;
}

/**
 * One catalogue row. Every basic field is a live input (the editable-rows
 * pattern from admin/classes.astro's preset editor — Felix already knows
 * it: everything is a text/number field, one Save button at the top commits
 * the whole table). The photo dual-path editor (URL + upload, both
 * first-class per HANDOFF §2) lives in a per-row <details> so seven rows'
 * worth of it isn't on screen at once — expanding it never hides or resets
 * the basic fields above, which stay live inputs either way.
 */
export function renderGiftRow(gift: AdminGift, index: number): string {
  const cpdLabel = costPerDiamondLabel(gift);
  const cpdNotable = isNotableCostPerDiamond(gift);
  const activeSource = activePhotoSource(gift);
  const limitValue = gift.limit_total === null || gift.limit_total === undefined ? '' : String(gift.limit_total);
  const usedHint = gift.limit_total !== null && gift.limit_total !== undefined
    ? `<span class="ag-limit-used">đã dùng ${formatNumberVi(gift.redeemed_count)}</span>`
    : '';

  return `
    <div class="ag-row" data-ag-row data-gift-id="${escapeHtml(gift.id)}" data-emoji="${escapeHtml(gift.emoji || '🎁')}" data-image-key="${escapeHtml(gift.image_key || '')}" data-redeemed-count="${Number(gift.redeemed_count) || 0}" data-index="${index}">
      <div class="ag-row__grid">
        <button type="button" class="ag-thumb-btn" data-ag-action="toggle-photo" aria-expanded="false" aria-label="Sửa ảnh — ${escapeHtml(gift.name_vi || 'quà mới')}">
          ${renderGiftPhotoThumb(gift)}
        </button>
        <input class="fx-field ag-input" data-field="name_vi" value="${escapeHtml(gift.name_vi)}" placeholder="Tên quà" aria-label="Tên quà" maxlength="80" />
        <input class="fx-field ag-input ag-input--num" data-field="price_diamonds" type="number" min="0" step="500" inputmode="numeric" value="${Number(gift.price_diamonds) || 0}" aria-label="Giá bằng kim cương" />
        <div class="ag-limit-cell">
          <input class="fx-field ag-input ag-input--num" data-field="limit_total" type="number" min="0" step="1" inputmode="numeric" placeholder="—" value="${escapeHtml(limitValue)}" aria-label="Giới hạn ngân sách — để trống nếu không giới hạn" />
          ${usedHint}
        </div>
        <button type="button" role="switch" aria-checked="${gift.active ? 'true' : 'false'}" class="ag-switch${gift.active ? ' ag-switch--on' : ''}" data-ag-action="toggle-active" aria-label="Bật hoặc tắt quà — ${escapeHtml(gift.name_vi || 'quà mới')}">
          <span class="ag-switch__knob"></span>
        </button>
        <input class="fx-field ag-input ag-input--num ag-input--locked" data-field="cost_vnd" type="number" min="0" step="1000" inputmode="numeric" value="${Number(gift.cost_vnd) || 0}" aria-label="Giá thật, chỉ Felix thấy" />
        <div class="ag-cpd${cpdNotable ? ' ag-cpd--notable' : ''}" title="Giá thật chia giá 💎 — số để Felix cân nhắc, không phải cảnh báo">${cpdLabel}</div>
        <button type="button" class="fx-btn fx-btn--ghost ag-delete-btn" data-ag-action="delete-gift" aria-label="Xoá quà — ${escapeHtml(gift.name_vi || 'quà mới')}" title="Xoá quà này">🗑</button>
      </div>

      <details class="ag-photo-details" data-ag-photo-details>
        <summary class="ag-photo-summary">Ảnh quà</summary>
        <div class="ag-photo-grid">
          <div class="ag-photo-path${activeSource === 'url' ? ' ag-photo-path--active' : ''}" data-ag-photo-path="url">
            <div class="ag-photo-path__head">
              <label class="fx-label" style="margin:0;">🔗 Dán link ảnh (Shopee/Lazada)</label>
              <span class="fx-badge fx-badge--gold ag-photo-badge"${activeSource === 'url' ? '' : ' hidden'} data-ag-badge="url">Đang dùng</span>
            </div>
            <input class="fx-field ag-input" data-field="image_url" data-ag-url-input type="url" placeholder="https://..." value="${escapeHtml(gift.image_url || '')}" style="margin-top:8px;" />
            <p class="fx-field-hint">Cần LINK ẢNH, không phải link sản phẩm. Trên Shopee: bấm chuột phải vào ảnh → "Sao chép địa chỉ hình ảnh". Link đúng thường kết thúc bằng .jpg / .png / .webp.</p>
            <p class="ag-url-warning" data-ag-url-warning hidden>⚠ Link này trông không phải link ảnh — có thể đây là link trang sản phẩm. Ảnh sẽ không hiện ra.</p>
          </div>
          <div class="ag-photo-path${activeSource === 'upload' ? ' ag-photo-path--active' : ''}" data-ag-photo-path="upload">
            <div class="ag-photo-path__head">
              <label class="fx-label" style="margin:0;">📁 Hoặc tải ảnh từ máy</label>
              <span class="fx-badge fx-badge--gold ag-photo-badge"${activeSource === 'upload' ? '' : ' hidden'} data-ag-badge="upload">Đang dùng</span>
            </div>
            <label class="ag-upload">
              <input type="file" accept="image/jpeg,image/png,image/webp" data-ag-file hidden />
              <span class="ag-upload__pick">Chọn tệp…</span>
              <span class="ag-upload__status" data-ag-upload-status>${gift.image_key ? 'đã tải ảnh' : 'chưa chọn'}</span>
            </label>
            <p class="fx-field-hint">Ảnh con tải sẵn về máy (tối đa 2MB).</p>
          </div>
        </div>
        <div class="ag-photo-preview">
          <p class="fx-eyebrow" style="margin:0 0 8px;">Xem trước</p>
          ${renderGiftPhotoThumb(gift, 96)}
          <p class="ag-preview-note">Ảnh này chính là ảnh con sẽ thấy. Nếu ở đây trông sai, con cũng sẽ thấy sai.</p>
        </div>
        <div class="ag-photo-actions">
          <button type="button" class="fx-btn fx-btn--secondary" data-ag-action="remove-photo">Xoá ảnh</button>
          <button type="button" class="fx-btn fx-btn--ghost" data-ag-action="close-photo">Đóng</button>
        </div>
      </details>
    </div>
  `;
}

export function renderGiftManagerColumnHeaders(): string {
  return `
    <div class="ag-columns" aria-hidden="true">
      <span>Ảnh</span><span>Tên quà</span><span>Giá 💎</span><span>Giới hạn</span><span>Bật</span>
      <span class="ag-columns__locked">Giá thật ₫ 🔒</span><span class="ag-columns__locked">₫/💎 🔒</span><span></span>
    </div>
  `;
}

export function renderGiftRows(gifts: AdminGift[]): string {
  if (!gifts.length) {
    return `<div class="ag-empty">Chưa có quà nào — bấm "+ Thêm quà" để thêm món đầu tiên.</div>`;
  }
  return gifts.map((gift, index) => renderGiftRow(gift, index)).join('');
}

// ---------------------------------------------------------------------------
// §7 — Redemption queue ("danh sách đi mua") rendering
// ---------------------------------------------------------------------------

/** Lookup used to give each queue row its OWN gift's emoji/photo (🌟 for a
 * sticker request, 🧋 for milk tea, …) instead of one generic box for every
 * row — matches the HANDOFF §7 reference and makes the queue scannable at a
 * glance on a phone. The redemption row itself carries no photo fields (see
 * functions/api/admin/gifts/redemptions.js), so the queue controller passes
 * the already-loaded catalogue in; a gift_id with no match (e.g. removed
 * from the catalogue since redeemed) falls back to a generic 🎁. */
export type GiftLookup = Map<string, Pick<AdminGift, 'id' | 'emoji' | 'image_key' | 'image_url'>>;

function rowThumb(row: RedemptionRow, urgent: boolean, giftsById: GiftLookup): string {
  const gift = giftsById.get(row.gift_id) || { id: row.gift_id, emoji: '🎁', image_key: null, image_url: null };
  return renderGiftPhotoThumb(gift, 48, urgent ? 'ag-thumb--urgent' : '');
}

/** The hard-warning banner for a queue row whose diamonds were never
 * actually taken (crash between the two writes — see functions/api/admin/
 * gifts/redemptions.js's isRedemptionInChildLedger). Acting on such a row
 * means buying a real gift for a child who never paid, so it must be
 * unmistakable and the buy/deliver action must be disabled, not just muted. */
function phantomBannerHtml(): string {
  return `<p class="ag-q-phantom">⚠ Chưa trừ kim cương — đừng mua</p>`;
}

export function renderRequestedRow(row: RedemptionRow, giftsById: GiftLookup = new Map()): string {
  const isPhantom = row.diamonds_taken === false;
  return `
    <div class="ag-q-row${isPhantom ? ' ag-q-row--phantom' : ''}" data-ag-q-row data-redemption-id="${escapeHtml(row.redemption_id)}">
      ${rowThumb(row, false, giftsById)}
      <div class="ag-q-row__body">
        ${isPhantom ? phantomBannerHtml() : ''}
        <strong class="ag-q-name">${escapeHtml(row.student_name || row.code)}</strong>
        <p class="ag-q-meta">${escapeHtml(row.name_vi)} · <strong class="ag-q-price">${formatNumberVi(row.price_diamonds)} 💎</strong> · hôm nay</p>
      </div>
      <div class="ag-q-actions">
        <button type="button" class="fx-btn fx-btn--secondary ag-q-btn" data-ag-q-action="reject" data-status="rejected">Từ chối + hoàn 💎</button>
        <button type="button" class="fx-btn fx-btn--primary ag-q-btn" data-ag-q-action="accept" data-status="preparing"${isPhantom ? ' disabled aria-disabled="true" title="Chưa trừ kim cương — không có gì để đi mua"' : ''}>Nhận &amp; đi mua →</button>
      </div>
    </div>
  `;
}

export function renderPreparingRow(row: RedemptionRow, giftsById: GiftLookup = new Map()): string {
  const isPhantom = row.diamonds_taken === false;
  const urgent = isUrgentWait(row.days_waiting);
  const waitBadge = urgent
    ? `<span class="fx-badge ag-q-urgent-badge">⚠ ${escapeHtml(waitingLabel(row.days_waiting))}</span>`
    : `<span class="ag-q-wait">${escapeHtml(waitingLabel(row.days_waiting))}</span>`;
  return `
    <div class="ag-q-row${urgent ? ' ag-q-row--urgent' : ''}${isPhantom ? ' ag-q-row--phantom' : ''}" data-ag-q-row data-redemption-id="${escapeHtml(row.redemption_id)}">
      ${rowThumb(row, urgent, giftsById)}
      <div class="ag-q-row__body">
        ${isPhantom ? phantomBannerHtml() : ''}
        <span class="ag-q-name-line"><strong class="ag-q-name">${escapeHtml(row.student_name || row.code)}</strong> ${waitBadge}</span>
        <p class="ag-q-meta">${escapeHtml(row.name_vi)} · <strong class="ag-q-price">${formatNumberVi(row.price_diamonds)} 💎</strong>${urgent ? ' · <span class="ag-q-urgent-text">lời hứa sắp trễ!</span>' : ''}</p>
      </div>
      <div class="ag-q-actions">
        <button type="button" class="fx-btn fx-btn--ghost ag-q-btn" data-ag-q-action="reject" data-status="rejected">Từ chối</button>
        <button type="button" class="fx-btn fx-btn--primary ag-q-btn" data-ag-q-action="deliver" data-status="delivered"${isPhantom ? ' disabled aria-disabled="true" title="Chưa trừ kim cương — đừng mua và trao quà này"' : ''}>✓ Đã trao ở lớp</button>
      </div>
    </div>
  `;
}

export function renderDeliveredRow(row: RedemptionRow, giftsById: GiftLookup = new Map()): string {
  return `
    <div class="ag-q-row ag-q-row--history" data-redemption-id="${escapeHtml(row.redemption_id)}">
      ${rowThumb(row, false, giftsById)}
      <div class="ag-q-row__body">
        <strong class="ag-q-name">${escapeHtml(row.student_name || row.code)}</strong>
        <span class="ag-q-meta">${escapeHtml(row.name_vi)} · ${formatNumberVi(row.price_diamonds)} 💎</span>
      </div>
      <span class="ag-q-done">✓ ${escapeHtml(formatDateVi(row.ts))}</span>
      <span class="ag-q-cost">${formatVnd(row.cost_vnd)}</span>
    </div>
  `;
}

export function renderQueueLane(title: string, rows: RedemptionRow[], renderRow: (row: RedemptionRow) => string, dotClass: string): string {
  return `
    <div class="ag-q-lane">
      <div class="ag-q-lane__head"><span class="ag-q-dot ${dotClass}"></span><p class="fx-eyebrow" style="margin:0; color:var(--cream);">${escapeHtml(title)} · ${rows.length}</p></div>
      ${rows.length ? rows.map(renderRow).join('') : '<p class="ag-q-lane-empty">Không có gì ở đây.</p>'}
    </div>
  `;
}

export function renderQueue(groups: RedemptionGroups, totalCostVndThisMonth: number, giftsById: GiftLookup = new Map()): string {
  const monthLabel = new Intl.DateTimeFormat('vi-VN', { month: '2-digit' }).format(new Date());
  return `
    <div class="ag-q-header">
      <div>
        <p class="fx-eyebrow" style="margin:0; color:var(--gold-light);">Trang quản trị · chỉ Felix thấy 🔒</p>
        <p class="ag-q-title">Hàng chờ đổi quà</p>
      </div>
      <div class="ag-q-total">
        <span class="ag-q-total__label">Tháng ${escapeHtml(monthLabel)} · chi phí quà 🔒</span>
        <strong class="ag-q-total__value">${formatVnd(totalCostVndThisMonth)}</strong>
      </div>
    </div>

    ${renderQueueLane('Yêu cầu mới', groups.requested, (row) => renderRequestedRow(row, giftsById), 'ag-q-dot--new')}
    ${renderQueueLane('Đang chuẩn bị · đang đi mua', groups.preparing, (row) => renderPreparingRow(row, giftsById), 'ag-q-dot--prep')}

    <div class="ag-q-reassure">
      <span aria-hidden="true">↩️</span>
      <p>Bấm <strong style="color:var(--success);">Từ chối</strong> là <strong style="color:var(--cream);">tự động hoàn lại toàn bộ 💎</strong> cho con ngay. Coach Felix cứ yên tâm từ chối nếu hết món hoặc không mua được — con không mất gì.</p>
    </div>

    ${renderQueueLane('Đã trao quà · tháng này', groups.delivered, (row) => renderDeliveredRow(row, giftsById), 'ag-q-dot--done')}
  `;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export async function fetchGifts(): Promise<{ ok: boolean; gifts?: AdminGift[]; message?: string }> {
  try {
    const res = await fetch('/api/admin/gifts');
    return await res.json();
  } catch {
    return { ok: false, message: 'Không tải được danh sách quà.' };
  }
}

export async function saveGifts(gifts: AdminGift[]): Promise<{ ok: boolean; gifts?: AdminGift[]; message?: string; error?: string }> {
  try {
    const res = await fetch('/api/admin/gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gifts }),
    });
    return await res.json();
  } catch {
    return { ok: false, message: 'Không lưu được. Thử lại nhé.' };
  }
}

export async function uploadGiftPhoto(giftId: string, file: File): Promise<{ ok: boolean; image_key?: string; message?: string; error?: string }> {
  try {
    const form = new FormData();
    form.append('gift_id', giftId);
    form.append('image', file, file.name || 'photo');
    const res = await fetch('/api/admin/gifts/upload', { method: 'POST', body: form });
    return await res.json();
  } catch {
    return { ok: false, message: 'Không tải được ảnh. Thử lại nhé.' };
  }
}

export async function fetchRedemptionQueue(): Promise<{ ok: boolean; groups?: RedemptionGroups; total_cost_vnd_this_month?: number; message?: string }> {
  try {
    const res = await fetch('/api/admin/gifts/redemptions');
    return await res.json();
  } catch {
    return { ok: false, message: 'Không tải được hàng chờ.' };
  }
}

export async function patchRedemption(redemptionId: string, status: RedemptionStatus): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`/api/admin/gifts/redemptions/${encodeURIComponent(redemptionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return await res.json();
  } catch {
    return { ok: false, message: 'Không cập nhật được. Thử lại nhé.' };
  }
}

// ---------------------------------------------------------------------------
// §6 controller — the gift manager
// ---------------------------------------------------------------------------

function readGiftFromRow(row: HTMLElement): AdminGift {
  const q = (sel: string) => row.querySelector<HTMLInputElement>(sel);
  const nameVi = q('[data-field="name_vi"]')?.value ?? '';
  const priceDiamonds = Number(q('[data-field="price_diamonds"]')?.value || 0);
  const limitRaw = q('[data-field="limit_total"]')?.value ?? '';
  const costVnd = Number(q('[data-field="cost_vnd"]')?.value || 0);
  const imageUrl = q('[data-field="image_url"]')?.value ?? '';
  const active = row.querySelector('[data-ag-action="toggle-active"]')?.getAttribute('aria-checked') === 'true';
  return {
    id: row.dataset.giftId || '',
    name_vi: nameVi,
    emoji: row.dataset.emoji || '🎁',
    image_key: row.dataset.imageKey || null,
    image_url: imageUrl || null,
    price_diamonds: priceDiamonds,
    limit_total: limitRaw === '' ? null : Number(limitRaw),
    redeemed_count: Number(row.dataset.redeemedCount || 0),
    cost_vnd: costVnd,
    active,
  };
}

function updateRowPhotoUi(row: HTMLElement, gift: Pick<AdminGift, 'id' | 'emoji' | 'image_key' | 'image_url'>): void {
  const source = activePhotoSource(gift);
  const src = adminPhotoSrc(gift);
  row.querySelectorAll<HTMLImageElement>('[data-ag-thumb-img]').forEach((el) => { el.remove(); });
  // Reset the fallback state on every well in the row first — otherwise a
  // well that previously had a working photo would keep hiding its emoji
  // fallback even after the src is cleared/changed to something broken.
  row.querySelectorAll<HTMLElement>('.ag-thumb').forEach((well) => { well.classList.remove('ag-thumb--has-img'); });
  if (src) {
    row.querySelectorAll<HTMLElement>('.ag-thumb').forEach((well) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      img.className = 'ag-thumb__img';
      img.dataset.agThumbImg = '';
      img.onerror = () => img.remove();
      // The admin preview must tell the truth: only hide the emoji once the
      // image has actually decoded, same as renderGiftPhotoThumb's onload —
      // never leave a transparent/broken photo silently stacked over it.
      img.onload = () => well.classList.add('ag-thumb--has-img');
      well.appendChild(img);
    });
  }
  row.querySelectorAll<HTMLElement>('[data-ag-badge]').forEach((badge) => {
    const which = badge.dataset.agBadge;
    badge.hidden = which !== source;
  });
  row.querySelectorAll<HTMLElement>('[data-ag-photo-path]').forEach((path) => {
    path.classList.toggle('ag-photo-path--active', path.dataset.agPhotoPath === source);
  });
}

export type GiftManagerHooks = {
  onError: (message: string) => void;
};

export function initGiftManager(hooks: GiftManagerHooks): void {
  const rowsHost = document.getElementById('gifts-mgr-rows');
  const addBtn = document.getElementById('gifts-mgr-add') as HTMLButtonElement | null;
  const saveBtn = document.getElementById('gifts-mgr-save') as HTMLButtonElement | null;
  const countLabel = document.getElementById('gifts-mgr-count');
  if (!rowsHost || !addBtn || !saveBtn) return;

  let rowCounter = 0;
  let saveResetTimer: ReturnType<typeof setTimeout> | undefined;

  const setCount = (n: number) => {
    if (countLabel) countLabel.textContent = `Quà thật — ${n} món`;
  };

  const render = (gifts: AdminGift[]) => {
    rowsHost.innerHTML = renderGiftRows(gifts);
    rowCounter = gifts.length;
    setCount(gifts.length);
  };

  const collectAll = (): AdminGift[] => Array.from(rowsHost.querySelectorAll<HTMLElement>('[data-ag-row]')).map(readGiftFromRow);

  const load = async () => {
    const payload = await fetchGifts();
    if (!payload.ok || !payload.gifts) {
      hooks.onError(payload.message || 'Không tải được danh sách quà.');
      return;
    }
    render(payload.gifts);
  };

  // Nothing in this manager persists until "Lưu" is pressed — but until the
  // delete button existed, the Save button read "✓ Đã lưu" in EVERY state,
  // including "you have unsaved changes". That is survivable for a field edit
  // (the new value is still on screen, so the founder has a reason to press
  // Save) and a disaster for a delete: the row vanishes, the button says
  // "Saved", and Coach Felix closes the tab believing the free gift is gone.
  // It is not — it is still live, and still free to every child. So the
  // button must state, truthfully, which of the two things it is.
  let dirty = false;
  // True for the duration of an in-flight saveGifts() round-trip. See saveAll().
  let saving = false;

  const markDirty = () => {
    dirty = true;
    if (saveResetTimer) clearTimeout(saveResetTimer);
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Lưu thay đổi';
    saveBtn.classList.add('ag-save--dirty');
  };

  const setSaveState = (state: 'idle' | 'saving' | 'saved' | 'error', message?: string) => {
    if (saveResetTimer) clearTimeout(saveResetTimer);
    if (state === 'saving') {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Đang lưu…';
      return;
    }
    if (state === 'error') {
      // Still dirty — the changes are in the DOM and nowhere else.
      saveBtn.disabled = false;
      saveBtn.textContent = '⚠ Lỗi lưu, thử lại';
      saveBtn.classList.add('ag-save--dirty');
      if (message) hooks.onError(message);
      return;
    }
    // 'saved' and 'idle': the DOM and KV now agree.
    dirty = false;
    saveBtn.disabled = false;
    saveBtn.textContent = '✓ Đã lưu';
    saveBtn.classList.remove('ag-save--dirty');
  };

  // Last line of defence for the same trap: a founder who deletes a gift and
  // navigates away without saving gets the browser's own "leave site?" prompt
  // instead of silently keeping the gift live.
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  const saveAll = async (): Promise<AdminGift[] | null> => {
    if (saving) return null;

    const gifts = collectAll();
    const rows = Array.from(rowsHost.querySelectorAll<HTMLElement>('[data-ag-row]'));
    rows.forEach((row) => { row.classList.remove('ag-row--invalid'); });

    // Money guard (production incident: "Quà 8", price 0, went live active
    // and every child could claim it for free). Refused before the network
    // call, reported through the same inline error host every other manager
    // error uses (no blocking browser dialog). Blocks BOTH the explicit
    // Save button and the photo-upload flow below, since both persist this
    // exact same collected array.
    const invalidIndex = findInvalidActiveGiftIndex(gifts);
    if (invalidIndex !== -1) {
      const invalidGift = gifts[invalidIndex];
      rows[invalidIndex]?.classList.add('ag-row--invalid');
      const name = invalidGift.name_vi || 'chưa đặt tên';
      hooks.onError(`Quà "${name}" đang bật phải có giá lớn hơn 0 💎.`);
      return null;
    }

    // `gifts` was snapshotted synchronously, above. Once we await, the row
    // table must be FROZEN — otherwise an edit made during the round-trip is
    // silently destroyed by the render() below, which repaints from the
    // server's answer to the OLD snapshot, while setSaveState('saved') clears
    // the dirty flag and the button goes back to claiming "✓ Đã lưu".
    //
    // Buffet reproduced the exact sequence this task exists to prevent:
    // Coach Felix uploads a photo (which saves), and while that request is in
    // flight he deletes the free "Quà 8". The upload's response repaints the
    // table, "Quà 8" REAPPEARS — active, priced 0, free to every child — and
    // the button reads "Saved".
    //
    // `inert` (not just pointer-events) so keyboard and AT users are frozen
    // out too, and the Add button with it. It is a sub-second window.
    saving = true;
    rowsHost.inert = true;
    addBtn.disabled = true;
    setSaveState('saving');
    try {
      const payload = await saveGifts(gifts);
      if (!payload.ok || !payload.gifts) {
        setSaveState('error', payload.message || 'Không lưu được. Thử lại nhé.');
        return null;
      }
      setSaveState('saved');
      render(payload.gifts);
      return payload.gifts;
    } finally {
      saving = false;
      rowsHost.inert = false;
      addBtn.disabled = false;
    }
  };

  addBtn.addEventListener('click', () => {
    if (saving) return; // see the rowsHost click handler
    const draft: AdminGift = {
      id: '',
      name_vi: '',
      emoji: '🎁',
      image_key: null,
      image_url: null,
      price_diamonds: 0,
      limit_total: null,
      redeemed_count: 0,
      cost_vnd: 0,
      active: true,
    };
    rowsHost.insertAdjacentHTML('beforeend', renderGiftRow(draft, rowCounter));
    rowCounter += 1;
    setCount(rowsHost.querySelectorAll('[data-ag-row]').length);
    const newRow = rowsHost.querySelector<HTMLElement>('[data-ag-row]:last-child');
    newRow?.querySelector<HTMLInputElement>('[data-field="name_vi"]')?.focus();
    markDirty();
  });

  saveBtn.addEventListener('click', () => { void saveAll(); });

  // Event delegation — one listener per interaction type covers every row,
  // including ones appended later by "+ Thêm quà", with no per-row rebind.
  rowsHost.addEventListener('click', (event) => {
    // `inert` on rowsHost already stops a real user reaching these controls
    // mid-save, but a money-safety invariant must not rest on browser hit
    // testing alone: any mutation that slipped through would be wiped by the
    // render() that repaints from the pre-mutation snapshot, while the button
    // went back to claiming "✓ Đã lưu". Refuse outright. (Buffet, HIGH.)
    if (saving) return;
    const target = event.target as HTMLElement;
    const toggleBtn = target.closest<HTMLElement>('[data-ag-action="toggle-active"]');
    if (toggleBtn) {
      const on = toggleBtn.getAttribute('aria-checked') === 'true';
      toggleBtn.setAttribute('aria-checked', on ? 'false' : 'true');
      toggleBtn.classList.toggle('ag-switch--on', !on);
      markDirty();
      return;
    }
    const photoToggle = target.closest<HTMLElement>('[data-ag-action="toggle-photo"]');
    if (photoToggle) {
      const details = photoToggle.closest('[data-ag-row]')?.querySelector<HTMLDetailsElement>('[data-ag-photo-details]');
      if (details) {
        details.open = !details.open;
        photoToggle.setAttribute('aria-expanded', String(details.open));
      }
      return;
    }
    const closeBtn = target.closest<HTMLElement>('[data-ag-action="close-photo"]');
    if (closeBtn) {
      const rowEl = closeBtn.closest<HTMLElement>('[data-ag-row]');
      const details = rowEl?.querySelector<HTMLDetailsElement>('[data-ag-photo-details]');
      if (details) details.open = false;
      rowEl?.querySelector('[data-ag-action="toggle-photo"]')?.setAttribute('aria-expanded', 'false');
      return;
    }
    const removePhotoBtn = target.closest<HTMLElement>('[data-ag-action="remove-photo"]');
    if (removePhotoBtn) {
      const rowEl = removePhotoBtn.closest<HTMLElement>('[data-ag-row]');
      if (!rowEl) return;
      // Clears BOTH paths (dataset + the url input + the thumb + the
      // preview) so the gift genuinely falls back to its emoji — this is
      // the hole Coach Felix got stuck in: a wrong photo could only ever be
      // replaced, never removed.
      rowEl.dataset.imageKey = '';
      const urlInput = rowEl.querySelector<HTMLInputElement>('[data-field="image_url"]');
      if (urlInput) urlInput.value = '';
      const uploadStatus = rowEl.querySelector<HTMLElement>('[data-ag-upload-status]');
      if (uploadStatus) uploadStatus.textContent = 'chưa chọn';
      updateRowPhotoUi(rowEl, readGiftFromRow(rowEl));
      const warningEl = rowEl.querySelector<HTMLElement>('[data-ag-url-warning]');
      if (warningEl) warningEl.hidden = true;
      urlInput?.classList.remove('ag-input--error');
      markDirty();
      return;
    }
    const deleteBtn = target.closest<HTMLElement>('[data-ag-action="delete-gift"]');
    if (deleteBtn) {
      const rowEl = deleteBtn.closest<HTMLElement>('[data-ag-row]');
      if (!rowEl) return;
      const gift = readGiftFromRow(rowEl);
      const name = gift.name_vi || 'quà mới';
      const redeemedCount = Number(rowEl.dataset.redeemedCount || 0);
      // Harder warning when a child already redeemed this gift — deleting it
      // does not undo an already-delivered/queued redemption, it only pulls
      // the gift out of the catalogue going forward.
      const message = redeemedCount > 0
        ? `Xoá "${name}"? Con nào đang chờ món này vẫn nhận được quà — nhưng món này sẽ biến mất khỏi cửa hàng.`
        : `Xoá "${name}"?`;
      if (!confirm(message)) return;
      rowEl.remove();
      // Deleting does NOT auto-save — it matches every other edit in this
      // manager (name/price/limit/photo are all live-in-DOM only until Save
      // is pressed), and the row is simply gone from collectAll()'s next
      // read. markDirty() is what makes that honest: without it the button
      // would still read "✓ Đã lưu" over a gift that is very much still live.
      setCount(rowsHost.querySelectorAll('[data-ag-row]').length);
      markDirty();
    }
  });

  // Live preview: pasted URL updates the thumbnail as the founder types, no
  // save required to see it — matches the kid-facing shop's own precedence
  // (upload wins over URL) so what he previews here is what a child sees.
  rowsHost.addEventListener('input', (event) => {
    if (saving) return; // see the click handler — no mutation may race a save
    const target = event.target as HTMLElement;
    // Any field edit is an unsaved change — not just the URL one.
    if (target.matches('[data-field]')) {
      markDirty();
      // Clear the red "fix this row" highlight the moment he starts fixing it,
      // rather than leaving it lit until the next Save attempt.
      target.closest<HTMLElement>('[data-ag-row]')?.classList.remove('ag-row--invalid');
    }
    if (!target.matches('[data-ag-url-input]')) return;
    const rowEl = target.closest<HTMLElement>('[data-ag-row]');
    if (!rowEl) return;
    const current = readGiftFromRow(rowEl);
    updateRowPhotoUi(rowEl, current);
  });

  // Validate the pasted image URL as soon as the founder leaves the field —
  // "blur" doesn't bubble, so this delegated listener uses "focusout" (its
  // bubbling equivalent) instead. Teaches, doesn't block: an unrecognized
  // host might still be a genuine image link, so this only surfaces an
  // inline warning (never alert()) rather than refusing the save outright,
  // unlike the price/active guard in saveAll().
  rowsHost.addEventListener('focusout', (event) => {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-ag-url-input]')) return;
    const input = target as HTMLInputElement;
    const rowEl = input.closest<HTMLElement>('[data-ag-row]');
    const warningEl = rowEl?.querySelector<HTMLElement>('[data-ag-url-warning]');
    const looksLikeImage = isLikelyImageUrl(input.value);
    input.classList.toggle('ag-input--error', !looksLikeImage);
    if (warningEl) warningEl.hidden = looksLikeImage;
  });

  rowsHost.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-ag-file]')) return;
    const input = target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const rowEl = input.closest<HTMLElement>('[data-ag-row]');
    if (!rowEl) return;
    const index = Number(rowEl.dataset.index ?? -1);
    // saveAll() below fully re-renders #gifts-mgr-rows, which detaches this
    // row (and its status <span>) from the document — so every DOM lookup
    // after an await re-queries by this stable index instead of holding
    // onto references from before the re-render, otherwise the loading/
    // result text would silently update an invisible, detached element.
    const currentStatusEl = () => rowsHost.querySelector<HTMLElement>(`[data-ag-row][data-index="${index}"] [data-ag-upload-status]`);
    const setStatus = (text: string) => { const el = currentStatusEl(); if (el) el.textContent = text; };
    void (async () => {
      setStatus('Đang lưu quà & tải ảnh…');
      // Upload needs a real, saved gift id (functions/api/admin/gifts/upload.js
      // 404s an unknown gift_id) — a brand-new row from "+ Thêm quà" has none
      // yet, so save the whole table first. This is also correct for an
      // existing row: whatever name/price/etc. the founder just typed is
      // persisted together with the photo, not left stranded unsaved.
      const saved = await saveAll();
      if (!saved) {
        setStatus('chưa chọn');
        return;
      }
      const giftId = saved[index]?.id || '';
      if (!giftId) {
        setStatus('chưa chọn');
        hooks.onError('Chưa lưu được quà này — thử đặt tên trước rồi tải ảnh lại nhé.');
        return;
      }
      const upload = await uploadGiftPhoto(giftId, file);
      if (!upload.ok || !upload.image_key) {
        setStatus('chưa chọn');
        hooks.onError(upload.message || 'Không tải được ảnh. Thử lại nhé.');
        return;
      }
      setStatus('đã tải ảnh');
      // Refresh from the server so the freshly-attached image_key is the
      // source of truth (also picks up the index shift, if any, since
      // saveAll() already re-rendered the whole table in server order).
      await load();
    })();
  });

  void load();
}

// ---------------------------------------------------------------------------
// §7 controller — the redemption queue (Felix's shopping list)
// ---------------------------------------------------------------------------

export type RedemptionQueueHooks = {
  onError: (message: string) => void;
};

export function initRedemptionQueue(hooks: RedemptionQueueHooks): void {
  const host = document.getElementById('gifts-queue');
  if (!host) return;

  const load = async () => {
    // Fetched independently from the gift manager (§6) — the queue is its
    // own controller and shouldn't depend on the manager having loaded
    // first. This second /api/admin/gifts read is cheap (one KV get) and
    // only used to look up each row's emoji/photo by gift_id, which the
    // redemption row itself doesn't carry.
    const [queuePayload, giftsPayload] = await Promise.all([fetchRedemptionQueue(), fetchGifts()]);
    if (!queuePayload.ok || !queuePayload.groups) {
      hooks.onError(queuePayload.message || 'Không tải được hàng chờ.');
      return;
    }
    const giftsById: GiftLookup = new Map((giftsPayload.gifts || []).map((gift) => [gift.id, gift]));
    host.innerHTML = renderQueue(queuePayload.groups, queuePayload.total_cost_vnd_this_month || 0, giftsById);
  };

  host.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>('[data-ag-q-action]');
    if (!btn || btn.disabled) return;
    const rowEl = btn.closest<HTMLElement>('[data-ag-q-row]');
    const redemptionId = rowEl?.dataset.redemptionId;
    const status = btn.dataset.status as RedemptionStatus | undefined;
    if (!redemptionId || !status) return;

    const siblingButtons = rowEl?.querySelectorAll<HTMLButtonElement>('.ag-q-btn') || [];
    siblingButtons.forEach((b) => { b.disabled = true; });
    const originalText = btn.textContent;
    btn.textContent = status === 'rejected' ? 'Đang hoàn 💎…' : 'Đang xử lý…';

    void (async () => {
      const result = await patchRedemption(redemptionId, status);
      if (!result.ok) {
        siblingButtons.forEach((b) => { b.disabled = false; });
        if (btn.isConnected) btn.textContent = originalText;
        hooks.onError(result.message || 'Không cập nhật được. Thử lại nhé.');
        return;
      }
      await load();
    })();
  });

  void load();
}
