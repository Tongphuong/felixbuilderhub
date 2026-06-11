import {
  MONSTER_COLORS,
  MONSTER_MANIFEST,
  MONSTER_SLOTS,
  type MonsterColor,
  type MonsterSlot,
} from './monster-manifest';

export type MonsterConfig = {
  body: string;
  color: MonsterColor | string;
  eyes: string;
  mouth: string;
  arms: string;
  detail: string;
};

export type EquippedDisplayItem = {
  slot: string;
  id: string;
  name_vi?: string;
  emoji?: string;
  css_class?: string;
};

export type MonsterRenderOpts = {
  size?: 'large' | 'small';
  withCosmetics?: boolean;
  equipped?: Record<string, string>;
  equippedDisplay?: EquippedDisplayItem[];
  animate?: boolean;
  /** Small avatars: frame + hat only (no pet). */
  compactCosmetics?: boolean;
};

const COLOR_HEX: Record<string, string> = {
  mint: '#6ee7b7',
  coral: '#fb7185',
  sky: '#38bdf8',
  lemon: '#fde047',
  grape: '#a78bfa',
};

/** Hue/sat shifts for Kenney body PNGs (baked blue/green base). */
const COLOR_BODY_FILTER: Record<string, string> = {
  mint: 'hue-rotate(95deg) saturate(1.35)',
  coral: 'hue-rotate(-35deg) saturate(1.5)',
  sky: 'hue-rotate(5deg) saturate(1.25)',
  lemon: 'hue-rotate(48deg) saturate(1.55)',
  grape: 'hue-rotate(-70deg) saturate(1.4)',
};

const SLOT_LABELS_VI: Record<MonsterSlot, string> = {
  body: 'Thân',
  eyes: 'Mắt',
  mouth: 'Miệng',
  arms: 'Tay',
  detail: 'Chi tiết',
};

const loadedImages = new Set<string>();

function partFile(slot: MonsterSlot, partId: string): string | null {
  const parts = MONSTER_MANIFEST[slot] || [];
  const match = parts.find((part) => part.id === partId);
  return match?.file || null;
}

function hasManifestParts(): boolean {
  return MONSTER_SLOTS.some((slot) => (MONSTER_MANIFEST[slot] || []).length > 0);
}

function loadPartImage(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.draggable = false;
  if (!loadedImages.has(src)) {
    loadedImages.add(src);
  }
  return img;
}

function getEquippedItem(
  slot: string,
  equipped: Record<string, string> | undefined,
  equippedDisplay: EquippedDisplayItem[] | undefined,
) {
  const itemId = equipped?.[slot];
  if (!itemId) return null;
  return equippedDisplay?.find((item) => item.slot === slot && item.id === itemId) || null;
}

function injectMonsterStyles() {
  if (document.getElementById('r2l-monster-styles')) return;
  const style = document.createElement('style');
  style.id = 'r2l-monster-styles';
  style.textContent = `
    @keyframes r2l-monster-float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-4px) rotate(-1deg); }
    }
    .r2l-monster {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      filter: drop-shadow(0 6px 10px rgb(0 0 0 / 0.35));
    }
    .r2l-monster--large { width: 180px; height: 180px; }
    .r2l-monster--small { width: 44px; height: 44px; }
    .r2l-monster--animate .r2l-monster__stack {
      animation: r2l-monster-float 3.2s ease-in-out infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .r2l-monster--animate .r2l-monster__stack { animation: none; }
    }
    .r2l-monster__stack {
      position: relative;
      width: 100%;
      height: 100%;
      transform-origin: center bottom;
      transition: transform 0.2s ease;
    }
    .r2l-monster:hover .r2l-monster__stack {
      transform: rotate(-2deg) scale(1.02);
    }
    @media (prefers-reduced-motion: reduce) {
      .r2l-monster:hover .r2l-monster__stack { transform: none; }
    }
    .r2l-monster__layer,
    .r2l-monster__fallback-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .r2l-monster__layer img {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: fill;
      object-position: center center;
      pointer-events: none;
    }
    .r2l-monster__fallback-body {
      inset: 8% 10% 6%;
      border-radius: 42% 42% 36% 36%;
    }
    .r2l-monster__fallback-eyes {
      inset: 28% 18% auto;
      height: 18%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 8%;
    }
    .r2l-monster__fallback-eye {
      width: 18%;
      height: 100%;
      border-radius: 9999px;
      background: rgb(10 14 26 / 0.85);
    }
    .r2l-monster__fallback-mouth {
      inset: auto 32% 22%;
      height: 10%;
      border-bottom: 3px solid rgb(10 14 26 / 0.75);
      border-radius: 0 0 9999px 9999px;
    }
    .r2l-monster__fallback-arms {
      inset: 38% -4% auto;
      height: 16%;
      display: flex;
      justify-content: space-between;
    }
    .r2l-monster__fallback-arm {
      width: 16%;
      height: 100%;
      border-radius: 9999px;
      opacity: 0.92;
    }
    .r2l-monster__fallback-detail {
      inset: 12% 38% auto;
      width: 24%;
      height: 12%;
      border-radius: 9999px;
      background: rgb(255 255 255 / 0.35);
    }
    .r2l-monster__hat {
      position: absolute;
      top: -8%;
      left: 50%;
      transform: translateX(-50%);
      font-size: 1.35em;
      line-height: 1;
      z-index: 5;
    }
    .r2l-monster--small .r2l-monster__hat { font-size: 0.85em; top: -12%; }
    .r2l-monster__pet {
      position: absolute;
      right: -4%;
      bottom: 2%;
      font-size: 0.9em;
      z-index: 5;
    }
  `;
  document.head.appendChild(style);
}

function renderFallbackLayer(
  stack: HTMLElement,
  slot: MonsterSlot,
  colorHex: string,
  className: string,
  innerHtml: string,
) {
  const layer = document.createElement('div');
  layer.className = `r2l-monster__fallback-layer r2l-monster__fallback-${slot} ${className}`;
  layer.style.backgroundColor = ['eyes', 'mouth'].includes(slot) ? '' : colorHex;
  layer.innerHTML = innerHtml;
  stack.appendChild(layer);
}

function renderFallbackMonster(stack: HTMLElement, config: MonsterConfig) {
  const colorHex = COLOR_HEX[config.color] || COLOR_HEX.mint;
  renderFallbackLayer(stack, 'body', colorHex, 'r2l-monster__fallback-body', '');
  renderFallbackLayer(
    stack,
    'arms',
    colorHex,
    'r2l-monster__fallback-arms',
    `<span class="r2l-monster__fallback-arm" style="background:${colorHex}"></span><span class="r2l-monster__fallback-arm" style="background:${colorHex}"></span>`,
  );
  renderFallbackLayer(stack, 'detail', colorHex, 'r2l-monster__fallback-detail', '');
  renderFallbackLayer(
    stack,
    'eyes',
    colorHex,
    'r2l-monster__fallback-eyes',
    '<span class="r2l-monster__fallback-eye"></span><span class="r2l-monster__fallback-eye"></span>',
  );
  renderFallbackLayer(stack, 'mouth', colorHex, 'r2l-monster__fallback-mouth', '');
}

function bodyColorFilter(color: string): string {
  return COLOR_BODY_FILTER[color] || COLOR_BODY_FILTER.mint;
}

function renderPartLayer(stack: HTMLElement, slot: MonsterSlot, partId: string, bodyColor?: string) {
  const file = partFile(slot, partId);
  if (!file) return false;
  const layer = document.createElement('div');
  layer.className = 'r2l-monster__layer';
  layer.dataset.slot = slot;
  const img = loadPartImage(`/assets/monsters/raw/${file.split('/').map(encodeURIComponent).join('/')}`);
  if (slot === 'body' && bodyColor) {
    img.style.filter = bodyColorFilter(bodyColor);
  }
  layer.appendChild(img);
  stack.appendChild(layer);
  return true;
}

export function renderMonster(
  container: HTMLElement,
  config: MonsterConfig,
  opts: MonsterRenderOpts = {},
) {
  if (typeof document === 'undefined') return;
  injectMonsterStyles();

  const size = opts.size || 'large';
  const withCosmetics = opts.withCosmetics !== false;
  const compact = opts.compactCosmetics ?? size === 'small';
  const animate = opts.animate !== false;
  const colorHex = COLOR_HEX[config.color] || COLOR_HEX.mint;

  container.innerHTML = '';
  container.className = [
    'r2l-monster',
    size === 'small' ? 'r2l-monster--small' : 'r2l-monster--large',
    animate ? 'r2l-monster--animate' : '',
  ].filter(Boolean).join(' ');

  const frameItem = withCosmetics
    ? getEquippedItem('frame', opts.equipped, opts.equippedDisplay)
    : null;
  if (frameItem?.css_class) {
    container.classList.add(frameItem.css_class);
  }

  const stack = document.createElement('div');
  stack.className = 'r2l-monster__stack';

  const useFallback = !hasManifestParts()
    || ['body', 'eyes', 'mouth', 'arms', 'detail'].some(
      (slot) => config[slot as MonsterSlot] === 'default' || !partFile(slot as MonsterSlot, config[slot as MonsterSlot]),
    );

  if (useFallback) {
    renderFallbackMonster(stack, config);
  } else {
    const order: MonsterSlot[] = ['body', 'arms', 'detail', 'eyes', 'mouth'];
    for (const slot of order) {
      renderPartLayer(stack, slot, config[slot as MonsterSlot], slot === 'body' ? config.color : undefined);
    }
  }

  container.appendChild(stack);

  if (withCosmetics) {
    const hatItem = getEquippedItem('hat', opts.equipped, opts.equippedDisplay);
    if (hatItem?.emoji) {
      const hat = document.createElement('span');
      hat.className = 'r2l-monster__hat';
      hat.setAttribute('aria-hidden', 'true');
      hat.textContent = hatItem.emoji;
      container.appendChild(hat);
    }

    if (!compact) {
      const petItem = getEquippedItem('pet', opts.equipped, opts.equippedDisplay);
      if (petItem?.emoji) {
        const pet = document.createElement('span');
        pet.className = 'r2l-monster__pet';
        pet.setAttribute('aria-hidden', 'true');
        pet.textContent = petItem.emoji;
        container.appendChild(pet);
      }
    }
  }
}

export function nameColorClassFromEquipped(
  equipped: Record<string, string> | undefined,
  equippedDisplay: EquippedDisplayItem[] | undefined,
): string {
  const item = getEquippedItem('name_color', equipped, equippedDisplay);
  return item?.css_class || '';
}

export function monsterSlotLabels(): Record<MonsterSlot, string> {
  return { ...SLOT_LABELS_VI };
}

export function applyHeaderMonsterAvatar(
  state: {
    avatar?: { monster?: MonsterConfig };
    equipped?: Record<string, string>;
    equipped_display?: EquippedDisplayItem[];
  },
  root: ParentNode = document,
) {
  const slot = root.querySelector('[data-r2l-v3-monster-avatar]') as HTMLElement | null;
  if (!slot || !state.avatar?.monster) return;
  slot.classList.remove('hidden');
  slot.classList.add('inline-flex');
  renderMonster(slot, state.avatar.monster, {
    size: 'small',
    withCosmetics: true,
    equipped: state.equipped,
    equippedDisplay: state.equipped_display,
    compactCosmetics: true,
  });
}

export { MONSTER_COLORS, MONSTER_MANIFEST, MONSTER_SLOTS, COLOR_HEX, SLOT_LABELS_VI };
