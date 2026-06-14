import { isV3Enabled } from '../config/flags';
import {
  MONSTER_MANIFEST,
  MONSTER_SLOTS,
  type MonsterConfig,
  nameColorClassFromEquipped,
  renderMonster,
  type EquippedDisplayItem,
} from './monster-avatar';
import type { MonsterSlot } from './monster-manifest';
import {
  getPartRarity,
  isPartUnlocked,
  type PartRarity,
} from './avatar-rarity';

const SLOT_LABELS_VI: Record<MonsterSlot, string> = {
  body: 'Thân',
  eyes: 'Mắt',
  mouth: 'Miệng',
  arms: 'Tay',
  detail: 'Chi tiết',
};

type Read2LeadState = {
  avatar?: { monster?: MonsterConfig };
  avatar_stage?: 'egg' | 'basic' | 'custom';
  monster_basic_defaults?: MonsterConfig;
  unlocked_parts?: string[];
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
  pending_ceremony?: {
    part_id: string;
    rarity: PartRarity;
    ts: string | null;
  } | null;
};

export type MonsterPartEntry = { id: string; file: string };

function partsForSlot(state: Read2LeadState, slot: MonsterSlot): MonsterPartEntry[] {
  const fromState = state.monster_parts?.[slot];
  const parts = Array.isArray(fromState) && fromState.length
    ? fromState
    : MONSTER_MANIFEST[slot] || [];
  return slot === 'detail' ? [{ id: '', file: '' }, ...parts] : parts;
}

export function getAvailablePartsForSlot(
  slot: MonsterSlot,
  state: Read2LeadState,
): MonsterPartEntry[] {
  const basicIds: Record<MonsterSlot, string> = {
    body: 'png-default-body-whitea',
    eyes: 'png-default-eye-blue',
    mouth: 'png-default-moutha',
    arms: 'png-default-arm-whitea',
    detail: '',
  };
  const defaultId = state.monster_basic_defaults?.[slot] ?? basicIds[slot];
  const allParts = partsForSlot(state, slot);
  const basicPart = allParts.find((part) => part.id === defaultId)
    || { id: defaultId, file: '' };
  if (state.avatar_stage !== 'custom') return [basicPart];

  const unlocked = new Set(state.unlocked_parts || []);
  return [
    basicPart,
    ...allParts.filter((part) =>
      part.id !== defaultId
      && getPartRarity(part.id) !== 'common'
      && unlocked.has(part.id)),
  ];
}

function hasLockedPartsForSlot(slot: MonsterSlot, state: Read2LeadState): boolean {
  return partsForSlot(state, slot).some(
    (part) => getPartRarity(part.id) !== 'common' && !isPartUnlocked(state, part.id),
  );
}

function partNameVi(slot: MonsterSlot, partId: string): string {
  if (!partId) return 'Không dùng';
  const colorLabels: Record<string, string> = {
    blue: 'xanh',
    dark: 'đen',
    green: 'xanh lá',
    red: 'đỏ',
    white: 'trắng',
    yellow: 'vàng',
  };
  const color = Object.keys(colorLabels).find((key) => partId.includes(`-${key}`));
  const detailLabels: Record<string, string> = {
    antenna: 'Râu',
    horn: 'Sừng',
    ear: 'Tai',
    eyebrow: 'Lông mày',
    nose: 'Mũi',
    snot: 'Mũi',
  };
  if (slot === 'detail') {
    const kind = Object.keys(detailLabels).find((key) => partId.includes(key));
    const size = partId.includes('-large') ? ' lớn' : partId.includes('-small') ? ' nhỏ' : '';
    return `${detailLabels[kind || ''] || 'Chi tiết'}${color ? ` ${colorLabels[color]}` : ''}${size}`;
  }
  return `${SLOT_LABELS_VI[slot]}${color ? ` ${colorLabels[color]}` : ''}`;
}

function defaultDraft(state: Read2LeadState): MonsterConfig {
  const monster = state.avatar?.monster;
  const draft = {
    body: getAvailablePartsForSlot('body', state)[0]?.id || 'default',
    eyes: getAvailablePartsForSlot('eyes', state)[0]?.id || 'default',
    mouth: getAvailablePartsForSlot('mouth', state)[0]?.id || 'default',
    arms: getAvailablePartsForSlot('arms', state)[0]?.id || 'default',
    detail: getAvailablePartsForSlot('detail', state)[0]?.id || '',
    color: state.monster_basic_defaults?.color || 'mint',
  };
  if (!monster) return draft;
  for (const slot of MONSTER_SLOTS) {
    const available = getAvailablePartsForSlot(slot, state);
    if (available.some((part) => part.id === monster[slot])) {
      draft[slot] = monster[slot];
    }
  }
  return draft;
}

function cyclePart(
  slot: MonsterSlot,
  currentId: string,
  direction: -1 | 1,
  state: Read2LeadState,
) {
  const parts = getAvailablePartsForSlot(slot, state);
  if (!parts.length) return currentId;
  const foundIndex = parts.findIndex((part) => part.id === currentId);
  const index = foundIndex >= 0 ? foundIndex : direction > 0 ? -1 : 0;
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
  const equippedPartIds = new Set(
    Object.values(state.avatar?.monster || {}).filter((value): value is string => Boolean(value)),
  );
  let ceremonyTimer: ReturnType<typeof setTimeout> | null = null;
  const preview = root.querySelector('[data-monster-preview]') as HTMLElement | null;
  const status = root.querySelector('[data-monster-status]') as HTMLElement | null;
  const saveBtn = root.querySelector('[data-monster-save]') as HTMLButtonElement | null;

  const renderPreview = () => {
    if (!preview) return;
    const renderDraft = draft.detail
      ? draft
      : {
          ...draft,
          detail: partsForSlot(shopState, 'detail').find((part) => part.id)?.id || 'default',
        };
    renderMonster(preview, renderDraft, {
      size: 'large',
      withCosmetics: true,
      equipped: shopState.equipped,
      equippedDisplay: shopState.equipped_display,
    });
    if (!draft.detail) {
      preview.querySelectorAll('[data-slot="detail"]').forEach((layer) => layer.remove());
    }
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
    const available = getAvailablePartsForSlot(slot, shopState);
    const disabled = available.length <= 1;
    if (label) label.textContent = SLOT_LABELS_VI[slot];
    if (value) value.textContent = partNameVi(slot, draft[slot]);
    row.querySelectorAll<HTMLButtonElement>('[data-monster-prev], [data-monster-next]').forEach((button) => {
      button.disabled = disabled;
      button.setAttribute('aria-disabled', String(disabled));
    });
    row.querySelector('[data-monster-lock-card]')?.classList.toggle(
      'hidden',
      !hasLockedPartsForSlot(slot, shopState),
    );
  };

  const renderAll = () => {
    for (const slot of MONSTER_SLOTS) renderSlotRow(slot);
    renderPreview();
    renderCosmetics();
    root.querySelector('[data-monster-basic-hint]')?.classList.toggle(
      'hidden',
      shopState.avatar_stage !== 'basic',
    );
  };

  const showEquipCeremony = (slot: MonsterSlot, partId: string, rarity: PartRarity) => {
    const dialog = document.querySelector('.r2l-equip-ceremony') as HTMLDialogElement | null;
    if (!dialog) return;
    dialog.dataset.rarity = rarity;
    const name = dialog.querySelector('[data-ceremony-part-name]');
    if (name) name.textContent = partNameVi(slot, partId);
    if (dialog.open) dialog.close();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    preview?.classList.remove('r2l-equip-preview-flash');
    void preview?.offsetWidth;
    preview?.classList.add('r2l-equip-preview-flash');
    try {
      const juiceWindow = window as Window & {
        __r2lJuice?: { playKenney?: (name: string) => unknown };
      };
      Promise.resolve(juiceWindow.__r2lJuice?.playKenney?.('quest-complete')).catch(() => {});
    } catch {
      // Audio is optional; the visual ceremony still completes.
    }
    if (ceremonyTimer) window.clearTimeout(ceremonyTimer);
    ceremonyTimer = window.setTimeout(() => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      preview?.classList.remove('r2l-equip-preview-flash');
      ceremonyTimer = null;
    }, 3000);
  };

  const choosePart = (slot: MonsterSlot, direction: -1 | 1) => {
    const currentId = draft[slot];
    const nextId = cyclePart(slot, currentId, direction, shopState);
    if (nextId === currentId) return;
    draft[slot] = nextId;
    shopState = { ...shopState, avatar_stage: 'custom' };
    const rarity = getPartRarity(nextId);
    if (nextId && rarity !== 'common' && !equippedPartIds.has(nextId)) {
      equippedPartIds.add(nextId);
      showEquipCeremony(slot, nextId, rarity);
    }
    renderAll();
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
      choosePart(slot, -1);
    });
  });

  root.querySelectorAll('[data-monster-next]').forEach((button) => {
    button.addEventListener('click', () => {
      const slot = button.getAttribute('data-monster-next') as MonsterSlot;
      choosePart(slot, 1);
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

  const pending = shopState.pending_ceremony;
  if (pending) {
    const slot = MONSTER_SLOTS.find((candidate) =>
      partsForSlot(shopState, candidate).some((part) => part.id === pending.part_id));
    if (slot) {
      showEquipCeremony(slot, pending.part_id, pending.rarity);
      shopState = { ...shopState, pending_ceremony: null };
      void fetch('/api/read2lead-ceremony-ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code: accessCode,
          part_id: pending.part_id,
          ts: pending.ts,
        }),
      }).catch(() => {});
    }
  }
}

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function monsterBuilderHtml(studentName: string, shopHref: string): string {
  const slotRows = MONSTER_SLOTS.map((slot) => `
    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-cream/10 bg-navy-950/60 px-3 py-2" data-monster-slot="${slot}">
      <button type="button" data-monster-prev="${slot}" class="min-h-[44px] min-w-[44px] rounded-lg border border-cream/20 text-lg font-bold text-cream" aria-label="Trước">‹</button>
      <div class="min-w-0 flex-1 text-center">
        <p class="text-xs font-bold uppercase tracking-wide text-cream-muted" data-monster-slot-label></p>
        <p class="truncate text-sm font-semibold text-cream" data-monster-slot-value></p>
      </div>
      <button type="button" data-monster-next="${slot}" class="min-h-[44px] min-w-[44px] rounded-lg border border-cream/20 text-lg font-bold text-cream" aria-label="Sau">›</button>
      <a
        href="${shopHref}"
        data-monster-lock-card
        class="w-full rounded-lg border border-gold/25 bg-gold/10 px-3 py-2 text-center text-xs font-bold text-gold"
      >🔒 Mua thêm ở Cửa hàng</a>
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
      <p data-monster-basic-hint class="mt-3 rounded-xl bg-gold/10 px-3 py-2 text-sm font-bold text-gold">Chạm mũi tên để tạo quái riêng của con.</p>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">${slotRows}</div>
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
