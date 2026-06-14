# V4 W6 — Rarity feel (perceived difference giữa Thường/Hiếm/Sử Thi)

**Owner:** Codex (split Phase 1 + Phase 2) · Phase 3 = Phương decision
**Branch:** `codex/w6-rarity-feel-p1`, `codex/w6-rarity-feel-p2`
**Status:** READY — Phương ack 4 layers + 3 phases 2026-06-14
**Author:** Claude · **Date:** 2026-06-14

> **Problem:** Kenney Monster Builder = 1 art style cartoon. Common horn ≈ epic horn visually. Kid không có lý do "thèm" mua epic. Mobile games (Liên Quân, Genshin) tạo rarity gradient bằng **flair effects** không phải art.
>
> **Solution:** 4-layer flair stack KHÔNG cần thêm art chính. Layer 3 (curate non-Kenney) defer phase 3.

---

## 1. Đòn bẩy strategic (em flag cho Phương)

- **Kid 7 tuổi perception đơn giản** — particle + glow + size đủ feel "khác hẳn". Không over-engineer Huyền Thoại trước khi Hiếm/Sử Thi ổn.
- **Liên Quân flair = budget khổng lồ.** Anh không match được. Đòn bẩy thật: **earned-through-learning** (kid mua xu bằng học bài) + **personalization** (parent-pride).
- **Cùng style art** thực ra advantage — Kenney palette consistency làm tier difference NHẤN MẠNH bằng auras, không bị mất focus.

---

## 2. Tier visual schema (Phase 1)

| Tier | VN label | Color token | Border | Particle aura | Avatar size | Animation | Audio stinger |
|---|---|---|---|---|---|---|---|
| **common** | Thường | `--w6-common: #94a3b8` (slate) | none | none | 1.0× | static | none |
| **rare** | Hiếm | `--w6-rare: #3b82f6` (blue) | 2px glow pulse, blue | 2 sparkles float chậm (Kenney `spark_07`) | 1.0× | gentle bob 2s | quiet ping (Kenney `coin-clink`) |
| **epic** | Sử Thi | `--w6-epic: #a855f7` (purple) | 3px flame ripple, purple | 6 sparkles + magic ring xoay 3s loop | 1.05× | continuous shimmer + hue-rotate 6s | medium swell (Kenney `quest-complete` extended) |
| **legendary** *(Phase 3)* | Huyền Thoại | `--w6-legendary: #fbbf24` → animated rainbow | 4px gold rotating frame | particle burst + lightning continuous | 1.1× | rainbow hue shift 8s | orchestra swell 6s |

Tokens add vào `src/styles/r2l-w6-tiers.css` (NEW). KHÔNG sửa Z4 colors hiện tại.

---

## 3. PHASE 1 spec (Codex implement first)

**Branch:** `codex/w6-rarity-feel-p1` off `origin/main`
**Estimated:** 1.5–2h

### 3.1 Files allowed

- `src/styles/r2l-w6-tiers.css` (NEW — tier color tokens + glow keyframes)
- `src/components/read2lead/v4/TierAura.astro` (NEW — reusable aura wrapper, takes `rarity` prop)
- `src/components/read2lead/v4/RarityBadge.astro` (EDIT — sync với new color tokens + sparkle for epic)
- `src/components/read2lead/v4/ShopItem.astro` (EDIT — wrap thumbnail in TierAura)
- `src/components/read2lead/v4/EquipCeremony.astro` (EDIT — scale duration: rare 2s / epic 4s / legendary 6s)
- `src/lib/monster-builder.ts` (EDIT — ceremony JS timer scale by rarity input)
- `src/lib/r2l-w6-audio.ts` (NEW — audio stinger mapping per tier)
- `src/pages/hoc-sinh/hoc-sinh-w1.ts` (EDIT — apply TierAura quanh main monster avatar based on highest equipped rarity)
- `tests/w6-tier-aura.test.mjs` (NEW)
- `tests/w6-rarity-ceremony-duration.test.mjs` (NEW)

CẤM:
- Sửa state-core, shop endpoints (W6 = pure visual layer)
- Touch lesson.astro, mic/speaking
- Thêm new image assets (chỉ CSS + existing Kenney audio + Kenney Particle Pack)

### 3.2 Done when

1. `TierAura.astro` renders aura layers (border + particle div) wrapped around child. Common = no-op pass-through.
2. ShopItem visually distinct between Thường/Hiếm/Sử Thi (border + sparkle).
3. Equip ceremony duration scales: 2s (rare) / 4s (epic) — Phase 1 không có legendary 6s yet.
4. Audio stinger differentiated per tier via `r2l-w6-audio.ts`.
5. Avatar slot on `/hoc-sinh` shows aura matching highest equipped rarity.
6. Tests ≥6 across 2 files green; full suite stays at 496+ green.
7. Branch pushed; AGENT_LOG START + DONE.

### 3.3 Hard constraints

- Particle aura sprites lazy-loaded (don't grow lesson bundle).
- All animations `prefers-reduced-motion` respect.
- No new npm dep.
- CSS file < 200 lines.

---

## 4. PHASE 2 spec (Codex implement after Phase 1 merged)

**Branch:** `codex/w6-rarity-feel-p2`
**Estimated:** 1.5–2h

### 4.1 Scope

- **Layer 2 (CSS filter palette)**: Sử Thi parts get `filter: hue-rotate(15deg) saturate(1.25)` thực thi qua avatar render pipeline (already supports CSS filter on body color).
- **Particle attachment overlay**: Sử Thi horn/antenna gets lightning bolt sprite từ Kenney Particle Pack overlaid via z-index. Anchor to part bounding box.
- **Achievement badge "Lần đầu sở hữu Sử Thi 💎"** — saved to `state.first_rarity_owned: { rare: ts, epic: ts, legendary: ts }`. Show toast khi unlock.
- **Floating tier badge** trên monster portrait — "✨ Sử Thi" badge top-right of monster slot.
- **Leaderboard tier color** — name color = highest equipped tier color.

### 4.2 Files allowed

- `functions/api/_read2lead-v2-state.js` (EDIT — add `first_rarity_owned` field, normalizer)
- `functions/api/submit-read2lead-lesson.js` (no change — first-rarity check happens in shop-buy)
- `functions/api/read2lead-shop-buy.js` (EDIT — set `first_rarity_owned` when first buy of tier)
- `src/lib/monster-avatar.ts` (EDIT — accept tier filter param, apply hue-rotate)
- `src/lib/r2l-particle-overlay.ts` (NEW — render Kenney lightning sprite over a part)
- `src/components/read2lead/v4/FloatingTierBadge.astro` (NEW)
- `src/components/read2lead/v4/FirstRarityToast.astro` (NEW)
- `src/pages/hoc-sinh/hoc-sinh-w1.ts` (EDIT — mount FloatingTierBadge + toast)
- `src/pages/read2lead/leaderboard.astro` (EDIT — color name by highest tier owned)
- `public/audio/kenney/lightning-bolt.mp3` (NEW — download from Kenney Particle Pack if available, else skip audio)
- Tests for: state field migration, first-rarity event, particle overlay positioning

CẤM:
- Sửa scheduler/RP/shop-list logic
- Touch W2 quest/chest modules

### 4.3 Done when

1. First-time rare/epic buy fires `FirstRarityToast` + saves to state.
2. Sử Thi parts visually distinct via hue-rotate + saturate.
3. Lightning bolt overlay on Sử Thi horn/antenna visible without breaking layout.
4. Leaderboard color name per tier (visible row-by-row difference).
5. `FloatingTierBadge` top-right of monster slot showing "✨ Sử Thi" if any epic equipped.
6. Tests ≥6 across 2 files green; full suite green.
7. Branch pushed; logged.

---

## 5. PHASE 3 (Phương decision — DEFER)

**Goal:** Curate ~10 truly exclusive "Huyền Thoại" parts to introduce 4th tier above Sử Thi.

### Options

| Source | License | Effort | Style fit |
|---|---|---|---|
| **Game-icons.net** silhouettes (vương miện, halo, cánh, mặt trời, hoa văn) tinted gold | CC BY 3.0 | 2-3h Codex | Different style intentional → "đẳng cấp khác hẳn" |
| **Commission VN illustrator** 10-20 unique parts | $50-200 | 1-2 tuần | Best fit, fully custom |
| **CraftPix free mythical pack** | check per-pack | 1h | Variable |

Phương decide khi pilot ổn — KHÔNG block Phase 1+2.

---

## 6. Wider product risk (Claude flag)

- **Compete on conversation/visual với Liên Quân = thua** (budget).
- **Win on**: (a) earned-through-learning (kid tự hào "Con mua bằng xu học bài"), (b) parent-pride (phụ huynh thấy con progress), (c) Vietnamese kid context (kid 6-12 không cần battle royale flair).
- **W6 phase 1+2 chỉ cần good-enough**. Đừng polish trước khi shipping core loop (W2 dopamine + W5 lock + W6 phase 1).

---

## 7. Decision gates cho Phương

| Gate | Question | Em đề xuất default |
|---|---|---|
| G1 | Color tokens (slate/blue/purple/gold) OK? | yes, match mobile convention |
| G2 | Ceremony duration 2s/4s/6s OK? | yes (kid 7 tuổi attention span ~2-4s) |
| G3 | Audio stinger reuse Kenney files (no new download)? | yes Phase 1; add lightning bolt Phase 2 |
| G4 | Achievement badge text "Lần đầu sở hữu Sử Thi 💎" OK? | yes — anh customize sau |
| G5 | Leaderboard tier color: subtle (text color) hay flashy (background pill)? | subtle text color Phase 2, flashy defer |

Codex implement defaults; Phương override qua chat.

---

## 8. Integration với W5 v2 (rank-based egg)

W5 v2 spec (separate doc `V4_W5_V2_RANK_EGG_SPEC.md`) ships TRƯỚC W6. W6 phase 1 depends on:
- `state.rank_ladder.tier_index` accessible (already in publicProgressState)
- MonsterBuilder behavior per stage (W5 v2 changes — Phase 1 wait W5 v2 merge first)

→ **Order:** W5 v2 → W6 Phase 1 → W6 Phase 2 → (defer) W6 Phase 3
