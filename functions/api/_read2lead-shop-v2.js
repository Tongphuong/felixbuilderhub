import geometryManifest from './_monster-parts-data.mjs';

export const SHOP_PRICES = {
  common: 0,
  rare: 80,
  epic: 200,
};

const COLOR_VI = {
  blue: 'xanh',
  dark: 'tối',
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

const SIZE_VI = {
  large: 'lớn',
  small: 'nhỏ',
};

/** @type {Map<string, 'common' | 'rare' | 'epic'> | null} */
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
    partIndex.set(part.id, rarity);
  }
  return partIndex;
}

export function getPartRarity(partId) {
  return buildIndex().get(partId) || 'common';
}

export function listPartsByRarity(rarity) {
  if (!['common', 'rare', 'epic'].includes(rarity)) return [];
  const out = [];
  for (const [id, value] of buildIndex().entries()) {
    if (value === rarity) out.push(id);
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
  const detailIdx = segments.indexOf('detail');
  if (detailIdx === -1) return raw;

  const tail = segments.slice(detailIdx + 1);
  if (tail.length === 0) return raw;

  const colorKey = tail[0];
  const color = COLOR_VI[colorKey] || colorKey;
  const rest = tail.slice(1).join('-');
  const sizeKey = rest.endsWith('-large') ? 'large' : rest.endsWith('-small') ? 'small' : '';
  const kindKey = sizeKey ? rest.replace(/-(large|small)$/, '') : rest;
  const kind = KIND_VI[kindKey] || KIND_VI[kindKey.replace(/-/g, '-')] || kindKey.replace(/-/g, ' ');
  const size = sizeKey ? SIZE_VI[sizeKey] : '';

  const label = [kind, color, size].filter(Boolean).join(' ');
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : raw;
}

export function hydrateShopState(state, rawProgress = null) {
  const unlocked = Array.isArray(rawProgress?.unlocked_parts)
    ? Array.from(new Set(rawProgress.unlocked_parts.filter(Boolean).map(String)))
    : Array.isArray(state?.unlocked_parts)
      ? state.unlocked_parts
      : [];
  return { ...state, unlocked_parts: unlocked };
}

export function buildShopCatalog() {
  const items = [];
  for (const partId of listPartsByRarity('rare')) {
    items.push({
      id: partId,
      rarity: 'rare',
      price: SHOP_PRICES.rare,
      name: humanizePartId(partId),
    });
  }
  for (const partId of listPartsByRarity('epic')) {
    items.push({
      id: partId,
      rarity: 'epic',
      price: SHOP_PRICES.epic,
      name: humanizePartId(partId),
    });
  }
  return items;
}

export function buildShopView(state) {
  const owned = new Set(state?.unlocked_parts || []);
  const coins = numberOrZero(state?.coins);
  return buildShopCatalog().map((item) => ({
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
  if (rarity === 'common') return { state, error: 'common_parts_are_free' };

  const price = SHOP_PRICES[rarity] || 0;
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
