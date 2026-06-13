# V4 W3 — Avatar 2.0 spec (1 Cursor agent)

**Owner:** Cursor · **Branch:** `cursor-N/w3-avatar` (off `origin/v4-w2`)
**Status:** READY — depends on W2 Z3 chest module (already in v4-w2) for unlock contract.
**Author:** Claude · **Date:** 2026-06-13

---

## 1. Goal

Drop the "lộn xộn" mix (Kenney PNG + emoji hats + CSS frame) → **one art system: Kenney monster parts only**, with rarity tags + part unlocks driven by W2 chests. Body color goes parametric (drop muddy `hue-rotate`).

**Out of scope:** drawing new parts, shop UI (W4), customizer redesign.

## 2. Files allowed

- `public/assets/monsters/monster-parts.json` (ADD `rarity` field to entries; default 'common')
- `src/lib/monster-manifest.ts` (EXTEND types — add `rarity?: 'common' | 'rare' | 'epic'`)
- `src/lib/monster-avatar.ts` (EDIT — gate cosmetic emoji/hat/pet rendering behind a flag set to off; keep code, just don't render)
- `src/lib/avatar-rarity.ts` (NEW — helper `getPartRarity(partId): rarity`, `isPartUnlocked(state, partId): boolean`)
- `tests/avatar-rarity.test.mjs` (NEW)
- `tests/monster-avatar-cosmetic-off.test.mjs` (NEW — verify emoji/hat overlays not rendered)

CẤM:
- Sửa W2 modules (`_read2lead-quests.js`, `_read2lead-chests.js`, `_read2lead-v2-state.js`)
- Sửa lesson.astro, mic/speaking
- Thêm new PNG parts
- Refactor `monster-avatar.ts` ngoài cosmetic-off gate

## 3. Manifest rarity field

Update `public/assets/monsters/monster-parts.json` — add `rarity` per part:

```jsonc
{
  "id": "png-default-body-blue-A",
  "file": "PNG/Default/body_blueA.png",
  "rarity": "common"
}
```

**Default rule:** all existing parts → `rarity: "common"`.

**Tagging:** Cursor đề xuất tagging cho ~20% parts (theo visual: extreme colors, large horns, special details) → `rare`. ~5% parts (rất phá cách) → `epic`. **Phương sẽ duyệt list — Cursor commit default ALL "common" trước**, em sẽ rebatch tagging sau khi Phương review thumbnail.

## 4. avatar-rarity.ts

```ts
import manifest from '../../public/assets/monsters/monster-parts.json' assert { type: 'json' };

export type PartRarity = 'common' | 'rare' | 'epic';

let partIndex: Map<string, PartRarity> | null = null;
function buildIndex(): Map<string, PartRarity> {
  if (partIndex) return partIndex;
  partIndex = new Map();
  // walk manifest.parts.<slot>[] entries
  for (const slotEntries of Object.values((manifest as any).parts || {})) {
    for (const entry of slotEntries as any[]) {
      if (entry?.id) partIndex.set(entry.id, (entry.rarity as PartRarity) || 'common');
    }
  }
  return partIndex;
}

export function getPartRarity(partId: string): PartRarity {
  return buildIndex().get(partId) || 'common';
}

export function isPartUnlocked(state: { unlocked_parts?: string[] }, partId: string): boolean {
  // Common parts default unlocked for everyone (kid-first: never block default monster).
  if (getPartRarity(partId) === 'common') return true;
  return Array.isArray(state.unlocked_parts) && state.unlocked_parts.includes(partId);
}

export function listPartsByRarity(rarity: PartRarity): string[] {
  const out: string[] = [];
  for (const [id, r] of buildIndex().entries()) {
    if (r === rarity) out.push(id);
  }
  return out;
}
```

## 5. Cosmetic-off gate trong monster-avatar.ts

Tìm code chỗ overlay emoji hat/pet/CSS-frame (Cursor grep `equippedDisplay` hoặc `cosmetics`). Wrap render trong:

```ts
const COSMETIC_OVERLAYS_ENABLED = false;  // W3: drop emoji/hat/pet/frame overlays
if (COSMETIC_OVERLAYS_ENABLED) {
  // existing overlay render code
}
```

KHÔNG xóa code overlay — chỉ gate. W4 sẽ replace với real cosmetics.

## 6. Tests

### `tests/avatar-rarity.test.mjs` — ≥8 tests
```
test('getPartRarity defaults common for unknown id')
test('getPartRarity reads rarity from manifest entry')
test('isPartUnlocked true for common regardless of state')
test('isPartUnlocked false for rare not in unlocked_parts')
test('isPartUnlocked true for rare in unlocked_parts')
test('listPartsByRarity returns array of ids matching rarity')
test('listPartsByRarity returns [] for unknown rarity (defensive)')
test('buildIndex idempotent across multiple calls')
```

### `tests/monster-avatar-cosmetic-off.test.mjs` — ≥3 tests
```
test('renderMonster does not include emoji hat overlay when state.equipped has hat')
test('renderMonster does not include pet overlay')
test('renderMonster does not add CSS frame class')
```

## 7. Done when

1. `monster-parts.json` has `rarity` field on every part (all 'common' default).
2. `avatar-rarity.ts` created với 3 exports.
3. `monster-avatar.ts` gates cosmetic overlays behind `COSMETIC_OVERLAYS_ENABLED = false`.
4. Tests ≥11 green.
5. `node --test` toàn bộ xanh.
6. `npx astro check` không thêm error.
7. Branch `cursor-N/w3-avatar` pushed.
8. AGENT_LOG START + DONE với commit hash.

## 8. Constraints

- KHÔNG đổi PNG file, KHÔNG add new parts.
- KHÔNG đụng W2 code.
- KHÔNG remove cosmetic overlay code — chỉ gate.

## 9. Report

Per AGENTS.md §4 + paste git log/status/push proof.
