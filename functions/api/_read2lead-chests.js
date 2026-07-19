import geometryManifest from './_monster-parts-data.mjs';

export const CHEST_ODDS = {
  common: 0.70,
  rare: 0.25,
  epic: 0.05,
};

// R2L-REWARDS-REDESIGN (2026-07-18): rewards converted coins -> diamonds at
// 1💎 = 2🪙 (floor), per SPEC_R2L_REWARDS_REDESIGN.md §3.3/§5.
export const CHEST_REWARDS = {
  common: { diamonds_min: 5, diamonds_max: 10, part_pool: null },
  rare: { diamonds_min: 12, diamonds_max: 20, part_pool: 'rare_or_higher' },
  epic: { diamonds_min: 25, diamonds_max: 25, part_pool: 'rare_only' },
};

export const DUPLICATE_CONVERSION = {
  common: 9,
  rare: 15,
  epic: 30,
};

/**
 * Vietnamese labels for kid-facing UI. Mobile-game convention.
 * Phương 2026-06-13: kid không hiểu English "rare/epic" → việt hóa.
 */
export const RARITY_LABELS_VI = {
  common: 'Thường',
  rare: 'Hiếm',
  epic: 'Sử Thi',
};

/**
 * Mobile-game color tokens (matches W4 components --w2-chest-* CSS vars).
 */
export const RARITY_COLORS = {
  common: '#94a3b8', // gray
  rare: '#3b82f6',   // blue
  epic: '#a855f7',   // purple
};

export function rarityLabelVi(rarity) {
  return RARITY_LABELS_VI[rarity] || RARITY_LABELS_VI.common;
}

function randInt(min, max, rngFn) {
  return min + Math.floor(rngFn() * (max - min + 1));
}

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

function pickPartFromPool(poolName, rngFn) {
  const allParts = flattenManifest(geometryManifest);
  const filtered = poolName === 'rare_only'
    ? allParts.filter((p) => (p.rarity || 'common') === 'rare' || p.rarity === 'epic')
    : allParts.filter((p) => (p.rarity || 'common') !== 'common');
  if (filtered.length === 0) return null;
  return filtered[Math.floor(rngFn() * filtered.length)].id;
}

export function rollRarity(rngFn = Math.random) {
  const r = rngFn();
  if (r < CHEST_ODDS.epic) return { rarity: 'epic' };
  if (r < CHEST_ODDS.epic + CHEST_ODDS.rare) return { rarity: 'rare' };
  return { rarity: 'common' };
}

export function buildReward(rarity, rngFn = Math.random) {
  const def = CHEST_REWARDS[rarity];
  if (!def) return { diamonds: 0, part_id: null };
  const diamonds = randInt(def.diamonds_min, def.diamonds_max, rngFn);
  const part_id = def.part_pool ? pickPartFromPool(def.part_pool, rngFn) : null;
  return { diamonds, part_id };
}

export function rollChest(rngFn = Math.random) {
  const { rarity } = rollRarity(rngFn);
  const reward = buildReward(rarity, rngFn);
  return { rarity, reward };
}

export function autoConvertDuplicate(chest, ownedPartIds) {
  const owned = ownedPartIds instanceof Set ? ownedPartIds : new Set(ownedPartIds || []);
  if (!chest.reward.part_id || !owned.has(chest.reward.part_id)) {
    return { ...chest, duplicate: false };
  }
  const bonus = DUPLICATE_CONVERSION[chest.rarity] || 0;
  return {
    rarity: chest.rarity,
    reward: { diamonds: chest.reward.diamonds + bonus, part_id: null },
    duplicate: true,
  };
}

export function chestPreviewText(rarity) {
  const def = CHEST_REWARDS[rarity];
  if (!def) return '';
  const label = rarityLabelVi(rarity);
  const range = def.diamonds_min === def.diamonds_max
    ? `${def.diamonds_min}`
    : `${def.diamonds_min}–${def.diamonds_max}`;
  const part = def.part_pool ? ' + 1 phần thưởng' : '';
  return `Hộp ${label}: ${range}💎${part}.`;
}
