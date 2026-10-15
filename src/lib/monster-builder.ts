import {
  MONSTER_MANIFEST,
  MONSTER_SLOTS,
  type MonsterConfig,
  nameColorClassFromEquipped,
  renderMonster,
  type EquippedDisplayItem,
} from './monster-avatar';
import {
  getPartRarity,
  isPartUnlocked,
  type PartRarity,
} from './avatar-rarity';

type MonsterSlot = (typeof MONSTER_SLOTS)[number];

const SLOT_LABELS_VI: Record<MonsterSlot, string> = {
  body: 'Thân',
  eyes: 'Mắt',
  mouth: 'Miệng',
  arms: 'Tay',
  detail: 'Chi tiết',
  effects: 'Hiệu ứng',
  frame: 'Khung',
  hat: 'Mũ',
  pet: 'Thú cưng',
  wings: 'Cánh',
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
  return ['detail', 'effects', 'frame'].includes(slot)
    || ['hat', 'pet', 'wings'].includes(slot)
    ? [{ id: '', file: '' }, ...parts]
    : parts;
}

export function getAvailablePartsForSlot(slot: MonsterSlot, state: Read2LeadState): MonsterPartEntry[] {
  return partsForSlot(state, slot);
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
    pink: 'hồng',
    purple: 'tím',
    orange: 'cam',
    gold: 'vàng kim',
    grey: 'xám',
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
  if (slot === 'effects') {
    const effectLabels: Record<string, string> = {
      electric: 'Điện',
      fire: 'Lửa',
      heart: 'Trái tim',
      magic: 'Phép màu',
      spark: 'Lấp lánh',
      star: 'Ngôi sao',
    };
    const kind = Object.keys(effectLabels).find((key) => partId.includes(`-${key}-`));
    return `${effectLabels[kind || ''] || 'Hiệu ứng'}${color ? ` ${colorLabels[color]}` : ''}`;
  }
  if (slot === 'frame') {
    if (partId === 'frame-rainbow') return 'Khung cầu vồng';
    return `Khung${color ? ` ${colorLabels[color]}` : ''}`;
  }
  const cosmeticColor = Object.keys(colorLabels).find((key) => partId.endsWith(`-${key}`));
  const cosmeticLabels: Record<string, string> = {
    crown: 'vương miện', beanie: 'mũ len', 'party-hat': 'mũ tiệc', fez: 'mũ fez',
    'hard-hat': 'mũ bảo hộ', bandana: 'khăn trùm', 'wizard-hat': 'mũ phù thủy',
    sombrero: 'mũ sombrero', 'pirate-hat': 'mũ cướp biển', 'police-hat': 'mũ cảnh sát',
    'cowboy-hat': 'mũ cao bồi', 'grad-cap': 'mũ tốt nghiệp', 'castle-crown': 'vương miện lâu đài',
    'barbarian-helm': 'mũ barbarian', 'viking-helm': 'mũ viking', ushanka: 'mũ ushanka',
    'jewel-crown': 'vương miện ngọc', 'astronaut-helm': 'mũ phi hành gia',
    'jester-hat': 'mũ hề', 'crested-helm': 'mũ có mào',
    rabbit: 'thỏ', dog: 'chó', fish: 'cá', frog: 'ếch', chick: 'gà con', turtle: 'rùa',
    fox: 'cáo', owl: 'cú', penguin: 'chim cánh cụt', elephant: 'voi', duck: 'vịt',
    butterfly: 'bướm', bat: 'dơi', snake: 'rắn', horse: 'ngựa',
    'wings-fairy-blue': 'cánh tiên xanh', 'wings-fairy-pink': 'cánh tiên hồng',
    'wings-fairy-green': 'cánh tiên xanh lá', 'wings-angel-white': 'cánh thiên thần trắng',
    'wings-angel-gold': 'cánh thiên thần vàng', 'wings-dragon-red': 'cánh rồng đỏ',
    'wings-bat-dark': 'cánh dơi', 'wings-rainbow': 'cánh cầu vồng',
  };
  if (slot === 'hat' || slot === 'pet') {
    const kind = partId.replace(/^(hat|pet)-/, '').replace(/-[a-z]+$/, '');
    const label = cosmeticLabels[kind] || kind.replace(/-/g, ' ');
    return `${SLOT_LABELS_VI[slot]} ${label}${cosmeticColor ? ` ${colorLabels[cosmeticColor]}` : ''}`;
  }
  if (slot === 'wings') {
    return cosmeticLabels[partId] || `Cánh ${partId.replace(/^wings-/, '').replace(/-/g, ' ')}`;
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
    effects: getAvailablePartsForSlot('effects', state)[0]?.id || '',
    frame: getAvailablePartsForSlot('frame', state)[0]?.id || '',
    hat: getAvailablePartsForSlot('hat', state)[0]?.id || '',
    pet: getAvailablePartsForSlot('pet', state)[0]?.id || '',
    wings: getAvailablePartsForSlot('wings', state)[0]?.id || '',
    color: monster?.color || state.monster_basic_defaults?.color || 'mint',
  };
  if (!monster) return draft;
  for (const slot of MONSTER_SLOTS) {
    const available = getAvailablePartsForSlot(slot, state);
    const selected = monster[slot];
    if (typeof selected === 'string' && available.some((part) => part.id === selected)) {
      draft[slot] = selected;
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
  root: HTMLElement, accessCode: string, state: Read2LeadState,
  onSaved?: (nextState: Read2LeadState) => void,
) {
  let draft = defaultDraft(state);
  let selectedSlot: MonsterSlot = 'body';
  let busy = false;
  const preview = root.querySelector<HTMLElement>('[data-monster-preview]')!;
  const status = root.querySelector<HTMLElement>('[data-monster-status]')!;
  const save = root.querySelector<HTMLButtonElement>('[data-monster-save]')!;
  const choice = root.querySelector<HTMLSelectElement>('[data-monster-category]')!;
  const value = root.querySelector<HTMLElement>('[data-monster-choice]')!;
  const count = root.querySelector<HTMLElement>('[data-monster-count]')!;
  const render = () => {
    // Empty optional detail must not trigger the renderer's whole-monster fallback.
    const config = draft.detail ? draft : { ...draft, detail: partsForSlot(state, 'detail').find(p => p.id)?.id || '' };
    renderMonster(preview, config, { size: 'large', animate: false, withCosmetics: true });
    if (!draft.detail) preview.querySelectorAll('[data-slot="detail"]').forEach(layer => layer.remove());
    const parts = getAvailablePartsForSlot(selectedSlot, state);
    value.textContent = partNameVi(selectedSlot, draft[selectedSlot] || '');
    count.textContent = `${Math.max(0, parts.findIndex(p => p.id === draft[selectedSlot])) + 1} / ${parts.length}`;
    root.querySelectorAll<HTMLButtonElement>('[data-monster-prev], [data-monster-next]').forEach(b => b.disabled = busy || parts.length < 2);
  };
  choice.addEventListener('change', () => { selectedSlot = choice.value as MonsterSlot; render(); });
  for (const [selector, direction] of [['[data-monster-prev]', -1], ['[data-monster-next]', 1]] as const) {
    root.querySelector(selector)?.addEventListener('click', () => {
      if (busy) return;
      draft[selectedSlot] = cyclePart(selectedSlot, draft[selectedSlot] || '', direction, state);
      status.textContent = 'Chưa lưu · Bấm Lưu khi con ưng ý.';
      render();
    });
  }
  save.addEventListener('click', async () => {
    if (busy) return;
    busy = true; save.disabled = true; choice.disabled = true; render(); status.textContent = 'Đang lưu…';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/read2lead-shop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ access_code: accessCode, action: 'avatar', monster: draft }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'Chưa lưu được. Con thử lại nhé.');
      state = payload.read2lead_state; draft = defaultDraft(state);
      onSaved?.(state); status.textContent = 'Đã lưu! Bạn đồng hành sẵn sàng đọc cùng con.';
    } catch (error) {
      status.textContent = error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')
        ? 'Mất kết nối. Lựa chọn vẫn ở đây; con thử lưu lại nhé.'
        : error instanceof Error ? error.message : 'Chưa lưu được. Con thử lại nhé.';
    } finally {
      window.clearTimeout(timeout); busy = false; save.disabled = false; choice.disabled = false; render();
    }
  });
  root.classList.remove('hidden'); render();
}

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function monsterBuilderHtml(studentName: string, _shopHref = ''): string {
  return `<section class="companion-editor" aria-label="Chọn bạn đồng hành" data-r2l-monster-builder-root>
    <div class="companion-preview"><div data-monster-preview aria-hidden="true"></div></div>
    <div class="companion-controls">
      <p class="companion-kicker" data-clarity-mask="true">Bạn đồng hành của ${escapeHtml(studentName)}</p>
      <label for="monster-category">Con muốn đổi phần nào?</label>
      <select id="monster-category" data-monster-category>${MONSTER_SLOTS.map(slot => `<option value="${slot}">${SLOT_LABELS_VI[slot]}</option>`).join('')}</select>
      <div class="companion-picker">
        <button type="button" data-monster-prev aria-label="Lựa chọn trước">←</button>
        <div aria-live="polite"><strong data-monster-choice></strong><small data-monster-count></small></div>
        <button type="button" data-monster-next aria-label="Lựa chọn tiếp">→</button>
      </div>
      <p class="companion-free">Mọi lựa chọn đều miễn phí.</p>
      <button type="button" data-monster-save>Lưu bạn đồng hành</button>
      <p data-monster-status role="status">Chọn phần con thích rồi bấm Lưu nhé.</p>
    </div>
  </section>`;
}
