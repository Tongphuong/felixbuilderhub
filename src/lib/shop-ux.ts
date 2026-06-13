import { play as playAudio } from './r2l-audio';

export type ShopRarity = 'common' | 'rare' | 'epic';

export type ShopRow = {
  id: string;
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

export function partThumbnailUrl(partId: string): string | undefined {
  const match = String(partId || '').match(/^png-default-(.+)$/);
  if (!match) return undefined;
  const segments = match[1].split('-');
  if (segments.length < 2) return undefined;
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
  const thumb = partThumbnailUrl(item.id);
  const art = thumb
    ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(item.name)}" loading="lazy" width="72" height="72" />`
    : '<div class="shop-item-placeholder" aria-hidden="true">🎨</div>';
  const action = item.owned
    ? '<span class="shop-item-owned"><span aria-hidden="true">✓</span> Có rồi</span>'
    : `<button class="shop-item-buy" type="button" data-part-id="${escapeHtml(item.id)}" data-price="${item.price}" ${item.can_afford ? '' : 'disabled'}><span class="shop-item-coin" aria-hidden="true">🪙</span><span class="shop-item-price">${item.price}</span></button>`;
  return `
    <article class="shop-item" data-rarity="${escapeHtml(item.rarity)}" data-owned="${item.owned}" data-can-afford="${item.can_afford}">
      <div class="shop-item-art">${art}${tierBadgeHtml(item.rarity)}</div>
      <h3 class="shop-item-name">${escapeHtml(item.name)}</h3>
      <div class="shop-item-action">${action}</div>
    </article>
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

  const renderShop = () => {
    const grid = qs('#shop-grid');
    if (!grid) return;
    const epic = shopItems.filter((item) => item.rarity === 'epic');
    const rare = shopItems.filter((item) => item.rarity === 'rare');
    grid.innerHTML = `
      <section class="shop-grid" aria-label="Cửa hàng phụ kiện">
        ${renderSection('epic', 'Sử Thi', epic)}
        ${renderSection('rare', 'Hiếm', rare)}
        ${shopItems.length === 0 ? '<p class="shop-grid-empty">Đang tải cửa hàng…</p>' : ''}
      </section>
    `;
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

    shopItems = payload.items || [];
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
