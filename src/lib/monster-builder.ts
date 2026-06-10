import { isV3Enabled } from '../config/flags';
import {
  COLOR_HEX,
  MONSTER_COLORS,
  MONSTER_MANIFEST,
  MONSTER_SLOTS,
  type MonsterConfig,
  nameColorClassFromEquipped,
  renderMonster,
  type EquippedDisplayItem,
} from './monster-avatar';
import type { MonsterSlot } from './monster-manifest';

const SLOT_LABELS_VI: Record<MonsterSlot, string> = {
  body: 'Thân',
  eyes: 'Mắt',
  mouth: 'Miệng',
  arms: 'Tay',
  detail: 'Chi tiết',
};

type Read2LeadState = {
  avatar?: { monster?: MonsterConfig };
  equipped?: Record<string, string>;
  equipped_display?: EquippedDisplayItem[];
  inventory?: string[];
  shop_catalog?: Array<{
    id: string;
    slot: string;
    name_vi: string;
    emoji: string;
    price_coins: number;
    css_class?: string;
  }>;
  monster_parts?: Record<MonsterSlot, Array<{ id: string; file: string }>>;
};

function partsForSlot(state: Read2LeadState, slot: MonsterSlot) {
  const fromState = state.monster_parts?.[slot];
  if (Array.isArray(fromState) && fromState.length) return fromState;
  return MONSTER_MANIFEST[slot] || [];
}

function defaultDraft(state: Read2LeadState): MonsterConfig {
  const monster = state.avatar?.monster;
  if (monster) return { ...monster };
  return {
    body: partsForSlot(state, 'body')[0]?.id || 'default',
    eyes: partsForSlot(state, 'eyes')[0]?.id || 'default',
    mouth: partsForSlot(state, 'mouth')[0]?.id || 'default',
    arms: partsForSlot(state, 'arms')[0]?.id || 'default',
    detail: partsForSlot(state, 'detail')[0]?.id || 'default',
    color: MONSTER_COLORS[0],
  };
}

function cyclePart(
  slot: MonsterSlot,
  currentId: string,
  direction: -1 | 1,
  state: Read2LeadState,
) {
  const parts = partsForSlot(state, slot);
  if (!parts.length) return currentId;
  const index = Math.max(0, parts.findIndex((part) => part.id === currentId));
  const next = (index + direction + parts.length) % parts.length;
  return parts[next].id;
}

export function mountMonsterBuilder(
  root: HTMLElement,
  accessCode: string,
  state: Read2LeadState,
  onSaved?: (nextState: Read2LeadState) => void,
) {
  if (!isV3Enabled()) {
    root.classList.add('hidden');
    return;
  }

  let draft = defaultDraft(state);
  let shopState = state;
  const preview = root.querySelector('[data-monster-preview]') as HTMLElement | null;
  const status = root.querySelector('[data-monster-status]') as HTMLElement | null;
  const saveBtn = root.querySelector('[data-monster-save]') as HTMLButtonElement | null;

  const renderPreview = () => {
    if (!preview) return;
    renderMonster(preview, draft, {
      size: 'large',
      withCosmetics: true,
      equipped: shopState.equipped,
      equippedDisplay: shopState.equipped_display,
    });
    const nameEl = root.querySelector('[data-monster-name]');
    if (nameEl) {
      const colorClass = nameColorClassFromEquipped(shopState.equipped, shopState.equipped_display);
      nameEl.className = `font-display text-lg font-extrabold text-cream ${colorClass}`.trim();
    }
  };

  const renderSlotRow = (slot: MonsterSlot) => {
    const row = root.querySelector(`[data-monster-slot="${slot}"]`);
    if (!row) return;
    const label = row.querySelector('[data-monster-slot-label]');
    const value = row.querySelector('[data-monster-slot-value]');
    if (label) label.textContent = SLOT_LABELS_VI[slot];
    if (value) value.textContent = draft[slot];
  };

  const renderColorRow = () => {
    const value = root.querySelector('[data-monster-color-value]');
    if (value) value.textContent = draft.color;
    root.querySelectorAll('[data-monster-color]').forEach((button) => {
      const color = button.getAttribute('data-monster-color');
      button.classList.toggle('ring-2', color === draft.color);
      button.classList.toggle('ring-accent', color === draft.color);
    });
  };

  const renderAll = () => {
    for (const slot of MONSTER_SLOTS) renderSlotRow(slot);
    renderColorRow();
    renderPreview();
    renderCosmetics();
  };

  const renderCosmetics = () => {
    const grid = root.querySelector('[data-monster-cosmetics]');
    if (!grid) return;
    const inventory = new Set(shopState.inventory || []);
    const equipped = shopState.equipped || {};
    const catalog = shopState.shop_catalog || [];
    const owned = catalog.filter((item) => inventory.has(item.id));
    grid.innerHTML = owned.length
      ? owned.map((item) => {
          const isEquipped = equipped[item.slot] === item.id;
          return `
            <div class="rounded-xl border border-cream/15 bg-navy-950/80 p-3">
              <p class="text-2xl">${item.emoji}</p>
              <p class="mt-1 text-sm font-bold text-cream">${item.name_vi}</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button type="button" data-cosmetic-equip="${item.id}" class="rounded-lg border border-accent px-2 py-1 text-xs font-bold text-accent">${isEquipped ? 'Đang dùng' : 'Trang bị'}</button>
                ${isEquipped ? `<button type="button" data-cosmetic-unequip="${item.slot}" class="rounded-lg border border-cream/20 px-2 py-1 text-xs font-bold text-cream">Gỡ</button>` : ''}
              </div>
            </div>
          `;
        }).join('')
      : '<p class="text-sm text-cream-muted">Chưa có đồ trang trí — vào cửa hàng mua nhé!</p>';

    grid.querySelectorAll('[data-cosmetic-equip]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await shopRequest('equip', { item_id: button.getAttribute('data-cosmetic-equip') });
        } catch (error) {
          if (status) status.textContent = error instanceof Error ? error.message : 'Không trang bị được.';
        }
      });
    });
    grid.querySelectorAll('[data-cosmetic-unequip]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await shopRequest('unequip', { slot: button.getAttribute('data-cosmetic-unequip') });
        } catch (error) {
          if (status) status.textContent = error instanceof Error ? error.message : 'Không gỡ được.';
        }
      });
    });
  };

  async function shopRequest(action: string, extra: Record<string, string | null> = {}) {
    const response = await fetch('/api/read2lead-shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: accessCode, action, ...extra }),
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.message || 'Không thể thực hiện.');
    shopState = payload.read2lead_state;
    onSaved?.(shopState);
    renderAll();
    return payload;
  }

  root.querySelectorAll('[data-monster-prev]').forEach((button) => {
    button.addEventListener('click', () => {
      const slot = button.getAttribute('data-monster-prev') as MonsterSlot;
      draft[slot] = cyclePart(slot, draft[slot], -1, shopState);
      renderAll();
    });
  });

  root.querySelectorAll('[data-monster-next]').forEach((button) => {
    button.addEventListener('click', () => {
      const slot = button.getAttribute('data-monster-next') as MonsterSlot;
      draft[slot] = cyclePart(slot, draft[slot], 1, shopState);
      renderAll();
    });
  });

  root.querySelectorAll('[data-monster-color]').forEach((button) => {
    button.addEventListener('click', () => {
      const color = button.getAttribute('data-monster-color');
      if (color && (MONSTER_COLORS as readonly string[]).includes(color)) {
        draft.color = color;
        renderAll();
      }
    });
  });

  saveBtn?.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    if (status) status.textContent = 'Đang lưu...';
    try {
      const response = await fetch('/api/read2lead-shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: accessCode, action: 'avatar', monster: draft }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.message || 'Không lưu được quái.');
      shopState = payload.read2lead_state;
      draft = { ...shopState.avatar?.monster || draft };
      onSaved?.(shopState);
      if (status) status.textContent = 'Đã lưu quái của con!';
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Không lưu được.';
    } finally {
      saveBtn.disabled = false;
    }
  });

  root.classList.remove('hidden');
  renderAll();
}

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function monsterBuilderHtml(studentName: string, shopHref: string): string {
  const colorSwatches = MONSTER_COLORS.map((color) => `
    <button
      type="button"
      data-monster-color="${color}"
      class="h-10 w-10 rounded-full border-2 border-cream/20"
      style="background:${COLOR_HEX[color]}"
      aria-label="Màu ${color}"
    ></button>
  `).join('');

  const slotRows = MONSTER_SLOTS.map((slot) => `
    <div class="flex items-center gap-2 rounded-xl border border-cream/10 bg-navy-950/60 px-3 py-2" data-monster-slot="${slot}">
      <button type="button" data-monster-prev="${slot}" class="min-h-[44px] min-w-[44px] rounded-lg border border-cream/20 text-lg font-bold text-cream" aria-label="Trước">‹</button>
      <div class="min-w-0 flex-1 text-center">
        <p class="text-xs font-bold uppercase tracking-wide text-cream-muted" data-monster-slot-label></p>
        <p class="truncate text-sm font-semibold text-cream" data-monster-slot-value></p>
      </div>
      <button type="button" data-monster-next="${slot}" class="min-h-[44px] min-w-[44px] rounded-lg border border-cream/20 text-lg font-bold text-cream" aria-label="Sau">›</button>
    </div>
  `).join('');

  return `
    <section class="profile-lesson-card border-accent/30 bg-accent/5" aria-label="Tạo quái của con" data-r2l-monster-builder-root>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-sm font-extrabold uppercase tracking-wide text-accent">Tạo quái của con</p>
          <p class="mt-1 text-sm text-cream-muted">Chọn từng bộ phận và màu — bấm Lưu khi ưng ý nhé.</p>
        </div>
        <a href="${shopHref}" class="rounded-lg border border-gold/35 px-3 py-2 text-xs font-bold text-gold">🛒 Cửa hàng</a>
      </div>
      <div class="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div data-monster-preview class="shrink-0" aria-hidden="true"></div>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-cream-muted">Hồ sơ</p>
          <p data-monster-name class="font-display text-lg font-extrabold text-cream">${escapeHtml(studentName)}</p>
        </div>
      </div>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">${slotRows}</div>
      <div class="mt-4">
        <p class="text-xs font-bold uppercase tracking-wide text-cream-muted">Màu</p>
        <div class="mt-2 flex flex-wrap gap-2">${colorSwatches}</div>
        <p class="mt-1 text-xs text-cream-dim">Đang chọn: <span data-monster-color-value></span></p>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" data-monster-save class="min-h-[48px] rounded-xl bg-accent px-6 font-extrabold text-navy-950">Lưu</button>
        <p data-monster-status class="text-sm font-semibold text-cream-muted"></p>
      </div>
      <div class="mt-5">
        <p class="text-sm font-bold text-cream">Đồ đã mua</p>
        <div class="mt-2 grid gap-2 sm:grid-cols-2" data-monster-cosmetics></div>
      </div>
    </section>
  `;
}
