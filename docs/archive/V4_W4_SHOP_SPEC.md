# V4 W4 — Shop 2.0 spec (1 Cursor agent)

**Owner:** Cursor · **Branch:** `cursor-N/w4-shop` (off `origin/v4-w2`)
**Status:** READY — depends on W2 Z3 (chests) + W3 (rarity) merged into v4-w2 first.
**Author:** Claude · **Date:** 2026-06-13

---

## 1. Goal

Replace the 8 emoji items với một shop bán **avatar parts unlocked via chest** + một số part **mua bằng coins trực tiếp**. Coin sink thật, kid wants to keep playing để có rare parts.

**Locked decisions (Phương đã ack indirectly qua roadmap):**
- Price tier: common = miễn phí (default unlocked), rare = 80 coins, epic = 200 coins.
- Kid không bao giờ phải spend để equip — equip free; spend chỉ để buy new part.
- No real money. No timed unlocks.

## 2. Files allowed

- `functions/api/_read2lead-shop-v2.js` (NEW — pure shop catalog + price functions)
- `functions/api/read2lead-shop-buy.js` (NEW — endpoint: deduct coins, add to unlocked_parts)
- `functions/api/read2lead-shop-list.js` (NEW — endpoint: list shop items + owned status)
- `src/pages/read2lead/shop.astro` (EDIT — replace 8 emoji UI với new shop list)
- `src/components/read2lead/v4/ShopItem.astro` (NEW)
- `src/components/read2lead/v4/ShopGrid.astro` (NEW)
- `tests/read2lead-shop-v2.test.mjs` (NEW)
- `tests/read2lead-shop-buy.test.mjs` (NEW)

CẤM:
- Sửa W2/W3 modules
- Sửa state-core (`_read2lead-v2-state.js`) — sử dụng existing `unlocked_parts` field từ W2 Z1
- Sửa lesson.astro, mic/speaking
- Touch protected files

## 3. _read2lead-shop-v2.js

```js
import { getPartRarity, listPartsByRarity } from '../../src/lib/avatar-rarity.ts'; // careful — may need re-export from a .js shim
// If TS import in functions/ doesn't work in Cloudflare Pages Functions runtime,
// duplicate the rarity logic here reading manifest directly (acceptable).

export const SHOP_PRICES = {
  common: 0,
  rare: 80,
  epic: 200,
};

/**
 * Build full shop catalog. All non-common parts as buyable items.
 * Common parts are NOT listed (free, default unlocked).
 */
export function buildShopCatalog() {
  const items = [];
  for (const partId of listPartsByRarity('rare')) {
    items.push({ id: partId, rarity: 'rare', price: SHOP_PRICES.rare, name: humanizePartId(partId) });
  }
  for (const partId of listPartsByRarity('epic')) {
    items.push({ id: partId, rarity: 'epic', price: SHOP_PRICES.epic, name: humanizePartId(partId) });
  }
  return items;
}

/**
 * Build shop list view with owned status per item for a given state.
 */
export function buildShopView(state) {
  const owned = new Set(state.unlocked_parts || []);
  return buildShopCatalog().map(item => ({
    ...item,
    owned: owned.has(item.id),
    can_afford: !owned.has(item.id) && numberOrZero(state.coins) >= item.price,
  }));
}

/**
 * Server-side buy logic — validates + mutates state.
 */
export function executeBuy(state, partId) {
  const owned = new Set(state.unlocked_parts || []);
  if (owned.has(partId)) return { state, error: 'already_owned' };
  const rarity = getPartRarity(partId);
  if (rarity === 'common') return { state, error: 'common_parts_are_free' };
  const price = SHOP_PRICES[rarity] || 0;
  if (numberOrZero(state.coins) < price) return { state, error: 'insufficient_coins' };
  return {
    state: {
      ...state,
      coins: state.coins - price,
      unlocked_parts: [...(state.unlocked_parts || []), partId],
    },
    reward: { part_id: partId, price },
  };
}

function humanizePartId(id) {
  // 'png-default-detail-blue-horn-large' → 'Sừng xanh lớn'
  // Implement simple mapping: color words VI, slot words VI
  // Fallback: return id as-is
}

function numberOrZero(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
```

## 4. Endpoints

### `read2lead-shop-list.js`
POST `{ code }` → load state → return `{ items: buildShopView(state), coins: state.coins }`.

### `read2lead-shop-buy.js`
POST `{ code, part_id }` → load state → `executeBuy` → save → return `{ ok, reward, coins, unlocked_parts }` hoặc `{ ok: false, error }`.

## 5. UI components

### `ShopItem.astro`
Props: `{ id, rarity, price, name, owned, can_afford }`. Render: thumbnail (placeholder rectangle), name, price + coin icon, button "Mua" (disabled if !can_afford), badge "✓ Có rồi" if owned.

### `ShopGrid.astro`
Props: `{ items: ShopItem[] }`. Group by rarity (rare row, epic row). Tap target ≥ 44px.

### `shop.astro` edit
Replace existing 8 emoji item array với fetch từ `/api/read2lead-shop-list` + render `ShopGrid`. Click "Mua" → POST `/api/read2lead-shop-buy` → update UI on success, show error toast on fail.

KHÔNG remove existing access code login flow. Style theo kid theme tokens (W1 done).

## 6. Tests

### `tests/read2lead-shop-v2.test.mjs` — ≥10 tests
```
test('SHOP_PRICES exposes 3 tiers')
test('buildShopCatalog only includes rare + epic parts')
test('buildShopView marks owned items')
test('buildShopView marks can_afford based on coins')
test('executeBuy success deducts coins + adds to unlocked_parts')
test('executeBuy rejects already_owned')
test('executeBuy rejects insufficient_coins')
test('executeBuy rejects common_parts_are_free')
test('executeBuy is pure (does not mutate input state)')
test('humanizePartId returns string for known formats')
```

### `tests/read2lead-shop-buy.test.mjs` — ≥6 tests (endpoint)
```
test('POST /shop-buy success returns ok + reward + new coin balance')
test('POST /shop-buy 400 already_owned')
test('POST /shop-buy 400 insufficient_coins')
test('POST /shop-buy 400 missing code')
test('POST /shop-buy 404 code not found')
test('POST /shop-buy persists to KV (mock)')
```

## 7. Done when

1. 2 endpoint files + 1 shop logic module + 2 UI components + shop.astro edited.
2. Tests ≥16 green.
3. `node --test` xanh.
4. `npx astro check` không thêm error.
5. Branch `cursor-N/w4-shop` pushed.
6. AGENT_LOG START + DONE với commit hash.

## 8. Constraints

- Touch only files §2.
- Use existing state field `unlocked_parts` (Z1 đã define).
- KHÔNG hardcode prices ngoài SHOP_PRICES constant.
- KHÔNG sửa shop.astro logic ngoài replace 8-emoji-list với new fetch.

## 9. Report

Per AGENTS.md §4 + git log/status/push proof.
