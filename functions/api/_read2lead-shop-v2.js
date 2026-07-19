import geometryManifest from './_monster-parts-data.mjs';

// R2L-REWARDS-REDESIGN (2026-07-18): prices converted coins -> diamonds at
// 1💎 = 2🪙 (floor), per SPEC_R2L_REWARDS_REDESIGN.md §3.3/§5.
export const SHOP_PRICES = {
  common: 0,
  rare: 40,
  epic: 100,
};

export const DECORATION_PRICES = {
  effects: { common: 25, rare: 75, epic: 150 },
  frame: { common: 50, rare: 125, epic: 250 },
};

export const COSMETIC_PRICES = {
  hat: { common: 40, rare: 100, epic: 200 },
  pet: { common: 60, rare: 140, epic: 250 },
  wings: { common: 100, rare: 200, epic: 400 },
};

const SLOT_PRICES = { ...DECORATION_PRICES, ...COSMETIC_PRICES };

const COLOR_VI = {
  blue: 'xanh',
  dark: 'đen',
  green: 'xanh lá',
  red: 'đỏ',
  yellow: 'vàng',
  pink: 'hồng',
  purple: 'tím',
  white: 'trắng',
  black: 'đen',
  orange: 'cam',
};

const KIND_VI = {
  horn: 'Sừng',
  antenna: 'Râu',
  ear: 'Tai',
  eye: 'Mắt',
  'ear-round': 'Tai tròn',
};

const SLOT_VI = {
  body: 'Thân',
  arm: 'Tay',
  eye: 'Mắt',
  mouth: 'Miệng',
  nose: 'Mũi',
  snot: 'Mũi',
  eyebrow: 'Lông mày',
  hat: 'Mũ',
  pet: 'Thú cưng',
  wings: 'Cánh',
};

const HAT_KIND_VI = {
  crown: 'vương miện', beanie: 'len', 'party-hat': 'tiệc', fez: 'fez',
  'hard-hat': 'bảo hộ', bandana: 'khăn trùm', 'wizard-hat': 'phù thủy',
  sombrero: 'sombrero', 'pirate-hat': 'cướp biển', 'police-hat': 'cảnh sát',
  'cowboy-hat': 'cao bồi', 'grad-cap': 'tốt nghiệp', 'castle-crown': 'vương miện lâu đài',
  'barbarian-helm': 'barbarian', 'viking-helm': 'viking', ushanka: 'ushanka',
  'jewel-crown': 'vương miện ngọc', 'astronaut-helm': 'phi hành gia',
  'jester-hat': 'hề', 'crested-helm': 'có mào',
};

const PET_KIND_VI = {
  rabbit: 'thỏ', dog: 'chó', fish: 'cá', frog: 'ếch', chick: 'gà con', turtle: 'rùa',
  fox: 'cáo', owl: 'cú', penguin: 'chim cánh cụt', elephant: 'voi', duck: 'vịt',
  butterfly: 'bướm', bat: 'dơi', snake: 'rắn', horse: 'ngựa',
};

const WINGS_KIND_VI = {
  'wings-fairy-blue': 'cánh tiên xanh',
  'wings-fairy-pink': 'cánh tiên hồng',
  'wings-fairy-green': 'cánh tiên xanh lá',
  'wings-angel-white': 'cánh thiên thần trắng',
  'wings-angel-gold': 'cánh thiên thần vàng',
  'wings-dragon-red': 'cánh rồng đỏ',
  'wings-bat-dark': 'cánh dơi',
  'wings-rainbow': 'cánh cầu vồng',
};

const COSMETIC_COLOR_VI = {
  mint: 'bạc hà', coral: 'san hô', sky: 'xanh trời', lemon: 'vàng chanh', grape: 'tím',
};

const SIZE_VI = {
  large: 'lớn',
  small: 'nhỏ',
};

/** @type {Map<string, { rarity: 'common' | 'rare' | 'epic', slot: string }> | null} */
let partIndex = null;

function flattenManifest(manifest) {
  const source = manifest?.parts && typeof manifest.parts === 'object'
    ? manifest.parts
    : manifest;
  const flat = [];
  for (const [slot, entries] of Object.entries(source || {})) {
    if (!Array.isArray(entries)) continue;
    for (const part of entries) {
      if (!part?.id) continue;
      flat.push({ id: part.id, slot, rarity: part.rarity, price_override: part.price_override });
    }
  }
  return flat;
}

function inferRarityFromPartId(partId) {
  const norm = String(partId || '').toLowerCase();
  if (norm.includes('horn-large') || norm.includes('antenna-large')) return 'epic';
  if (
    norm.includes('horn-small')
    || norm.includes('antenna-small')
    || norm.includes('ear-round')
  ) {
    return 'rare';
  }
  return null;
}

function buildIndex() {
  if (partIndex) return partIndex;
  partIndex = new Map();
  for (const part of flattenManifest(geometryManifest)) {
    const rarity = part.rarity || inferRarityFromPartId(part.id) || 'common';
    partIndex.set(part.id, { rarity, slot: part.slot });
  }
  return partIndex;
}

export function getPartRarity(partId) {
  return buildIndex().get(partId)?.rarity || 'common';
}

export function getPartSlot(partId) {
  return buildIndex().get(partId)?.slot || null;
}

export function listPartsByRarity(rarity) {
  if (!['common', 'rare', 'epic'].includes(rarity)) return [];
  const out = [];
  for (const [id, value] of buildIndex().entries()) {
    if (value.rarity === rarity) out.push(id);
  }
  return out.sort();
}

export function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function humanizePartId(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  const segments = raw.split('-');

  if (segments[0] === 'effect') {
    const theme = {
      electric: 'điện',
      fire: 'lửa',
      heart: 'trái tim',
      magic: 'phép màu',
      spark: 'lấp lánh',
      star: 'ngôi sao',
    }[segments[1]] || segments[1];
    const color = COLOR_VI[segments[2]] || segments[2] || '';
    return ['Hiệu ứng', theme, color].filter(Boolean).join(' ');
  }

  if (segments[0] === 'hat') {
    const colorKey = segments.at(-1);
    const kind = segments.slice(1, -1).join('-');
    const color = COSMETIC_COLOR_VI[colorKey] || COLOR_VI[colorKey] || colorKey || '';
    const label = HAT_KIND_VI[kind] || kind.replace(/-/g, ' ');
    return ['Mũ', label, color].filter(Boolean).join(' ');
  }

  if (segments[0] === 'pet') {
    const colorKey = segments.at(-1);
    const kind = segments.slice(1, -1).join('-');
    const color = COSMETIC_COLOR_VI[colorKey] || COLOR_VI[colorKey] || colorKey || '';
    const label = PET_KIND_VI[kind] || kind.replace(/-/g, ' ');
    return ['Thú cưng', label, color].filter(Boolean).join(' ');
  }

  if (segments[0] === 'wings') {
    return WINGS_KIND_VI[raw] || `Cánh ${segments.slice(1).join(' ')}`;
  }

  if (segments[0] === 'frame') {
    if (segments[1] === 'rainbow') return 'Khung cầu vồng';
    const style = {
      badge: 'huy hiệu',
      panel: 'bảng',
      ribbon: 'ruy băng',
    }[segments[1]] || segments[1];
    const color = COLOR_VI[segments.at(-1)] || segments.at(-1) || '';
    return ['Khung', style, color].filter(Boolean).join(' ');
  }

  // Strip png-default- prefix
  if (segments[0] === 'png' && segments[1] === 'default') {
    segments.splice(0, 2);
  }
  if (segments.length === 0) return raw;

  const slot = segments[0];

  // body/arm: <slot>-<color><shapeLetter> (e.g. body-darkf, arm-bluea)
  if ((slot === 'body' || slot === 'arm') && segments.length === 2) {
    const cs = segments[1];
    const m = cs.match(/^([a-z]+)([a-f])$/);
    if (m) {
      const colorKey = m[1];
      const color = COLOR_VI[colorKey] || colorKey;
      return `${SLOT_VI[slot]} ${color}`;
    }
  }

  // detail: detail-<color>-<kind>[-size] (e.g. detail-blue-horn-large)
  const detailIdx = segments.indexOf('detail');
  if (detailIdx !== -1) {
    const tail = segments.slice(detailIdx + 1);
    if (tail.length === 0) return raw;
    const colorKey = tail[0];
    const color = COLOR_VI[colorKey] || colorKey;
    const rest = tail.slice(1).join('-');
    const sizeKey = rest.endsWith('-large') ? 'large' : rest.endsWith('-small') ? 'small' : '';
    const kindKey = sizeKey ? rest.replace(/-(large|small)$/, '') : rest;
    const kind = KIND_VI[kindKey] || kindKey.replace(/-/g, ' ');
    const size = sizeKey ? SIZE_VI[sizeKey] : '';
    const label = [kind, color, size].filter(Boolean).join(' ');
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : raw;
  }

  // mouth/eye/nose/snot/eyebrow: glued <slot><letter> e.g. mouthh, eyec
  if (segments.length === 1) {
    const m = slot.match(/^(mouth|eye|nose|snot|eyebrow)([a-z])$/);
    if (m) {
      return SLOT_VI[m[1]];
    }
  }

  // Fallback for hyphenated multi-segment slot names
  if (SLOT_VI[slot] && segments.length >= 2) {
    const variant = segments.slice(1).join(' ');
    return `${SLOT_VI[slot]} ${variant}`;
  }

  return raw;
}

export function hydrateShopState(state, rawProgress = null) {
  const unlocked = Array.isArray(rawProgress?.unlocked_parts)
    ? Array.from(new Set(rawProgress.unlocked_parts.filter(Boolean).map(String)))
    : Array.isArray(state?.unlocked_parts)
      ? state.unlocked_parts
      : [];
  return { ...state, unlocked_parts: unlocked };
}

function getPartPriceOverride(partId) {
  const slot = getPartSlot(partId);
  if (!slot) return null;
  const parts = flattenManifest(geometryManifest).filter((p) => p.slot === slot);
  const match = parts.find((p) => p.id === partId);
  return typeof match?.price_override === 'number' ? match.price_override : null;
}

function buildCatalogItem(partId) {
  const rarity = getPartRarity(partId);
  const slot = getPartSlot(partId);
  const priceOverride = getPartPriceOverride(partId);
  const price = priceOverride ?? SLOT_PRICES[slot]?.[rarity] ?? SHOP_PRICES[rarity] ?? 0;
  return {
    id: partId,
    slot,
    rarity,
    price,
    name: humanizePartId(partId),
  };
}

function isPurchasableCosmeticSlot(slot) {
  return Boolean(SLOT_PRICES[slot]);
}

// V5 Track B disabled — Game-icons.net + RGS_Dev art style conflicts with
// Kenney monster cartoon style. Defer until style-matched art curated.
function isV5CosmeticSlot(slot) {
  return slot === 'hat' || slot === 'pet' || slot === 'wings';
}

export function buildShopCatalog({ includeDecorations = false } = {}) {
  const items = [];
  for (const partId of listPartsByRarity('rare')) {
    if (isV5CosmeticSlot(getPartSlot(partId))) continue;
    if (includeDecorations || !isPurchasableCosmeticSlot(getPartSlot(partId))) {
      items.push(buildCatalogItem(partId));
    }
  }
  for (const partId of listPartsByRarity('epic')) {
    if (isV5CosmeticSlot(getPartSlot(partId))) continue;
    if (includeDecorations || !isPurchasableCosmeticSlot(getPartSlot(partId))) {
      items.push(buildCatalogItem(partId));
    }
  }
  if (includeDecorations) {
    for (const partId of listPartsByRarity('common')) {
      if (isV5CosmeticSlot(getPartSlot(partId))) continue;
      if (isPurchasableCosmeticSlot(getPartSlot(partId))) {
        items.push(buildCatalogItem(partId));
      }
    }
  }
  return items;
}

// Silver rank (Level L2 "Bạc") and above shop for free — founder decision
// (SPEC_R2L_REWARDS_REDESIGN.md §3.2/§7#1): the visible kid-facing LEVEL,
// not the ladder tier_index.
export function isSilverOrAbove(state) {
  return ['L2', 'L3', 'L4', 'L5'].includes(state?.current_level);
}

export function buildShopView(state) {
  const owned = new Set(state?.unlocked_parts || []);
  const diamonds = numberOrZero(state?.diamonds);
  const free = isSilverOrAbove(state);
  return buildShopCatalog({ includeDecorations: true }).map((item) => {
    const price = free ? 0 : item.price;
    return {
      ...item,
      price,
      owned: owned.has(item.id),
      can_afford: owned.has(item.id) ? false : (free || diamonds >= price),
    };
  });
}

export function executeBuy(state, partId) {
  const id = String(partId || '').trim();
  const owned = new Set(state?.unlocked_parts || []);
  if (owned.has(id)) return { state, error: 'already_owned' };

  const rarity = getPartRarity(id);
  const slot = getPartSlot(id);
  if (!slot) return { state, error: 'part_not_found' };
  if (rarity === 'common' && !isPurchasableCosmeticSlot(slot)) {
    return { state, error: 'common_parts_are_free' };
  }

  const priceOverride = getPartPriceOverride(id);
  const fullPrice = priceOverride ?? SLOT_PRICES[slot]?.[rarity] ?? SHOP_PRICES[rarity] ?? 0;
  const price = isSilverOrAbove(state) ? 0 : fullPrice;
  if (numberOrZero(state?.diamonds) < price) return { state, error: 'insufficient_diamonds' };

  return {
    state: {
      ...state,
      diamonds: numberOrZero(state.diamonds) - price,
      unlocked_parts: [...(state.unlocked_parts || []), id],
    },
    reward: { part_id: id, price },
  };
}
