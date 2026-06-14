# V4 W7 — Decoration slots: effects + frame

**Owner:** Codex · **Branch:** `codex/w7-decoration-slots` (off latest origin/main)
**Status:** READY — Phương ack 2026-06-14
**Author:** Claude · **Date:** 2026-06-14
**Estimated:** 5-7h (download + cherry-pick + integrate)

> **Why:** Hiện shop chỉ có 5 slot Monster Builder (body/eyes/mouth/arms/detail). Kid hỏi "pet đâu? cầu vồng đâu?". Phương muốn mở 2 slot mới:
> - **effects** (sparks/magic glow) overlay quanh monster
> - **frame** (ribbon/badge wrap + rainbow tier) bao quanh monster portrait
>
> Pet defer phase sau (cần CC BY credit + visual fit review).

---

## 1. Hard rules (Phương locked 2026-06-14)

| # | Rule | Why |
|---|---|---|
| 1 | Add 2 new slots `effects` + `frame` to MONSTER_SLOTS, additive only | Backward compat — existing kids không broken |
| 2 | State extends `state.avatar.monster.effects?: string` và `.frame?: string` (optional fields) | Schema_version stays 2 |
| 3 | Default effects = `''` (no effects), default frame = `''` (no frame). Kid earn qua shop, not free | Earn-through-learning preserved |
| 4 | Rainbow frame (multi-color gradient) = EPIC tier (lấp ý "cầu vồng" Phương hỏi) | Visual flair endgame |
| 5 | Render order: frame (back) → monster → effects (front overlay) | Z-index correct visually |

---

## 2. Asset download (Codex step 1)

### 2A. Kenney Particle Pack (CC0)

- **Source:** https://kenney.nl/assets/particle-pack
- **License:** CC0 — no attribution required
- **Cherry-pick ~40 sprites** từ folders: `Sparks`, `Magic`, `Stars`, `Fire`, `Hearts`, `Electric`
- **Convert to WebP** nếu PNG > 30KB. Target total ~600KB.
- **Destination:** `public/assets/effects/` (NEW dir)
- **Naming:** `effect-<theme>-<variant>.png` (e.g. `effect-spark-blue.png`, `effect-magic-purple.png`, `effect-rainbow.png`)
- **Rarity tagging:** plain sparkles = `common`, colored magic = `rare`, multi-color/electric/rainbow = `epic`

### 2B. Kenney UI Pack 2024 (CC0)

- **Source:** https://kenney.nl/assets/ui-pack
- **License:** CC0
- **Cherry-pick ~30 frame elements** từ folders: `panel`, `ribbon`, `badge`, `border` (5 color variants: blue, green, red, yellow, grey)
- **Convert to WebP** nếu PNG > 30KB. Target total ~400KB.
- **Destination:** `public/assets/frames/` (NEW dir)
- **Naming:** `frame-<style>-<color>.png` (e.g. `frame-ribbon-blue.png`, `frame-badge-rainbow.png`)
- **Rainbow frame:** create 1 SVG `frame-rainbow.svg` với CSS `background: linear-gradient(...)` qua các màu — đây là EPIC tier "cầu vồng"
- **Rarity tagging:** 1-color simple = `common`, multi-color = `rare`, rainbow gradient = `epic`

### 2C. CREDITS update

- Append `public/audio/kenney/CREDITS.md` (hoặc tạo `public/assets/CREDITS.md` chung) với:
  - "Particle Pack by Kenney.nl (CC0)" + URL
  - "UI Pack by Kenney.nl (CC0)" + URL
  - No attribution required nhưng good practice ghi nguồn.

---

## 3. Files allowed (CHÍNH XÁC)

### State + manifest layer
- `src/data/monster-parts.json` — add `effects: [...]` và `frame: [...]` arrays với cherry-picked sprite IDs + file paths
- `src/lib/monster-avatar.ts`:
  - Extend `MONSTER_SLOTS` to include `'effects'`, `'frame'`
  - Add `renderMonster` overlay layers: frame behind (z-index 0), effects in front (z-index 2). Monster current = z-index 1.
  - `SLOT_LABELS_VI`: `effects: 'Hiệu ứng'`, `frame: 'Khung'`
- `src/lib/monster-builder.ts`:
  - `BASIC_MONSTER_CONFIG` thêm `effects: '', frame: ''` (default empty)
  - `getAvailablePartsForSlot` xử lý 2 slot mới giống detail (basic stage = no cycle, custom stage = unlocked_parts only)
- `functions/api/_read2lead-v2-state.js`:
  - `normalizeMonsterConfig` chấp nhận thêm `effects`/`frame` field
  - `publicProgressState` expose `effects` + `frame` trong avatar.monster
  - Migration: existing kids → `effects: ''`, `frame: ''` (no backfill)
- `functions/api/_read2lead-shop-v2.js`:
  - Add catalog entries cho effects items + frame items (cherry-picked subset)
  - `SLOT_VI` thêm `effects: 'Hiệu ứng'`, `frame: 'Khung'`
  - `humanizePartId` xử lý naming: "Sparkle xanh", "Khung cầu vồng", v.v.
  - `executeBuy` accept slot=effects/frame (existing logic auto-handles via MONSTER_SLOTS extension)

### Render layer
- `src/lib/shop-ux.ts`:
  - Section filter chips: thêm "Hiệu ứng" + "Khung" (existing pattern body/eyes/etc)
  - Render items với `data-rarity` (đã hỗ trợ)
  - Thumbnail URL pattern cho 2 slot mới

### Tests (NEW)
- `tests/w7-decoration-slots.test.mjs`:
  - MONSTER_SLOTS includes effects + frame
  - normalize accepts new fields
  - default basic monster has empty effects + frame
  - shop catalog exposes effects + frame items
  - buying effect/frame auto-equips
- `tests/w7-render-layers.test.mjs`:
  - renderMonster includes frame layer (z behind) + effects layer (z front)
  - no frame/effects when slot value = ''

### CẤM (KHÔNG touch)
- `src/pages/read2lead/lesson.astro`
- `src/scripts/r2l-recorder*`, `functions/api/read2lead-speaking-check.js`
- `functions/api/_read2lead-quests.js`, `_read2lead-chests.js`, W2 modules
- `functions/api/read2lead-shop-buy.js` (logic existing đã handle slot extension auto)
- `functions/api/read2lead-leaderboard.js`
- `src/pages/read2lead/leaderboard.astro`
- W6 P1 files: `src/styles/r2l-w6-tiers.css`, `TierAura.astro`, `EquipCeremony.astro`, `r2l-w6-audio.ts` (KHÔNG MODIFY — chỉ consume)

---

## 4. Render flow

```
<div class="monster-portrait">
  {frame !== '' && <img src=".../frame-{frame}.png" class="monster-frame-layer" style="z-index: 0" />}
  <div class="monster-body-stack" style="z-index: 1">
    {renderMonsterStack(body, arms, eyes, mouth, detail)}
  </div>
  {effects !== '' && <img src=".../effect-{effects}.png" class="monster-effects-layer" style="z-index: 2; animation: float-overlay 3s ease-in-out infinite" />}
</div>
```

Effects layer:
- `position: absolute` overlay
- `pointer-events: none`
- Tier animation: common static, rare slow float, epic continuous twinkle (reuse W6 keyframes nếu phù hợp)

Frame layer:
- Behind monster
- Slightly larger bounding box
- Rainbow frame: dùng SVG với linear-gradient stops blue/purple/red/orange/yellow/green

---

## 5. Shop integration

Shop section ordering (sau update):
1. Sử Thi (epic items) — body/arms/eyes/mouth/detail + new epic effects/frames
2. Hiếm (rare items) — same expansion
3. Thường (common items) — same

Filter chip mới: `Hiệu ứng` + `Khung` xuất hiện cạnh "Thân/Tay/Mắt/Miệng/Chi tiết" trong filter UI.

Pricing:
- Common effects: 50 xu
- Rare effects: 150 xu
- Epic effects: 300 xu
- Common frame: 100 xu
- Rare frame: 250 xu
- Epic frame (rainbow): 500 xu

(Phương override sau nếu muốn)

---

## 6. Done when

1. `public/assets/effects/` có ~40 sprites Kenney Particle (CC0 verified)
2. `public/assets/frames/` có ~30 frames Kenney UI + 1 rainbow SVG (CC0 verified)
3. `monster-parts.json` extends với 2 slot arrays, IDs match file names
4. `MONSTER_SLOTS` array includes both new slots
5. State schema accepts + defaults `effects: ''`, `frame: ''`
6. Existing kids unchanged on first state read (migration safe)
7. Shop catalog exposes effects + frame items (common/rare/epic distribution)
8. Buy flow auto-equips effects/frame + fires `pending_ceremony` (existing logic)
9. Render flow shows frame behind monster + effects overlay in front
10. Empty effects/frame = no DOM element rendered (no overhead)
11. Tests ≥12 new across 2 files; full suite stays green
12. CREDITS file updated
13. Branch pushed; AGENT_LOG complete

---

## 7. Decision gates (Codex default per "Em đề xuất")

| Gate | Question | Default |
|---|---|---|
| G1 | Effects shapes: only stars/sparks OR include hearts/electric? | Include all 6 themes (sparks/magic/stars/fire/hearts/electric) |
| G2 | Frame style mix or chỉ ribbon? | Mix: 50% ribbon, 30% badge, 20% panel borders |
| G3 | Rainbow frame: SVG with CSS gradient OR pre-rendered PNG? | SVG (smaller + scales clean) |
| G4 | Effect animation: CSS keyframes OR static image? | CSS float keyframe (rare/epic), static (common) |
| G5 | Frame fits ALL monster sizes (S/M/L)? | yes — use viewBox-relative sizing |

---

## 8. Hard constraints

- Total new assets < 1.2 MB after WebP convert
- No new npm dep
- No touch logic của `read2lead-shop-buy.js` (đã handle slot ext)
- All animations honor `prefers-reduced-motion`
- All VN labels (no English exposed to kid)
- Schema version stays 2 (additive)
- Backward compat: undefined effects/frame in state → render nothing (no crash)

---

## 9. Integration với W5/W6

- W5 v2 `getAvailablePartsForSlot` (monster-builder.ts) → auto handles 2 slot mới sau khi MONSTER_SLOTS extended
- W6 P1 ceremony fires khi buy effect/frame rare/epic via existing `pending_ceremony` flow (`shop-buy.js` không cần update)
- W6 P1 aura visual đã wired vào shop (`shop.astro` hotfix `4dd62d3`) → effects/frame items auto-inherit aura

---

## 10. Out of scope

- Pet/companion slot (defer next wave, cần Game-icons CC BY review)
- Wings (defer W6 Phase 3 legendary tier)
- Background scene (lớn hơn, defer)
- Animated GIF effects (PNG sprite + CSS keyframe sufficient)
