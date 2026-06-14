import geometryManifest from './_monster-parts-data.mjs';

export const SHOP_PRICES = {
  common: 0,
  rare: 80,
  epic: 200,
};

export const DECORATION_PRICES = {
  effects: { common: 50, rare: 150, epic: 300 },
  frame: { common: 100, rare: 250, epic: 500 },
};

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
      flat.push({ id: part.id, slot, rarity: part.rarity });
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

function buildCatalogItem(partId) {
  const rarity = getPartRarity(partId);
  const slot = getPartSlot(partId);
  const price = DECORATION_PRICES[slot]?.[rarity] ?? SHOP_PRICES[rarity] ?? 0;
  return {
    id: partId,
    slot,
    rarity,
    price,
    name: humanizePartId(partId),
  };
}

export function buildShopCatalog({ includeDecorations = false } = {}) {
  const items = [];
  for (const partId of listPartsByRarity('rare')) {
    if (includeDecorations || !DECORATION_PRICES[getPartSlot(partId)]) {
      items.push(buildCatalogItem(partId));
    }
  }
  for (const partId of listPartsByRarity('epic')) {
    if (includeDecorations || !DECORATION_PRICES[getPartSlot(partId)]) {
      items.push(buildCatalogItem(partId));
    }
  }
  if (includeDecorations) {
    for (const partId of listPartsByRarity('common')) {
      if (DECORATION_PRICES[getPartSlot(partId)]) {
        items.push(buildCatalogItem(partId));
      }
    }
  }
  return items;
}

export function buildShopView(state) {
  const owned = new Set(state?.unlocked_parts || []);
  const coins = numberOrZero(state?.coins);
  return buildShopCatalog({ includeDecorations: true }).map((item) => ({
    ...item,
    owned: owned.has(item.id),
    can_afford: !owned.has(item.id) && coins >= item.price,
  }));
}

export function executeBuy(state, partId) {
  const id = String(partId || '').trim();
  const owned = new Set(state?.unlocked_parts || []);
  if (owned.has(id)) return { state, error: 'already_owned' };

  const rarity = getPartRarity(id);
  const slot = getPartSlot(id);
  if (!slot) return { state, error: 'part_not_found' };
  if (rarity === 'common' && !DECORATION_PRICES[slot]) {
    return { state, error: 'common_parts_are_free' };
  }

  const price = DECORATION_PRICES[slot]?.[rarity] ?? SHOP_PRICES[rarity] ?? 0;
  if (numberOrZero(state?.coins) < price) return { state, error: 'insufficient_coins' };

  return {
    state: {
      ...state,
      coins: numberOrZero(state.coins) - price,
      unlocked_parts: [...(state.unlocked_parts || []), id],
    },
    reward: { part_id: id, price },
  };
}
