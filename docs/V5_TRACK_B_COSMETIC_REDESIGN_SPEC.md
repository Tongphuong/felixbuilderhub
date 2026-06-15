# V5 Track B — Cosmetic redesign curated (replace W7)

**Goal:** Replace W7 mixed-source disaster với 3 slot cosmetic CLEAR SHAPE kid thực sự muốn sở hữu (Roblox/Adopt Me style).
**Owner:** Codex monolith · **Branch:** `codex/v5-track-b-cosmetic` (off latest origin/main)
**Status:** READY — Phương ack 2026-06-16
**Estimated:** 8-10h Codex
**Principle:** GitHub-first OSS, **per-item screenshot pre-ship**, single-source style per slot.

---

## 1. 3 new slots replace W7

| Slot | Old W7 (disabled) | NEW V5 Track B | Source | Style |
|---|---|---|---|---|
| `effects` (overlay particles) | Kenney Particle abstract | KILL — defer V8 nếu cần | — | — |
| `frame` (border wrap) | Kenney UI rectangle | KILL — defer V8 nếu cần | — | — |
| **NEW `hat`** | — | crown/cap/helmet/party-hat | Game-icons.net CC BY | Silhouette tinted |
| **NEW `pet`** | — | small animal companion | Game-icons.net CC BY | Silhouette tinted, float beside monster |
| **NEW `wings`** | — | cartoon wings behind monster | RGS_Dev Modular CC0 | Cartoon vector |

**Per Phương lesson learned:** mỗi slot dùng 1 source duy nhất. KHÔNG mix.

---

## 2. Asset acquisition (Codex Step 1)

### 2A. Game-icons.net hat (CC BY 3.0)
- Browse https://game-icons.net/, search "hat", "crown", "helmet", "cap"
- Cherry-pick **20 SVG icons** clear shape kid-recognizable
- Tint pipeline: 5 colors via CSS `fill` override (no PNG variants) → 100 effective skins
- Destination: `public/assets/cosmetics/hat/*.svg`

### 2B. Game-icons.net pet (CC BY 3.0)
- Search "cat", "dog", "fox", "rabbit", "owl", "fish", "frog"
- Cherry-pick **15 SVG icons** clear animal silhouette
- Tint 4 colors → 60 effective skins
- Destination: `public/assets/cosmetics/pet/*.svg`

### 2C. RGS_Dev wings (CC0)
- Download https://opengameart.org/content/free-cc0-modular-animated-vector-characters-2d OR mirror
- Cherry-pick wing variants từ pack
- Convert to WebP nếu > 30KB. Target **8 wings** total
- Destination: `public/assets/cosmetics/wings/*.{webp,svg}`

### 2D. Credits
- Append `public/assets/CREDITS.md`:
  - Game-icons.net CC BY 3.0 + URL + 1-line credit on `/credits` page
  - RGS_Dev CC0 + URL

**Total asset budget:** < 600KB total (SVG tiny + WebP wings ~50KB each)

---

## 3. Pricing (matches existing tier structure)

| Tier | Hat | Pet | Wings |
|---|---|---|---|
| Common | 80 xu | 120 xu | 200 xu |
| Rare | 200 xu | 280 xu | 400 xu |
| Epic | 400 xu | 500 xu | 800 xu |

Rainbow tier (epic special): wings rainbow gradient SVG = 1000 xu collector item.

---

## 4. Files allowed

### Source manifest + state
- `src/data/monster-parts.json` — add 3 slot arrays (hat × 100, pet × 60, wings × 8)
- `public/assets/monsters/monster-parts.json` — sync runtime manifest
- `functions/api/_monster-manifest.js` — sync Functions runtime
- `functions/api/_monster-parts-data.mjs` — sync data
- `src/lib/monster-avatar.ts` — extend MONSTER_SLOTS với 3 slot mới + render functions:
  - Hat: anchor TOP center monster head (z-index 3, above face)
  - Pet: position absolute beside monster (z-index 2, floating)
  - Wings: anchor BACK monster body (z-index 0, behind body)
- `src/lib/monster-builder.ts` — slot integration + VN labels "Mũ" / "Thú cưng" / "Cánh"
- `functions/api/_read2lead-v2-state.js` — BASIC_MONSTER_CONFIG add `hat: '', pet: '', wings: ''`
- `functions/api/_read2lead-shop-v2.js` — pricing catalog + humanizePartId + SLOT_VI

### Shop UI
- `src/pages/read2lead/shop.astro` — wire 3 new filter chips "Mũ" / "Thú cưng" / "Cánh"
- `src/lib/shop-ux.ts` — chip render + slot metadata

### Tests
- `tests/v5-cosmetic-slots.test.mjs` (NEW) — manifest, state defaults, render z-order
- `tests/v5-cosmetic-shop.test.mjs` (NEW) — pricing, filter chips, buy flow

### CẤM
- Recorder engine, ASR, W2 modules
- W7 effects/frame slots — KEEP disabled (don't re-enable or delete)
- Track A files: lesson.astro, phu-huynh/[code].astro, learning-metrics.ts
- W5/W6 ceremony, leaderboard

---

## 5. Per-item visual validation (CRITICAL — Phương lesson)

**Codex MUST produce a visual grid screenshot** showing all 100 hat + 60 pet + 8 wings equipped on 3 sample monsters (Bạc default + Bạc with custom + Vàng custom).

**Acceptance criteria:**
- No item appears abstract/illegible (kid 7 tuổi recognizable)
- No item overflows monster bounding box egregiously
- No item clashes with face (hat sits on head, NOT over eyes)
- No item style xung đột với Kenney monster (silhouette tint = OK, photoreal NOT OK)

**If any item fails QA → exclude from manifest before push.** Document excluded items in PR body.

---

## 6. Z-order render (per spec §4 monster-avatar)

```
z=0  Wings layer (behind monster body, overflow back)
z=1  Monster body stack (existing)
z=2  Pet layer (beside monster, floating, NOT overlap body)
z=3  Hat layer (top of head, anchor monster top-center)
```

NO effects/frame slot rendering (W7 disabled).

---

## 7. State schema (additive)

```js
state.avatar.monster = {
  ...existing (body, eyes, mouth, arms, detail, effects, frame),  // W7 keep empty
  hat: '',
  pet: '',
  wings: '',
}
```

`schema_version` stays 2. Legacy migration: missing keys → `''`.

---

## 8. Done criteria

1. ~168 cosmetics live in shop (100 hat + 60 pet + 8 wings) — actual count may exclude QA failures
2. Per-slot filter chip visible
3. Z-order render correct (kid không thấy hat under face)
4. Visual grid screenshot in PR description (3 monsters × 168 items = 504 screenshots, sampled)
5. Pricing exact per §3
6. Tests ≥12 green
7. Full suite green atop main
8. Bundle delta < 200KB gz (SVG small, lazy load wings WebP)
9. VN labels complete (no English leak)
10. W7 effects/frame UNCHANGED (still disabled)
11. CREDITS file updated

---

## 9. Decision gates

| G | Question | Default |
|---|---|---|
| 1 | SVG tint via CSS `fill` (single-pass) hay generate PNG variants? | CSS (smaller) |
| 2 | Pet float animation — CSS keyframes hay static? | CSS bob 3s loop |
| 3 | Wings flap animation? | Yes, CSS transform 2s loop (subtle) |
| 4 | Rainbow wings (epic): SVG gradient hay PNG? | SVG (scales) |
| 5 | Hat brim alignment: per-item offset metadata hay assume center? | Per-item `anchor_offset_y` in manifest |

---

## 10. Hard constraints

- GitHub-first reuse — Game-icons.net + RGS_Dev. NO scratch art.
- Per-item visual screenshot REQUIRED in PR
- Single source per slot (hat=Game-icons, pet=Game-icons, wings=RGS_Dev)
- Schema additive
- Tests green
- Commit msg ends: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- DO NOT push main, push branch + spawn verify request inbox/2026-06-16_v5-track-b-audit.md (Wave 7+ template)
- DO NOT skip hooks
- ≤5 commits logical (assets / state-render / shop / catalog / tests OK)

---

## 11. Integration với Track A

Track A đang chạy parallel — em ESTIMATES file-disjoint:
- Track A touches: lesson.astro, phu-huynh dashboard, speaking-check response shape, learning-metrics.ts
- Track B touches: shop.astro, monster-avatar.ts render, monster-builder.ts slots, monster-parts.json, shop-v2.js

**Potential conflict:** monster-parts.json — both tracks may extend? Track A KHÔNG touch monster-parts.json per spec §2. → Clean.

If conflict at merge time → Track B rebase on top of Track A (Track A merged first).

---

## 12. Out of scope

- W7 effects/frame revival (defer V8 với new art)
- Pet AI behavior (just static/bob animation, no interaction)
- Wings physics (just flap loop)
- Achievement system (W6 P2 killed)
- Multi-equip same slot (one hat at a time)
