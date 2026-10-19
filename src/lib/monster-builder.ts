import {
  COLOR_HEX,
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
    // the five cosmetic tint colours (hats / pets) — without these every crown read just "Mũ vương miện"
    mint: 'bạc hà',
    coral: 'san hô',
    sky: 'xanh da trời',
    lemon: 'vàng chanh',
    grape: 'tím nho',
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
  // Category control: the legacy <select>, or (Đảo phiêu lưu design D3) a grid of buttons with the same ten slots.
  const choice = root.querySelector<HTMLSelectElement>('[data-monster-category]');
  const slotButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-monster-slot]'));
  const tiles = root.querySelector<HTMLElement>('[data-monster-tiles]');
  const value = root.querySelector<HTMLElement>('[data-monster-choice]')!;
  const count = root.querySelector<HTMLElement>('[data-monster-count]')!;
  const unsaved = () => { status.textContent = 'Chưa lưu · Bấm Lưu khi con ưng ý.'; };
  /* Option tiles: "Không dùng" first (optional slots), then a window of parts that always contains the chosen one,
     then "+N nữa" for the rest. A tile selects exactly what the ←/→ arrows would reach — same draft, same save. */
  const renderTiles = () => {
    if (!tiles) return;
    const parts = getAvailablePartsForSlot(selectedSlot, state);
    const optional = parts.length > 0 && parts[0].id === '';
    const real = optional ? parts.slice(1) : parts;
    const room = optional ? 4 : 5;
    const at = real.findIndex(p => p.id === draft[selectedSlot]);
    const start = Math.min(Math.max(0, at < 0 ? 0 : at - 1), Math.max(0, real.length - room));
    const shown = real.slice(start, start + room);
    const make = (part: MonsterPartEntry) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cp-tile' + (part.id ? '' : ' cp-tile--none'); b.dataset.monsterTile = part.id;
      b.setAttribute('aria-pressed', String((draft[selectedSlot] || '') === part.id)); b.disabled = busy;
      const thumb = document.createElement('span'); thumb.className = 'cp-thumb'; thumb.setAttribute('aria-hidden', 'true');
      if (!part.id) thumb.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="#17324D" stroke-width="2.4" fill="none"/><path d="M6 18L18 6" stroke="#17324D" stroke-width="2.4"/></svg>';
      else {
        const entry = ((MONSTER_MANIFEST as Record<string, Array<{ id: string; file: string; color?: string }>>)[selectedSlot] || []).find(p => p.id === part.id);
        const file = part.file || entry?.file || '';
        const url = file.startsWith('/') ? file : `/assets/monsters/raw/${file.split('/').map(encodeURIComponent).join('/')}`;
        if (selectedSlot === 'hat' || selectedSlot === 'pet') {
          const tint = document.createElement('i'); tint.style.setProperty('--cosmetic-mask', `url(${url})`);
          tint.style.setProperty('--cosmetic-color', (COLOR_HEX as Record<string, string>)[entry?.color || 'mint'] || '#6ee7b7'); thumb.append(tint);
        } else { const img = document.createElement('img'); img.src = url; img.alt = ''; img.loading = 'lazy'; thumb.append(img); }
      }
      const name = document.createElement('span'); name.className = 'cp-tile-name'; name.textContent = partNameVi(selectedSlot, part.id);
      b.append(thumb, name);
      b.addEventListener('click', () => { if (busy) return; draft[selectedSlot] = part.id; unsaved(); render(); });
      return b;
    };
    const nodes: HTMLElement[] = [];
    if (optional) nodes.push(make(parts[0]));
    shown.forEach(p => nodes.push(make(p)));
    const rest = real.length - shown.length;
    if (rest > 0) { const more = document.createElement('div'); more.className = 'cp-more'; more.textContent = `+${rest} ${SLOT_LABELS_VI[selectedSlot].toLowerCase()} nữa`; nodes.push(more); }
    tiles.replaceChildren(...nodes);
  };
  const render = () => {
    // Empty optional detail must not trigger the renderer's whole-monster fallback.
    const config = draft.detail ? draft : { ...draft, detail: partsForSlot(state, 'detail').find(p => p.id)?.id || '' };
    renderMonster(preview, config, { size: 'large', animate: false, withCosmetics: true });
    if (!draft.detail) preview.querySelectorAll('[data-slot="detail"]').forEach(layer => layer.remove());
    const parts = getAvailablePartsForSlot(selectedSlot, state);
    value.textContent = partNameVi(selectedSlot, draft[selectedSlot] || '');
    count.textContent = `${Math.max(0, parts.findIndex(p => p.id === draft[selectedSlot])) + 1} / ${parts.length}`;
    root.querySelectorAll<HTMLButtonElement>('[data-monster-prev], [data-monster-next]').forEach(b => b.disabled = busy || parts.length < 2);
    for (const b of slotButtons) {
      const on = b.dataset.monsterSlot === selectedSlot;
      b.setAttribute('aria-pressed', String(on)); b.classList.toggle('cp-slot--on', on); b.disabled = busy;
    }
    renderTiles();
  };
  choice?.addEventListener('change', () => { selectedSlot = choice.value as MonsterSlot; render(); });
  for (const b of slotButtons) b.addEventListener('click', () => { if (busy) return; selectedSlot = b.dataset.monsterSlot as MonsterSlot; render(); });
  for (const [selector, direction] of [['[data-monster-prev]', -1], ['[data-monster-next]', 1]] as const) {
    root.querySelector(selector)?.addEventListener('click', () => {
      if (busy) return;
      draft[selectedSlot] = cyclePart(selectedSlot, draft[selectedSlot] || '', direction, state);
      unsaved();
      render();
    });
  }
  save.addEventListener('click', async () => {
    if (busy) return;
    busy = true; save.disabled = true; if (choice) choice.disabled = true; render(); status.textContent = 'Đang lưu…';
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
      window.clearTimeout(timeout); busy = false; save.disabled = false; if (choice) choice.disabled = false; render();
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

/** Đảo phiêu lưu companion screen (design 05): stage + category buttons + option tiles + arrows + save. Same mount, same save. */
export function monsterBuilderIslandHtml(studentName: string): string {
  const arrow = (d: string) => `<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24"><path d="${d}" stroke="#17324D" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
  return `<section class="cp-editor" aria-label="Chọn bạn đồng hành" data-r2l-monster-builder-root>
    <div class="cp-stage" data-design="companion.stage" role="img" aria-label="Bạn đồng hành của ${escapeHtml(studentName)}">
      <svg class="cp-hills" aria-hidden="true" viewBox="0 0 352 270" preserveAspectRatio="none"><path d="M0 210 C 80 190 270 190 352 210 L352 270 L0 270Z" fill="#7BD389"/><ellipse cx="176" cy="226" rx="90" ry="14" fill="#4FB868"/></svg>
      <img class="cp-spark cp-spark--a r2l-m-tw" src="/assets/effects/effect-spark-gold-01.webp" alt="" width="60" height="60">
      <img class="cp-spark cp-spark--b r2l-m-tw" src="/assets/effects/effect-star-gold-05.webp" alt="" width="60" height="60">
      <div class="cp-monster r2l-m-bob"><div data-monster-preview aria-hidden="true"></div></div>
      <div class="cp-bubble r2l-bubble r2l-m-pop">Đẹp quá!</div>
    </div>
    <div class="cp-right">
      <div class="cp-picker r2l-card-f" data-design="companion.picker">
        <span class="r2l-d r2l-t-3 cp-q" id="cp-q">Con muốn đổi phần nào?</span>
        <div class="cp-slots" role="group" aria-labelledby="cp-q">${MONSTER_SLOTS.map(slot => `<button type="button" class="cp-slot" data-monster-slot="${slot}" aria-pressed="false">${SLOT_LABELS_VI[slot]}</button>`).join('')}</div>
        <div class="cp-tiles" data-monster-tiles></div>
        <div class="cp-arrows">
          <button type="button" class="r2l-ibtn" data-monster-prev aria-label="Lựa chọn trước">${arrow('M15 5l-7 7 7 7')}</button>
          <div class="cp-now" aria-live="polite"><strong class="r2l-d r2l-t-3" data-monster-choice></strong><span class="cp-count"><span data-monster-count></span><span class="cp-free"> · Mọi lựa chọn đều miễn phí.</span></span></div>
          <button type="button" class="r2l-ibtn" data-monster-next aria-label="Lựa chọn tiếp">${arrow('M9 5l7 7-7 7')}</button>
        </div>
      </div>
      <button type="button" class="r2l-btn r2l-btn-sun r2l-btn-w r2l-m-ring cp-save" data-monster-save data-design="companion.primary">Lưu bạn đồng hành</button>
    </div>
    <p class="cp-status" data-monster-status role="status">Chọn phần con thích rồi bấm Lưu nhé.</p>
  </section>`;
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
