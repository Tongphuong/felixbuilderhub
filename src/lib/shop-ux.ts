import { play as playAudio } from './r2l-audio';

const W7_BUILD_ENABLED = import.meta.env.PUBLIC_R2L_W7 === '1';

export type ShopRarity = 'common' | 'rare' | 'epic';

export type ShopRow = {
  id: string;
  slot: string;
  rarity: ShopRarity;
  price: number;
  name: string;
  owned: boolean;
  can_afford: boolean;
};

export type ShopPageHooks = {
  w1: boolean;
  confirmBuy: () => Promise<boolean>;
  onError: (message: string) => void;
  onToast?: (message: string) => void;
};

function w7DecorationsEnabled(): boolean {
  if (W7_BUILD_ENABLED) return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('PUBLIC_R2L_W7') === '1';
  } catch {
    return false;
  }
}

function visibleShopItems(items: ShopRow[]): ShopRow[] {
  if (w7DecorationsEnabled()) return items;
  return items.filter((item) => item.slot !== 'effects' && item.slot !== 'frame');
}

export function partThumbnailUrl(partId: string, itemSlot = ''): string | undefined {
  if (itemSlot === 'effects' || partId.startsWith('effect-')) {
    return `/assets/effects/${partId}.webp`;
  }
  if (itemSlot === 'frame' || partId.startsWith('frame-')) {
    const extension = partId === 'frame-rainbow' ? 'svg' : 'png';
    return `/assets/frames/${partId}.${extension}`;
  }
  const match = String(partId || '').match(/^png-default-(.+)$/);
  if (!match) return undefined;
  const segments = match[1].split('-');
  if (segments.length < 2) return undefined;
  const slot = segments[0];
  // body/arm: <slot>-<color><shapeLetter> e.g. body-darkf, arm-bluea
  // Real file uppercases the shape letter: body_darkF.png, arm_blueA.png
  if ((slot === 'body' || slot === 'arm') && segments.length === 2) {
    const cs = segments[1];
    if (/^[a-z]+[a-f]$/.test(cs)) {
      const upper = cs.slice(0, -1) + cs.slice(-1).toUpperCase();
      return `/assets/monsters/raw/PNG/Default/${slot}_${upper}.png`;
    }
  }
  // mouth/eye: glued <slot><letter> e.g. mouthh, eyec — file mouthH.png
  if (segments.length === 1) {
    const m = slot.match(/^(mouth|eye|nose|snot|eyebrow)([a-z])$/);
    if (m) {
      return `/assets/monsters/raw/PNG/Default/${m[1]}${m[2].toUpperCase()}.png`;
    }
  }
  const fileName = `${segments.join('_')}.png`;
  return `/assets/monsters/raw/PNG/Default/${fileName}`;
}

export async function buyPart(
  partId: string,
  code: string,
): Promise<{ ok: boolean; reward?: { part_id: string; price: number }; coins?: number; error?: string; message?: string }> {
  try {
    const res = await fetch('/api/read2lead-shop-buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, part_id: partId }),
    });
    const data = await res.json();
    if (data.ok) await playAudio('coin-clink');
    return data;
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function playDisabledBuzz(): Promise<void> {
  await playAudio('near-miss');
}

export async function showUnlock(partName: string, rarity: string): Promise<void> {
  await playAudio('quest-complete');
  const dialog = document.querySelector('.unlock-celebration') as HTMLDialogElement | null;
  if (!dialog) return;
  dialog.dataset.rarity = rarity;
  const title = dialog.querySelector('.unlock-title') as HTMLElement | null;
  const nameEl = dialog.querySelector('.unlock-part-name') as HTMLElement | null;
  if (title) {
    const labels: Record<string, string> = { common: 'Thường', rare: 'Hiếm', epic: 'Sử Thi' };
    title.textContent = `Mới có ${labels[rarity] || 'Thường'}!`;
  }
  if (nameEl) nameEl.textContent = partName;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  window.setTimeout(() => {
    if (dialog.open) dialog.close();
  }, 4000);
}

export function showInsufficient(needed: number, current: number): void {
  const dialog = document.querySelector('.insufficient-modal') as HTMLDialogElement | null;
  if (!dialog) return;
  const deficit = Math.max(0, needed - current);
  const title = dialog.querySelector('.insufficient-title') as HTMLElement | null;
  if (title) title.textContent = `Còn thiếu ${deficit} xu`;
  dialog.dataset.deficit = String(deficit);
  if (typeof dialog.showModal === 'function') dialog.showModal();
}

export function wireShopModals(profileHref = '/hoc-sinh'): void {
  const insufficient = document.querySelector('.insufficient-modal') as HTMLDialogElement | null;
  insufficient?.querySelector('.insufficient-go-learn')?.addEventListener('click', () => {
    insufficient.close();
    window.location.href = profileHref;
  });
  insufficient?.querySelector('.insufficient-close')?.addEventListener('click', () => {
    insufficient.close();
  });

  const unlock = document.querySelector('.unlock-celebration') as HTMLDialogElement | null;
  unlock?.querySelector('.unlock-equip')?.addEventListener('click', () => {
    unlock.close();
    window.location.href = profileHref;
  });
  unlock?.querySelector('.unlock-later')?.addEventListener('click', () => {
    unlock.close();
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tierBadgeHtml(rarity: ShopRarity, large = false): string {
  const labels: Record<ShopRarity, string> = { common: 'Thường', rare: 'Hiếm', epic: 'Sử Thi' };
  const colors: Record<ShopRarity, string> = { common: '#94a3b8', rare: '#3b82f6', epic: '#a855f7' };
  const sparkle = rarity === 'epic' ? '<span class="r-sparkle" aria-hidden="true">✨</span>' : '';
  return `<span class="r-badge r-badge-${large ? 'large' : 'small'}" data-rarity="${rarity}" style="--badge-color:${colors[rarity]}">${sparkle}<span class="r-label">${labels[rarity]}</span></span>`;
}

function renderShopItem(item: ShopRow): string {
  const thumb = partThumbnailUrl(item.id, item.slot);
  const art = thumb
    ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(item.name)}" loading="lazy" width="72" height="72" />`
    : '<div class="shop-item-placeholder" aria-hidden="true">🎨</div>';
  const action = item.owned
    ? '<span class="shop-item-owned"><span aria-hidden="true">✓</span> Có rồi</span>'
    : `<button class="shop-item-buy" type="button" data-part-id="${escapeHtml(item.id)}" data-price="${item.price}" ${item.can_afford ? '' : 'disabled'}><span class="shop-item-coin" aria-hidden="true">🪙</span><span class="shop-item-price">${item.price}</span></button>`;
  return `
    <article class="shop-item" data-slot="${escapeHtml(item.slot)}" data-rarity="${escapeHtml(item.rarity)}" data-owned="${item.owned}" data-can-afford="${item.can_afford}">
      <div class="shop-item-art">${art}${tierBadgeHtml(item.rarity)}</div>
      <h3 class="shop-item-name">${escapeHtml(item.name)}</h3>
      <div class="shop-item-action">${action}</div>
    </article>
  `;
}

const SHOP_FILTERS = [
  { slot: 'all', label: 'Tất cả' },
  { slot: 'body', label: 'Thân' },
  { slot: 'arms', label: 'Tay' },
  { slot: 'eyes', label: 'Mắt' },
  { slot: 'mouth', label: 'Miệng' },
  { slot: 'detail', label: 'Chi tiết' },
  { slot: 'effects', label: 'Hiệu ứng' },
  { slot: 'frame', label: 'Khung' },
] as const;

function renderFilterChips(activeSlot: string): string {
  const filters = w7DecorationsEnabled()
    ? SHOP_FILTERS
    : SHOP_FILTERS.filter(({ slot }) => slot !== 'effects' && slot !== 'frame');
  return `
    <nav class="shop-filters" aria-label="Lọc phụ kiện" style="display:flex;gap:.5rem;overflow-x:auto;padding:.15rem 0 .35rem">
      ${filters.map(({ slot, label }) => {
        const active = slot === activeSlot;
        return `<button type="button" data-shop-filter="${slot}" aria-pressed="${active}" style="min-height:44px;white-space:nowrap;border-radius:999px;border:2px solid ${active ? 'var(--r2l-sun, #ffc83d)' : 'rgb(248 250 252 / .2)'};background:${active ? 'rgb(255 200 61 / .18)' : 'rgb(15 23 42 / .82)'};color:#f8fafc;padding:.45rem .8rem;font:inherit;font-weight:800;cursor:pointer">${label}</button>`;
      }).join('')}
    </nav>
  `;
}

function renderSection(tier: ShopRarity, title: string, items: ShopRow[]): string {
  if (!items.length) return '';
  return `
    <section class="shop-section" data-tier="${tier}">
      <header class="shop-section-header">${tierBadgeHtml(tier, true)}<h2>${escapeHtml(title)} — ${items.length} món</h2></header>
      <div class="shop-section-items">${items.map(renderShopItem).join('')}</div>
    </section>
  `;
}

export function initShopPage(hooks: ShopPageHooks): void {
  let accessCode = '';
  let shopItems: ShopRow[] = [];
  let shopCoins = 0;
  let profileHref = '/hoc-sinh';
  let activeSlot = 'all';

  const qs = (sel: string) => document.querySelector(sel);

  const setShopCoins = (value: number) => {
    shopCoins = Number(value) || 0;
    const legacy = qs('#shop-coins');
    if (legacy) legacy.textContent = String(shopCoins);
    const pill = qs('[data-r2l-coin-value]');
    if (pill) {
      pill.textContent = String(shopCoins);
      const wrap = pill.closest('.r2l-kid-coin-pill');
      if (wrap) {
        wrap.classList.add('is-bump');
        window.setTimeout(() => wrap.classList.remove('is-bump'), 400);
      }
    }
  };

  const bindShopActions = () => {
    const host = qs('#shop-grid');
    if (!host) return;

    host.querySelectorAll<HTMLButtonElement>('.shop-item-buy').forEach((button) => {
      button.addEventListener('click', async () => {
        const partId = button.dataset.partId || '';
        const price = Number(button.dataset.price || 0);
        if (button.disabled) {
          void playDisabledBuzz();
          showInsufficient(price, shopCoins);
          return;
        }
        if (!(await hooks.confirmBuy())) return;
        const original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<span class="shop-item-price">…</span>';
        const payload = await buyPart(partId, accessCode);
        if (!payload.ok) {
          button.disabled = false;
          button.innerHTML = original;
          hooks.onError(payload.message || 'Không thể mua.');
          return;
        }
        setShopCoins(payload.coins || 0);
        const bought = shopItems.find((item) => item.id === partId);
        shopItems = shopItems.map((item) => {
          if (item.id !== partId) {
            return { ...item, can_afford: !item.owned && shopCoins >= item.price };
          }
          return { ...item, owned: true, can_afford: false };
        });
        if (bought) void showUnlock(bought.name, bought.rarity);
        const minny = qs('#shop-minny');
        if (minny) {
          minny.textContent = 'Minny thích phụ kiện mới! 🎉';
          minny.classList.remove('hidden');
        }
        hooks.onToast?.('Mua xong! Phụ kiện vào tủ rồi.');
        qs('#shop-error')?.classList.add('hidden');
        renderShop();
      });
    });
  };

  const bindShopFilters = () => {
    qs('#shop-grid')?.querySelectorAll<HTMLButtonElement>('[data-shop-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        activeSlot = button.dataset.shopFilter || 'all';
        renderShop();
      });
    });
  };

  const renderShop = () => {
    const grid = qs('#shop-grid');
    if (!grid) return;
    const availableItems = visibleShopItems(shopItems);
    const visibleItems = activeSlot === 'all'
      ? availableItems
      : availableItems.filter((item) => item.slot === activeSlot);
    const epic = visibleItems.filter((item) => item.rarity === 'epic');
    const rare = visibleItems.filter((item) => item.rarity === 'rare');
    const common = visibleItems.filter((item) => item.rarity === 'common');
    grid.innerHTML = `
      <section class="shop-grid" aria-label="Cửa hàng phụ kiện">
        ${renderFilterChips(activeSlot)}
        ${renderSection('epic', 'Sử Thi', epic)}
        ${renderSection('rare', 'Hiếm', rare)}
        ${renderSection('common', 'Thường', common)}
        ${visibleItems.length === 0 ? '<p class="shop-grid-empty">Chưa có món trong mục này.</p>' : ''}
      </section>
    `;
    bindShopFilters();
    bindShopActions();
  };

  const loadShop = async () => {
    const codeInput = qs('#shop-code') as HTMLInputElement | null;
    accessCode = (codeInput?.value || '').trim().toUpperCase();
    if (!accessCode) return;
    qs('#shop-error')?.classList.add('hidden');

    const response = await fetch('/api/read2lead-shop-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: accessCode }),
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.message || 'Không thể mở cửa hàng.');

    shopItems = visibleShopItems(payload.items || []);
    setShopCoins(payload.coins || 0);
    qs('#shop-shell')?.classList.remove('hidden');
    profileHref = `/hoc-sinh?code=${encodeURIComponent(accessCode)}&v3=1`;
    const profileLink = qs('#shop-profile-link') as HTMLAnchorElement | null;
    if (profileLink) profileLink.href = profileHref;
    wireShopModals(profileHref);
    renderShop();
  };

  const handleLoadError = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Không thể mở cửa hàng.';
    hooks.onError(message);
  };

  wireShopModals(profileHref);
  qs('#shop-load')?.addEventListener('click', () => {
    loadShop().catch(handleLoadError);
  });

  const params = new URLSearchParams(window.location.search);
  const code = (params.get('code') || '').trim().toUpperCase();
  const codeInput = qs('#shop-code') as HTMLInputElement | null;
  if (code && codeInput) {
    codeInput.value = code;
    loadShop().catch(handleLoadError);
  }
}
