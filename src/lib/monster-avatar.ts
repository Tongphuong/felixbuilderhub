import {
  MONSTER_COLORS,
  MONSTER_MANIFEST as BASE_MONSTER_MANIFEST,
  MONSTER_SLOTS as BASE_MONSTER_SLOTS,
  type MonsterColor,
} from './monster-manifest';
import { getPartRarity } from './avatar-rarity';
import {
  armDualAnchor,
  armSingleAnchors,
  bodyBoxFromFile,
  computeArmPairPlacement,
  computeAnchoredPlacement,
  computePartPlacement,
  isDualArmSprite,
  MONSTER_SLOT_REGIONS,
  resolvePartAnchor,
  type BodyBox,
  type BodySocketGeometry,
  type ArmGeometry,
  type PartAnchor,
} from './monster-slot-layout';
import geometryManifest from '../../public/assets/monsters/monster-parts.json';

const MONSTER_SLOTS = [...BASE_MONSTER_SLOTS, 'effects', 'frame', 'hat', 'pet', 'wings'] as const;
export type MonsterSlot = (typeof MONSTER_SLOTS)[number];
const CORE_MONSTER_SLOTS = ['body', 'eyes', 'mouth', 'arms', 'detail'] as const;
type CoreMonsterSlot = (typeof CORE_MONSTER_SLOTS)[number];
const V5_COSMETIC_SLOTS = ['hat', 'pet', 'wings'] as const;
type V5CosmeticSlot = (typeof V5_COSMETIC_SLOTS)[number];
type CosmeticManifestEntry = {
  id: string;
  file: string;
  color?: string;
  rarity?: 'common' | 'rare' | 'epic';
  anchor_offset_y?: number;
  price_override?: number;
};
const MONSTER_MANIFEST = BASE_MONSTER_MANIFEST as Record<
  MonsterSlot,
  Array<CosmeticManifestEntry>
>;
const W7_BUILD_ENABLED = import.meta.env.PUBLIC_R2L_W7 === '1';

export type MonsterConfig = {
  body: string;
  color: MonsterColor | string;
  eyes: string;
  mouth: string;
  arms: string;
  detail: string;
  effects?: string;
  frame?: string;
  hat?: string;
  pet?: string;
  wings?: string;
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
  effects: 'Hiệu ứng',
  frame: 'Khung',
  hat: 'Mũ',
  pet: 'Thú cưng',
  wings: 'Cánh',
};

const loadedImages = new Set<string>();

function w7DecorationsEnabled(): boolean {
  if (W7_BUILD_ENABLED) return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('PUBLIC_R2L_W7') === '1';
  } catch {
    return false;
  }
}

function partFile(slot: MonsterSlot, partId: string): string | null {
  const parts = MONSTER_MANIFEST[slot] || [];
  const match = parts.find((part) => part.id === partId);
  return match?.file || null;
}

function decorationFile(slot: 'effects' | 'frame', partId: string | undefined): string | null {
  if (!partId) return null;
  const file = partFile(slot, partId);
  if (!file) return null;
  return file.startsWith('/') ? file : `/assets/${slot}/${file}`;
}

function geometryPart(
  slot: 'body' | 'arms',
  partId: string,
): ({ geom?: ArmGeometry; sockets?: BodySocketGeometry['sockets'] } & { id: string }) | null {
  const parts = geometryManifest[slot] as Array<{
    id: string;
    geom?: ArmGeometry;
    sockets?: BodySocketGeometry['sockets'];
  }>;
  return parts.find((part) => part.id === partId) || null;
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

function cosmeticManifestEntry(slot: V5CosmeticSlot, partId: string): CosmeticManifestEntry | null {
  const parts = MONSTER_MANIFEST[slot] || [];
  return parts.find((part) => part.id === partId) || null;
}

function cosmeticTintColor(entry: CosmeticManifestEntry): string {
  return COLOR_HEX[entry.color || 'mint'] || COLOR_HEX.mint;
}

function renderTintedCosmetic(
  container: HTMLElement,
  slot: 'hat' | 'pet',
  partId: string,
  className: string,
) {
  const entry = cosmeticManifestEntry(slot, partId);
  if (!entry?.file) return;
  const wrap = document.createElement('div');
  wrap.className = className;
  wrap.dataset.slot = slot;
  wrap.dataset.rarity = entry.rarity || getPartRarity(partId);
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.setProperty('--cosmetic-color', cosmeticTintColor(entry));
  wrap.style.setProperty('--cosmetic-mask', `url(${entry.file})`);
  if (slot === 'hat' && typeof entry.anchor_offset_y === 'number') {
    wrap.style.setProperty('--hat-offset-y', `${entry.anchor_offset_y}px`);
  }
  const icon = document.createElement('span');
  icon.className = 'r2l-monster__cosmetic-tint';
  wrap.appendChild(icon);
  container.appendChild(wrap);
}

function renderWingsLayer(container: HTMLElement, partId: string | undefined) {
  if (!partId) return;
  const entry = cosmeticManifestEntry('wings', partId);
  if (!entry?.file) return;
  const layer = document.createElement('div');
  layer.className = 'r2l-monster__wings';
  layer.dataset.slot = 'wings';
  layer.dataset.rarity = entry.rarity || getPartRarity(partId);
  layer.setAttribute('aria-hidden', 'true');
  const img = loadPartImage(entry.file);
  img.className = 'r2l-monster__wings-img';
  layer.appendChild(img);
  container.appendChild(layer);
}

const COSMETIC_OVERLAYS_ENABLED = false;

function injectMonsterStyles() {
  if (document.getElementById('r2l-monster-styles')) return;
  const style = document.createElement('style');
  style.id = 'r2l-monster-styles';
  style.textContent = `
    @keyframes r2l-monster-float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-4px) rotate(-1deg); }
    }
    @keyframes r2l-decoration-float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-3%); }
    }
    @keyframes r2l-decoration-twinkle {
      0%, 100% { transform: translateY(0) scale(1); opacity: 0.82; }
      50% { transform: translateY(-3%) scale(1.05); opacity: 1; }
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
      z-index: 1;
      transform-origin: center bottom;
      transition: transform 0.2s ease;
    }
    .r2l-monster__frame-layer,
    .r2l-monster__effects-layer {
      position: absolute;
      pointer-events: none;
      object-fit: contain;
    }
    .r2l-monster__frame-layer {
      left: 50%;
      top: 50%;
      width: 124%;
      height: 124%;
      max-width: none;
      translate: -50% -50%;
      z-index: 0;
    }
    .r2l-monster__effects-layer {
      left: 50%;
      top: 50%;
      width: 130%;
      height: 130%;
      max-width: none;
      translate: -50% -50%;
      z-index: 2;
    }
    .r2l-monster__effects-layer[src*="/assets/effects/effect-spark-"] {
      z-index: 0;
    }
    .r2l-monster__effects-layer[data-rarity="rare"] {
      animation: r2l-decoration-float 3.6s ease-in-out infinite;
    }
    .r2l-monster__effects-layer[data-rarity="epic"] {
      animation: r2l-decoration-twinkle 2.4s ease-in-out infinite;
    }
    .r2l-monster:hover .r2l-monster__stack {
      transform: rotate(-2deg) scale(1.02);
    }
    @media (prefers-reduced-motion: reduce) {
      .r2l-monster:hover .r2l-monster__stack { transform: none; }
      .r2l-monster__effects-layer { animation: none !important; }
    }
    .r2l-monster__layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .r2l-monster__layer img {
      position: absolute;
      width: auto;
      height: auto;
      pointer-events: none;
      image-rendering: pixelated;
    }
    .r2l-monster__fallback-layer {
      position: absolute;
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
    @keyframes r2l-pet-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-5px); }
    }
    @keyframes r2l-wings-flap {
      0%, 100% { transform: scaleX(1) rotate(0deg); }
      50% { transform: scaleX(0.94) rotate(-2deg); }
    }
    .r2l-monster__wings {
      position: absolute;
      left: 50%;
      top: 18%;
      width: 130%;
      height: 75%;
      translate: -50% 0;
      z-index: 0;
      pointer-events: none;
    }
    .r2l-monster__wings-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      animation: r2l-wings-flap 2s ease-in-out infinite;
      transform-origin: center center;
    }
    .r2l-monster__cosmetic-tint {
      display: block;
      width: 100%;
      height: 100%;
      background-color: var(--cosmetic-color, #6ee7b7);
      mask-image: var(--cosmetic-mask);
      mask-size: contain;
      mask-repeat: no-repeat;
      mask-position: center;
      -webkit-mask-image: var(--cosmetic-mask);
      -webkit-mask-size: contain;
      -webkit-mask-repeat: no-repeat;
      -webkit-mask-position: center;
    }
    .r2l-monster__hat {
      position: absolute;
      top: calc(-6% + var(--hat-offset-y, 0px));
      left: 50%;
      width: 52%;
      height: 38%;
      translate: -50% 0;
      z-index: 3;
      pointer-events: none;
    }
    .r2l-monster--small .r2l-monster__hat {
      width: 58%;
      height: 42%;
      top: calc(-10% + var(--hat-offset-y, 0px));
    }
    .r2l-monster__pet {
      position: absolute;
      right: -6%;
      bottom: 4%;
      width: 34%;
      height: 34%;
      z-index: 2;
      pointer-events: none;
      animation: r2l-pet-bob 3s ease-in-out infinite;
    }
    .r2l-monster--small .r2l-monster__pet { display: none; }
    @media (prefers-reduced-motion: reduce) {
      .r2l-monster__pet { animation: none !important; }
      .r2l-monster__wings-img { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

function renderFallbackLayer(
  stack: HTMLElement,
  slot: CoreMonsterSlot,
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

function applyPlacementStyles(
  img: HTMLImageElement,
  p: { leftPct: number; topPct: number; widthPct: number; heightPct: number },
  flip = false,
) {
  img.style.left = `${p.leftPct}%`;
  img.style.top = `${p.topPct}%`;
  img.style.width = `${p.widthPct}%`;
  img.style.height = `${p.heightPct}%`;
  img.style.transform = flip ? 'scaleX(-1)' : '';
  img.style.transformOrigin = 'center center';
  img.style.visibility = 'visible';
}

function applyPartPlacement(
  img: HTMLImageElement,
  slot: CoreMonsterSlot,
  partFile: string,
  opts: { anchor?: PartAnchor; flip?: boolean; bodyBox?: BodyBox } = {},
) {
  const place = () => {
    const naturalW = img.naturalWidth || 1;
    const naturalH = img.naturalHeight || 1;
    if (slot === 'body') {
      const p = computePartPlacement(naturalW, naturalH, MONSTER_SLOT_REGIONS.body);
      applyPlacementStyles(img, p);
      return;
    }
    const anchor = opts.anchor ?? resolvePartAnchor(slot, partFile, opts.bodyBox);
    const p = computeAnchoredPlacement(naturalW, naturalH, anchor);
    applyPlacementStyles(img, p, opts.flip);
  };
  if (img.complete && img.naturalWidth > 0) {
    place();
  } else {
    img.style.visibility = 'hidden';
    img.addEventListener('load', place, { once: true });
  }
}

function renderPartLayer(
  stack: HTMLElement,
  slot: CoreMonsterSlot,
  partId: string,
  bodyColor?: string,
  opts: { anchor?: PartAnchor; flip?: boolean; bodyBox?: BodyBox } = {},
) {
  const file = partFile(slot, partId);
  if (!file) return false;
  const layer = document.createElement('div');
  layer.className = 'r2l-monster__layer';
  layer.dataset.slot = slot;
  const img = loadPartImage(`/assets/monsters/raw/${file.split('/').map(encodeURIComponent).join('/')}`);
  if (slot === 'body' && bodyColor) {
    img.style.filter = bodyColorFilter(bodyColor);
  }
  applyPartPlacement(img, slot, file, opts);
  layer.appendChild(img);
  stack.appendChild(layer);
  return true;
}

function renderArmsLayers(stack: HTMLElement, partId: string, bodyBox?: BodyBox) {
  const file = partFile('arms', partId);
  if (!file) return false;
  const bodyId = stack.dataset.bodyId || '';
  const body = geometryPart('body', bodyId);
  const arm = geometryPart('arms', partId);
  if (body?.geom && body.sockets && arm?.geom && bodyBox) {
    const placements = computeArmPairPlacement(
      { geom: body.geom, sockets: body.sockets },
      arm.geom,
      bodyBox,
    );
    const renderMeasuredArm = (placement: typeof placements.left) => {
      const layer = document.createElement('div');
      layer.className = 'r2l-monster__layer';
      layer.dataset.slot = 'arms';
      const img = loadPartImage(`/assets/monsters/raw/${file.split('/').map(encodeURIComponent).join('/')}`);
      applyPlacementStyles(img, placement, placement.flip);
      layer.appendChild(img);
      stack.appendChild(layer);
    };
    renderMeasuredArm(placements.left);
    renderMeasuredArm(placements.right);
    return true;
  }

  // Compatibility fallback for stale manifests: preserve the previous layout.
  if (isDualArmSprite(file)) {
    return renderPartLayer(stack, 'arms', partId, undefined, {
      anchor: armDualAnchor(bodyBox),
    });
  }
  const anchors = armSingleAnchors(bodyBox);
  const renderedLeft = renderPartLayer(stack, 'arms', partId, undefined, {
    anchor: anchors.left,
  });
  const renderedRight = renderPartLayer(stack, 'arms', partId, undefined, {
    anchor: anchors.right,
    flip: true,
  });
  return renderedLeft || renderedRight;
}

function renderDecorationLayer(
  container: HTMLElement,
  slot: 'effects' | 'frame',
  partId: string | undefined,
) {
  if (!w7DecorationsEnabled()) return;
  const src = decorationFile(slot, partId);
  if (!src || !partId) return;
  const img = loadPartImage(src);
  img.className = slot === 'frame'
    ? 'r2l-monster__frame-layer'
    : 'r2l-monster__effects-layer';
  img.dataset.slot = slot;
  img.dataset.rarity = getPartRarity(partId);
  img.setAttribute('aria-hidden', 'true');
  container.appendChild(img);
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
  container.innerHTML = '';
  container.className = [
    'r2l-monster',
    size === 'small' ? 'r2l-monster--small' : 'r2l-monster--large',
    animate ? 'r2l-monster--animate' : '',
  ].filter(Boolean).join(' ');

  const frameItem = withCosmetics && COSMETIC_OVERLAYS_ENABLED
    ? getEquippedItem('frame', opts.equipped, opts.equippedDisplay)
    : null;
  if (frameItem?.css_class) {
    container.classList.add(frameItem.css_class);
  }

  const stack = document.createElement('div');
  stack.className = 'r2l-monster__stack';

  if (withCosmetics && config.wings) {
    renderWingsLayer(container, config.wings);
  }

  renderDecorationLayer(container, 'frame', config.frame);

  const useFallback = !hasManifestParts()
    || CORE_MONSTER_SLOTS.some(
      (slot) => config[slot] === 'default' || !partFile(slot, config[slot]),
    );

  if (useFallback) {
    renderFallbackMonster(stack, config);
  } else {
    // Arms behind body; A/B/E sprites mirror to both sides.
    // All non-body parts anchor to the BODY's rendered box so the layout
    // holds across the 6 body shapes (165x165 .. 132x250), not just blueA.
    const bodyBox = bodyBoxFromFile(partFile('body', config.body) || '');
    stack.dataset.bodyId = config.body;
    renderArmsLayers(stack, config.arms, bodyBox);
    renderPartLayer(stack, 'body', config.body, config.color);
    renderPartLayer(stack, 'detail', config.detail, undefined, { bodyBox });
    renderPartLayer(stack, 'eyes', config.eyes, undefined, { bodyBox });
    renderPartLayer(stack, 'mouth', config.mouth, undefined, { bodyBox });
  }

  container.appendChild(stack);
  renderDecorationLayer(container, 'effects', config.effects);

  if (!compact && config.pet) {
    renderTintedCosmetic(container, 'pet', config.pet, 'r2l-monster__pet');
  }
  // V5 hat slot disabled — Game-icons.net silhouettes contain person/head shapes that
  // clash with monster face. Defer until proper hat-only art curated.
  // if (config.hat) {
  //   renderTintedCosmetic(container, 'hat', config.hat, 'r2l-monster__hat');
  // }

  if (withCosmetics && COSMETIC_OVERLAYS_ENABLED) {
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
