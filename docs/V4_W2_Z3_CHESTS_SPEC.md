# V4 W2 Z3 — Chest RNG spec (Cursor #2)

**Parent:** `docs/V4_W2_DOPAMINE_SPEC.md`
**Owner:** Cursor #2 · **Branch:** `cursor-2/w2-z3-chests` (off `origin/main`)
**Worktree:** `D:\hub-cursor-2-w2-z3`
**Status:** READY (Phương ack 2026-06-13: odds 70/25/5 OK)

---

## 1. Mục tiêu

Pure module — chest RNG (common/rare/epic) + reward generator + duplicate-part auto-convert. Z1 sẽ gọi `rollChest()` mỗi pack passed. KHÔNG đụng state-core.

## 2. Files allowed

- `functions/api/_read2lead-chests.js` (NEW — pure functions)
- `tests/read2lead-chests.test.mjs` (NEW)

Cấm đụng mọi file khác.

## 3. Module contract

```js
// functions/api/_read2lead-chests.js

import geometryManifest from '../../public/assets/monsters/monster-parts.json' assert { type: 'json' };

export const CHEST_ODDS = {
  common: 0.70,
  rare: 0.25,
  epic: 0.05,
};

export const CHEST_REWARDS = {
  common: { coins_min: 10, coins_max: 20, part_pool: null },
  rare:   { coins_min: 25, coins_max: 40, part_pool: 'rare_or_higher' },
  epic:   { coins_min: 50, coins_max: 50, part_pool: 'rare_only' },
};

export const DUPLICATE_CONVERSION = {
  common: 18,   // common duplicate → +18 xu (top of common range)
  rare: 30,     // rare duplicate → +30 xu
  epic: 60,     // epic duplicate → +60 xu (lifetime guarantee feels rewarding)
};

/**
 * Roll a chest based on RNG odds. Server-side only.
 * @param {Function} rngFn - () => float in [0, 1). Default: Math.random
 * @returns {{rarity: 'common'|'rare'|'epic'}}
 */
export function rollRarity(rngFn = Math.random) {
  const r = rngFn();
  if (r < CHEST_ODDS.epic) return { rarity: 'epic' };
  if (r < CHEST_ODDS.epic + CHEST_ODDS.rare) return { rarity: 'rare' };
  return { rarity: 'common' };
}

/**
 * Build full reward for a rarity. Picks coins in range + optional part.
 * @param {string} rarity - 'common' | 'rare' | 'epic'
 * @param {Function} rngFn - inject for tests
 * @returns {{coins: number, part_id: string|null}}
 */
export function buildReward(rarity, rngFn = Math.random) {
  const def = CHEST_REWARDS[rarity];
  if (!def) return { coins: 0, part_id: null };
  const coins = randInt(def.coins_min, def.coins_max, rngFn);
  const part_id = def.part_pool ? pickPartFromPool(def.part_pool, rngFn) : null;
  return { coins, part_id };
}

/**
 * Combined helper: roll + build.
 * @param {Function} rngFn
 * @returns {{rarity: string, reward: {coins: number, part_id: string|null}}}
 */
export function rollChest(rngFn = Math.random) {
  const { rarity } = rollRarity(rngFn);
  const reward = buildReward(rarity, rngFn);
  return { rarity, reward };
}

/**
 * If reward.part_id is already in ownedPartIds, convert to extra coins.
 * @param {{rarity: string, reward: {coins, part_id}}} chest
 * @param {Set<string>|Array<string>} ownedPartIds
 * @returns {{rarity, reward: {coins, part_id}, duplicate: boolean}}
 */
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

/**
 * Build a transparent "what could this chest contain" string for UI.
 * Public-facing, no RNG bias hidden.
 * @param {string} rarity
 * @returns {string}
 */
export function chestPreviewText(rarity) {
  const def = CHEST_REWARDS[rarity];
  if (!def) return '';
  const range = def.coins_min === def.coins_max ? `${def.coins_min}` : `${def.coins_min}–${def.coins_max}`;
  const part = def.part_pool ? ' + 1 phần thưởng' : '';
  return `Hộp này chứa ${range} xu${part}.`;
}
```

## 4. Part pool semantics

`monster-parts.json` đã có entry per part. Z3 cần lọc theo rarity tag. **Hiện tại manifest CHƯA có rarity field** — đây là Z3 task: thêm fallback default.

```js
function pickPartFromPool(poolName, rngFn) {
  const allParts = flattenManifest(geometryManifest);  // -> [{id, slot, rarity?}, ...]
  const filtered = poolName === 'rare_only'
    ? allParts.filter(p => (p.rarity || 'common') === 'rare' || p.rarity === 'epic')
    : allParts.filter(p => (p.rarity || 'common') !== 'common');
  if (filtered.length === 0) return null;
  return filtered[Math.floor(rngFn() * filtered.length)].id;
}

function flattenManifest(manifest) {
  // manifest is { parts: { body: [...], detail: [...], ... } } or similar
  // Walk + return flat array of {id, slot, rarity}
}
```

**Stub if manifest format unclear:** dùng tất cả parts với rarity = 'common' default. Z3 KHÔNG thêm rarity field vào manifest — đó là W3 work.

## 5. Tests (`tests/read2lead-chests.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import {
  CHEST_ODDS, CHEST_REWARDS, DUPLICATE_CONVERSION,
  rollRarity, buildReward, rollChest, autoConvertDuplicate, chestPreviewText,
} from '../functions/api/_read2lead-chests.js';

test('CHEST_ODDS sum to 1.0', () => { /* */ });
test('rollRarity with rng=0.01 → epic', () => { /* */ });
test('rollRarity with rng=0.1 → rare', () => { /* */ });
test('rollRarity with rng=0.5 → common', () => { /* */ });
test('rollRarity distribution close to odds over 10000 rolls (±2%)', () => {
  // Use seeded LCG (write a tiny one in test), count, assert each within 2%
});
test('buildReward common returns coins in 10..20', () => { /* */ });
test('buildReward epic returns 50 coins + part_id', () => { /* */ });
test('rollChest combines roll + build', () => { /* */ });
test('autoConvertDuplicate replaces dup part with bonus coins', () => { /* */ });
test('autoConvertDuplicate keeps part if not in owned set', () => { /* */ });
test('autoConvertDuplicate accepts Set or Array for ownedPartIds', () => { /* */ });
test('chestPreviewText transparent — exposes ranges', () => { /* */ });
```

Aim: 12+ tests, all green.

## 6. Done when

1. `_read2lead-chests.js` exports khớp contract §3.
2. `tests/read2lead-chests.test.mjs` xanh ≥12 tests including distribution test (±2%).
3. `node --test` toàn bộ xanh.
4. `npx astro check` không thêm error.
5. Branch `cursor-2/w2-z3-chests` pushed origin.
6. AGENT_LOG START + DONE với commit hash.

## 7. Constraints

- NO KV access, NO `fetch`, NO mutable global.
- RNG injectable cho tests (pure determinism).
- File < 200 lines.
- Đọc manifest read-only.

## 8. Report

Theo format AGENTS.md §4.
