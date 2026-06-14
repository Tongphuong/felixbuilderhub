# V4 W5 v2 — Rank-based egg + locked basic monster + shop-only customize

**Owner:** Codex · **Branch:** `codex/w5-v2-rank-egg` (off `origin/main`)
**Status:** READY — Phương ack 4 rules 2026-06-14
**Author:** Claude · **Date:** 2026-06-14

> **Why v2:** W5 v1 (commit `8531f49`) gated egg by LEARNING LEVEL (L1=egg, L2+=basic). Phương feedback 2026-06-14: should be RANK-based (Đồng=egg, Bạc+=hatched). Plus basic stage hiện cho free common cycling — Phương muốn LOCKED, chỉ customize qua shop purchase.

---

## 1. The 4 rules (Phương locked)

| # | Rule | Why |
|---|---|---|
| 1 | **Hatch trigger:** `state.rank_ladder.tier_index >= 1` (đạt Bạc trở lên), KHÔNG phải learning level | Đồng-tier kids đều egg (consistent starting feel) |
| 2 | **Basic stage:** monster mặc định trắng + KHÔNG có MonsterBuilder cycling (hide MonsterBuilder UI) | All hatched monsters identical |
| 3 | **Customize ONLY via shop:** mua part → auto-equip vào monster + ceremony fire. KHÔNG cycle free common parts | Customization = earned currency, not free choice |
| 4 | **Leaderboard:** stage='egg' → render egg icon thay monster | Consistent identity across surfaces |

---

## 2. Files allowed

- `functions/api/_read2lead-v2-state.js`:
  - Update `normalizeAvatarStage(raw, state)` signature — pass full state để truy cập `rank_ladder.tier_index`
  - Logic: `tier_index < 1` → 'egg', else 'basic' (default), else 'custom' if has unlocked parts equipped
- `src/pages/hoc-sinh/hoc-sinh-w1.ts`:
  - Branch `stage === 'egg'` → render egg (existing, already works for L1)
  - Branch `stage === 'basic'` → render monster avatar BUT **hide MonsterBuilder section entirely**, show CTA "🛒 Trang trí ở Cửa hàng" instead
  - Branch `stage === 'custom'` → render monster avatar + MonsterBuilder visible (cycle qua unlocked_parts ONLY, no common cycling)
- `src/lib/monster-builder.ts`:
  - When stage='basic', `getAvailablePartsForSlot` returns SINGLE BASIC default part (no cycling list)
  - When stage='custom', filter to `unlocked_parts` (rare/epic only — NO common cycling). Common reset to basic config defaults.
- `functions/api/read2lead-shop-buy.js`:
  - On successful buy: auto-equip purchased part to monster config
  - Trigger ceremony event on next state read (via `pending_ceremony` field)
- `functions/api/_read2lead-v2-state.js`:
  - Add `pending_ceremony` field: `{ part_id, rarity, ts }` set on buy, consumed by client
- `functions/api/read2lead-ceremony-ack.js` (NEW): POST endpoint to clear `pending_ceremony` after client plays
- `src/pages/read2lead/leaderboard.astro`:
  - Read each row's `avatar_stage`. If 'egg' → render egg SVG icon. Else render monster.
- `functions/api/read2lead-leaderboard.js`:
  - Expose `avatar_stage` per row (additive field)
- Tests update:
  - `tests/avatar-progression.test.mjs`: rank-based hatch tests
  - `tests/avatar-lock.test.mjs`: basic stage = no cycling
  - `tests/read2lead-shop-buy.test.mjs`: auto-equip + pending_ceremony
  - New: `tests/leaderboard-egg-render.test.mjs`

CẤM:
- Touch lesson.astro, mic/speaking
- Touch W2 quest/chest/season logic
- Touch RP/rank calculation

---

## 3. State migration (CRITICAL — live students)

**Grandfather rules:**

```js
// In normalizeAvatarStage(raw, state):
const tierIdx = state.rank_ladder?.tier_index ?? 0;

// New computation
let computed = tierIdx < 1 ? 'egg' : 'basic';

// Migration: if persisted stage is 'custom' AND kid has unlocked_parts → keep 'custom'
if (raw === 'custom' && Array.isArray(state.unlocked_parts) && state.unlocked_parts.length > 0) {
  computed = 'custom';
}

// Migration: if kid was previously 'basic' but actually below Bạc → revert to 'egg'
// (corrects W5 v1 mistake)
if (tierIdx < 1 && (raw === 'basic' || raw === 'custom') && (!state.unlocked_parts || state.unlocked_parts.length === 0)) {
  computed = 'egg';
}

return computed;
```

**Edge cases:**
- Kid had custom monster (W5 v1 free choice) but tier_index < 1 + unlocked_parts empty → revert to egg, custom config lost gracefully (re-customize via shop after Bạc)
- Kid has unlocked_parts but tier_index < 1 → stay 'custom' (don't strip their purchases)

---

## 4. UI changes per stage

### Stage 'egg' (Đồng tier)
- Show egg SVG + greeting + hatch hint
- NO MonsterBuilder
- "Tap to read more" hint about how to hatch (= reach Bạc rank)

### Stage 'basic' (Bạc tier, no purchases)
- Show monster with `BASIC_MONSTER_CONFIG` (whiteA body + arm + moutha + eye-blue, no detail)
- NO MonsterBuilder
- Big CTA: "🛒 Trang trí ở Cửa hàng" → link to /read2lead/shop
- "Mới mở khoá!" toast first time entering Bạc

### Stage 'custom' (kid has purchased ≥1 part)
- MonsterBuilder visible
- Per-slot cycle: only options = `[BASIC_default]` + `[unlocked rare/epic for this slot]`
- Locked indicator: "🔒 Mua thêm ở Cửa hàng" still shows for slots với rare/epic chưa unlock
- Equip ceremony fires on first equip of each rare/epic part

---

## 5. Done when

1. State 'egg' for all kids tier_index < 1 (verified via Vodka/Phuc/Ong who should now show egg)
2. State 'basic' for tier_index >= 1 with no purchases
3. State 'custom' preserved for kids who have purchased parts
4. MonsterBuilder hidden on 'basic' stage, replaced with shop CTA
5. MonsterBuilder filtered to unlocked_parts only on 'custom' (no common cycling)
6. Shop-buy auto-equips part + sets pending_ceremony
7. Leaderboard renders egg icon for stage='egg' rows
8. Tests ≥10 new across 4 files; full suite stays green
9. Branch pushed; AGENT_LOG complete

---

## 6. Decision gates

| Gate | Question | Em đề xuất default |
|---|---|---|
| G1 | Hatch threshold: `tier_index >= 1` (Bạc) or `>= 2` (Vàng)? | Bạc (1) — earlier reward |
| G2 | Basic stage CTA text: "🛒 Trang trí ở Cửa hàng" or "Mua phụ kiện" or other? | "🛒 Trang trí ở Cửa hàng" (kid-friendly) |
| G3 | Hatch celebration when first reach Bạc: simple toast OR full ceremony 5s? | Full ceremony 5s + sound (one-time event) |
| G4 | Auto-equip on buy: silent OR with ceremony? | With ceremony (Phase 1 ceremony 2-4s scale) |
| G5 | If kid loses Bạc (RP decay) — revert to egg? | NO (Phương locked: RP never decreases, this is moot) |

---

## 7. Ship order

W5 v2 → W6 Phase 1 → W6 Phase 2 → defer W6 Phase 3.

W5 v2 MUST land before W6 Phase 1 because W6 uses W5 v2's `pending_ceremony` mechanism + `stage` logic.
