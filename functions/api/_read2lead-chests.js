import geometryManifest from '../../public/assets/monsters/monster-parts.json' with { type: 'json' };

export const CHEST_ODDS = {
  common: 0.70,
  rare: 0.25,
  epic: 0.05,
};

export const CHEST_REWARDS = {
  common: { coins_min: 10, coins_max: 20, part_pool: null },
  rare: { coins_min: 25, coins_max: 40, part_pool: 'rare_or_higher' },
  epic: { coins_min: 50, coins_max: 50, part_pool: 'rare_only' },
};

export const DUPLICATE_CONVERSION = {
  common: 18,
  rare: 30,
  epic: 60,
};

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
  if (!def) return { coins: 0, part_id: null };
  const coins = randInt(def.coins_min, def.coins_max, rngFn);
  const part_id = def.part_pool ? pickPartFromPool(def.part_pool, rngFn) : null;
  return { coins, part_id };
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
    reward: { coins: chest.reward.coins + bonus, part_id: null },
    duplicate: true,
  };
}

export function chestPreviewText(rarity) {
  const def = CHEST_REWARDS[rarity];
  if (!def) return '';
  const range = def.coins_min === def.coins_max
    ? `${def.coins_min}`
    : `${def.coins_min}–${def.coins_max}`;
  const part = def.part_pool ? ' + 1 phần thưởng' : '';
  return `Hộp này chứa ${range} xu${part}.`;
}
