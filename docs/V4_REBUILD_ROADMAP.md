# READ2LEAD V4 — REBUILD ROADMAP · Master doc for Cursor

**Author:** Claude (tech commander) · **Date:** 2026-06-10 · **Executor:** Cursor (multi-agent)
**Supersedes nothing** — extends `V3_ROADMAP.md`. Deploy rails, AGENTS.md, KV-additive rule all still apply.
**Status:** Spec'd, 5-lens audited. Waves open as Phương green-lights them.

> **What V4 is:** V3 built the gamification skeleton (rank ladder, shop v1, monster avatar v1, juice v1, games shell — on `main`, flag-off). V4 makes the loop actually *compelling*: a Liên Quân-grade dopamine loop, a coherent avatar+shop economy with 350+ unlockables, kid-first UI, and (last) a personalization layer. **We are NOT rewriting the V2 lesson engine, the backend pipeline, or the KV state core — they work.** We rebuild what's weak.

> **Priority signal (Phương, locked 2026-06-05):** kids respond to gamification, NOT personalization. Parents don't care much about personalization either. → Dopamine/avatar/shop waves come FIRST; personalization (W7) is last deliberately. Do not reorder.

---

## 0. Current state — what inspection found (2026-06-10)

### Per Phương's 6 areas

| # | Area | What exists | What's weak |
|---|---|---|---|
| 1 | **Personalization** | Prompt gets name/age/level/gender/interests/topic (`prompt_v2.py`). 5 levels by NGSL vocab scope. | No memory of past packs, no vocab recycling/spaced repetition (Phase A.2 unbuilt), no Minny memory (M1 unbuilt). Story = one-shot generation. |
| 2 | **Gamification** | Rank ladder Đồng→Thách Đấu (8 tiers × 3 div × 3 sao, RP 1–2/pack) in `_read2lead-v2-state.js`. Coins, XP, levels L1–L5, streak + freeze, 6 badges, leaderboard. | Economy is shallow: earn ~15–20 xu/pack but only 8 emoji items to buy. No quests, no chests, no daily hook, no combo. Coins pile up with nothing to want. |
| 3 | **Profile/login** | `/hoc-sinh` access-code login, KV `progress:<code>`, session bar, admin `/admin/codes`. | Code entry is the only path (typing `R2L-...` is hard for 6yo). Profile is a long text-dense scroll; kid content and parent content interleaved. |
| 4 | **UI/UX** | V2 lesson works on cheap Android/iPad. Big touch targets in activities. | Whole site uses the adult navy-950/cream brand theme — not a kid product's look. `lesson.astro` = 3,742-line god file (HTML+CSS+JS inline) — every change risks regressions. Dense Vietnamese instruction text everywhere; weak for pre-readers. `window.confirm()` for purchases. |
| 5 | **Dopamine loop** | canvas-confetti on pass/rank-up, 4 synth tones, RewardBurst, streak. | Rewards are flat & predictable: same 15–20 xu every pack. No variable reward, no near-miss ("còn 1 sao nữa!"), no combo, no daily chest, no opening-a-prize moment. The loop ends at the lesson — nothing pulls the kid back tomorrow except streak. |
| 6 | **Avatar/shop** | Kenney Monster Builder (CC0, 367 parts, manifest-driven compositor `monster-avatar.ts`), deterministic default per code. | **Three art systems collide:** Kenney PNG parts + emoji hats/pets floated on top + CSS box-shadow frames = the "lộn xộn" look. Body color via `hue-rotate` filter (muddy). All 367 parts free from day 1 → nothing to unlock. Shop sells 8 emoji items disconnected from the monster. |

### Key files (ownership zones inherit from V3 §3)

| File | Lines | Role |
|---|---|---|
| `src/pages/read2lead/lesson.astro` | 3,742 | God file: 5 activities + retell + bonus + submit + juice hooks |
| `functions/api/_read2lead-v2-state.js` | ~830 | State core: XP/coins/rank/streak/shop/avatar (PURE functions — keep) |
| `functions/api/submit-read2lead-lesson.js` | ~480 | Award path |
| `src/lib/monster-avatar.ts` + `monster-builder.ts` | ~650 | Avatar compositor + customizer |
| `src/pages/hoc-sinh/index.astro` | ~1,050 | Profile dashboard |
| `src/pages/read2lead/shop.astro` / `games.astro` / `leaderboard.astro` | small | V3 surfaces |

---

## 1. Hard rules (unchanged from V3 — re-read before any wave)

1. **Live students.** Feature work on `v4/<wave>` branches off `v3`-style integration; flag-gate ALL new UI behind `isV3Enabled()` (same flag — no second flag). Hotfix exception per V3 §2.
2. **KV state is additive-only.** New fields defaulted; old records never crash; never rename/remove.
3. **No real-money anywhere.** Coins are earned by learning only. Chest odds transparent (show "Hộp này chứa 10–30 xu"). This is a children's product: variable reward = fun surprise, never gambling pressure. No countdown timers that punish, no pay-to-skip, **no rank demotion** (RP never decreases — already true, keep it).
4. **Bundle discipline.** Audience = cheap Android / iPad Safari / 3G. Lazy-load everything heavy; lesson bundle gets NOTHING new except via dynamic import.
5. **Economy numbers (prices, RP, drop rates) are Phương+Claude decisions** — Cursor implements the constants file, never invents values.
6. **Tests green before commit** (`node --test tests/*.test.mjs` hub; `pytest tests/ -q` backend). New logic = new tests.
7. **One file, one owner at a time.** Zones below.

---

## 2. Wave plan — dependency order

```
W0 (done/almost): V3 launch + hardening H1–H4
W1: Kid design system (theme tokens)          ──┐
W2: Dopamine loop core (quests/chests/combo)    ├─ parallel after W0
W3: Avatar 2.0 (one art system + part unlocks) ──┘
W4: Shop 2.0 + economy        (needs W3 manifest + W2 chest plumbing)
W5: Mini-games v1 (kaplay)    (needs W4 spend API; vocab endpoint)
W6: Profile 2.0 + login UX    (needs W1 tokens; benefits from W3 avatar)
WR: lesson.astro refactor     (independent staged track — see §10)
W7: Personalization layer     (backend-heavy; LAST by design)
W8: D1 data layer             (when leaderboard/profile scale hurts)
```

---

## 3. W1 — Lesson experience + game shell + kid/parent split (EXPANDED per Phương 2026-06-10)

**Scope locked 2026-06-10 — replaces the original W1.** Voice-instruction buttons DROPPED (Phương). Parent/kid split + entry hook pulled forward from W6 into W1. Difficulty-by-rank pulled in from the personalization pile (it's progression, not personalization).

Three parallel Cursor agents, full specs written + 5-lens audited:

| Spec | Agent zone | Covers |
|---|---|---|
| `docs/W1_SPEC_A_LESSON_FLOW.md` | `lesson.astro` + backend dial | Read+listen gate before questions; story panel always reachable; anti-guess (2-attempt → reveal + explanation, per-question outcomes scoring); difficulty dial C1–C4 by rank_points (backend prompt, mix-safe) |
| `docs/W1_SPEC_B_GAME_SHELL.md` | new design-system files + small pages | `isW1Enabled` flag, kid theme tokens, Baloo 2, KidButton/HudBar/QuestPath/KidModal/etc. (frozen contract §2), shop/games/leaderboard reskin, Header kidMode |
| `docs/W1_SPEC_C_KID_HUB_PARENT.md` | `hoc-sinh/*` + new `/phu-huynh` | Entry hook (monster pop-in + greeting + ONE hero CTA + mission strip, <2s); parent dashboard split to `/phu-huynh` (read-only, Zalo-friendly, no PII in meta) |

Flag: new `PUBLIC_R2L_W1` (separate from V3 flag). Branches `v4/a-lesson-flow`, `v4/b-game-shell`, `v4/c-kid-hub` off `v3`. B's contract commit lands first; A/C build against the documented contract in parallel.

**Done when:** all three specs' done-when pass on preview; W1 off = legacy byte-identical everywhere.

## 4. W2 — Dopamine loop core (zones: Z2 state-core + Z5 lesson hooks)

**Goal:** the Liên Quân loop — every action gives feedback, every session ends with a prize, every day has a reason to return.

State core (additive fields on `progress:<code>`):
- `daily_quests`: 3 per day, deterministic from date+code (e.g. "Xong 1 bài", "Đúng 80%+", "Làm phần Nói lại"). Each → xu + RP bonus. Reset by VN date key (reuse `vietnamDateKey`).
- `chests`: server-side RNG award after each passed pack: common (10–20 xu) / rare (25–40 xu + part unlock) / epic (50 xu + rare part). Odds in one constants block, server-only. `pending_chest` field → opened from result screen. **Duplicate part drop → auto-convert to xu** (never a dead prize).
- `daily_login_chest`: small, claimable once/day from profile.
- `combo`: client-side only (in-activity correct streak ×2/×3 visual; max +5 xu bonus/pack server-capped — combo must never make failing kids earn dramatically less).

Lesson/result hooks (via existing `window.__r2lJuice` — do NOT inline new code in lesson.astro):
- Per-correct-answer: XP ticker float (+4 XP), combo counter, coin clink (Howler).
- Result screen: **chest-opening moment** (CSS 3-stage: shake → crack → burst + confetti + reveal). This is THE dopamine peak — spec'd in detail before build.
- Near-miss banners: "Còn 1 sao nữa là lên **Bạc II**!" (data already in `computeRankLadder` — `stars_to_next`).
- Sound design: adopt **Howler.js** (~7KB) now + **Kenney audio packs** (CC0): `kenney.nl/assets/interface-sounds`, `kenney.nl/assets/casino-audio` (chest/coins). ~8 files, total <200KB, lazy-loaded after first interaction, mute toggle persisted.

**Done when:** quest card on profile + lesson; chest opens on result screen; combo visible in activities; all state additive + tested; old records unaffected.

**Decision gate:** quest list (Claude drafts 8, Phương picks 3 rotating), chest odds + amounts, combo cap.

## 5. W3 — Avatar 2.0 (zone: monster-* + avatar component + manifest)

**Goal:** ONE coherent art system; the 367 Kenney parts become the unlock economy.

- **Kill emoji cosmetics.** Hats/pets/frames re-cut as sprite overlays: Kenney CC0 packs have hat/accessory sprites (`kenney.nl/assets` — Generic Items, Platformer Pack extras); pets = small Kenney monster bodies rendered mini. Manifest gains `hat`/`pet` slots with per-body anchor offsets (`{x,y,scale}` in `monster-parts.json`). Frames stay CSS but redesigned to match (thick cartoon ring, not box-shadow).
- **Kill hue-rotate.** Kenney bodies ship in 6 baked colors (blue/dark/green/red/white/yellow — verified in manifest): "color" choice = swap to the matching color variant file (manifest groups variants by shape: `{shape:'A', colors:{blue:'body_blueA.png', …}}`). White bodies = the tintable fallback for any extra palette hue.
- **Part rarity + locks** (THE shop fix, zero new art): each manifest part gets `rarity: starter|common|rare|epic`. ~20 starter parts free; the rest unlock via shop purchase or chest drops. `state.unlocked_parts: string[]` (additive). `normalizeAvatarMonster` clamps equipped-but-locked → starter.
- Builder UI: locked parts show as silhouette + price/chest hint → tap → buy inline (W4 API) → equip instantly. The "I want that one" moment.
- **Done when:** no emoji/hue-rotate in any avatar render; locked-part flow works end-to-end; old `avatar.monster` records render identically (their parts auto-grandfathered into `unlocked_parts`).

**Decision gate:** rarity split of the 367 parts (Claude proposes by visual distinctiveness, Phương adjusts), which Kenney pack for hats/pets.

## 6. W4 — Shop 2.0 + economy (zone: shop.astro + read2lead-shop.js)

- Catalog = monster parts (from W3) + cosmetics + **consumables**: `streak_freeze` (đã có engine), `xp_boost_x2` (next pack), `game_ticket` (W5). Consumables stack in inventory with counts.
- **Daily featured**: 3 items/day deterministic (date hash), small discount → daily check-in reason that isn't a nag.
- **Preview-before-buy:** tapping any item renders YOUR monster wearing it (compositor already supports candidate equip — pass override).
- Price ladder so there's always a goal: 30 (1–2 packs) / 80 / 200 / 500 (save-up dream item). Constants file `src/data/r2l-economy.json` — single source for prices/odds/quest rewards, mirrored server-side.
- Seasonal/limited flag on items (Tết hat etc.) — schema now, content later (replaces blocked W12).
- Keep H1 double-charge lock; extend tests.
- **Done when:** a kid earning ~40 xu/session always sees ≥1 affordable item + ≥1 save-up item; preview works; consumables consume.

**Decision gate:** full price table + featured rotation size (Phương).

## 7. W5 — Mini-games v1 (zone: games.astro + new endpoint)

- Unblock the TODO: endpoint `read2lead-vocab.js` → recent words from `pack_history` pack IDs (read pack JSON from KV, extract story vocab; cap 50 words). Rate-limited, code-auth like shop.
- Game 1 "Nghe & Chạm" with **kaplay** (lazy-loaded ONLY on `/read2lead/games`): hear word (existing per-sentence TTS URLs or word-TTS batch) → tap correct option, 5 rounds, 5 xu/lượt via `game_ticket` or coins; reward small xu on 4/5+.
- **Done when:** playable on cheap Android; bundle isolated; spend/reward tested.

**Decision gate:** Phương picks game 1 reward size; later games (D phase ideas list, build-don't-clone rule stands).

## 8. W6 — Profile 2.0 + login (zone: hoc-sinh/*)

- **Kid-first layout:** top = avatar hero (large monster + rank badge + name), giant "Học tiếp 🚀" CTA, quest card, chest-to-claim. Below the fold: portfolio, growth, badges. Parent stuff (weekly growth detail, notes) moves into a collapsed "Dành cho ba mẹ" section.
- **Login for 6-year-olds:** keep code entry, add (a) localStorage remember (exists — extend TTL + "Đổi bạn học" switcher for siblings), (b) **QR login**: `/admin/codes` prints a QR card per student (npm `qrcode`, admin-side only) → camera scan → `/hoc-sinh?code=...` auto-login. No-tech parents tape it to the desk.
- Leaderboard moves into profile as a tab (friendly: top 5 + "vị trí của con", no shaming bottom).
- **Done when:** kid reaches "Học tiếp" in ≤2 taps from QR; parent finds weekly report in ≤2 taps; old links keep working.

## 9. W7 — Personalization layer (backend; LAST on purpose)

Per the locked priority signal: build only after the loop retains kids.
- **A.2 vocab recycling:** `pack_history` → last-3-packs key vocab → prompt "recycle 5 of these naturally" (spaced repetition). Backend `prompt_v2.py` + hub passes vocab list in generate call. Needs Claude spec (Z1 zone).
- **Minny M1 memory ingest** per `MINNY_M0_DESIGN_OUTCOME.md` §6 → one personal line on `/hoc-sinh` + lesson greeting.
- **Pronunciation upgrade pilot:** Azure Pronunciation Assessment (paid, per-assess) behind a flag for 2–3 test codes; compare vs Whisper fuzzy match before any rollout.
- **Immersive Reader pilot (F0 free):** tap-word in StoryDock → picture dictionary + VN translation. Evaluate on 2 devices before adopting.
- Adaptive difficulty: defer. Level pacing via XP already exists; revisit with real pilot data.

## 10. WR — `lesson.astro` refactor (staged, independent track)

The 3,742-line god file is the biggest engineering risk, but it's LIVE and works. Rules:
- **Mechanical extraction only, zero behavior change**, one slice per PR: (1) inline CSS → module files, (2) each activity's JS → `src/scripts/r2l-lesson/<activity>.ts` imported by the page, (3) shared state/juice glue last. After each slice: full manual QA on preview (all 5 activities + retell + bonus + submit + Whisper) + tests.
- Never combined with a feature wave in the same PR. W2 hooks go through `window.__r2lJuice` precisely so they don't depend on this refactor.
- **Done when:** lesson.astro < 600 lines of layout; behavior byte-identical; 103+ tests green.

## 11. W8 — D1 data layer (defer until it hurts)

KV O(N) leaderboard scan is cached (BL-2); fine at ≤100 students. At pilot scale-up: D1 table mirroring `progress` summaries (additive sync — KV stays source of truth), leaderboard + admin analytics query D1. High effort; do NOT start before W2–W6 ship.

---

## 12. Third-party — final picks (delta vs V3 §4b)

| Lib/asset | Decision | Wave | Note |
|---|---|---|---|
| canvas-confetti | ✅ in use | W2 | keep |
| **Howler.js** (~7KB) | **ADOPT (was defer)** | W2 | sound design now real: chest/combo/coin. Lazy after first tap. |
| **Kenney audio packs** (CC0) | **ADOPT** | W2 | interface-sounds + casino-audio; ~8 files |
| **Kenney sprite packs** (CC0) | **ADOPT** | W3 | hats/pets/accessories — same art family as monsters |
| **Baloo 2** font (OFL) | **ADOPT** | W1 | Vietnamese-complete kid display font |
| **qrcode** (npm, admin only) | **ADOPT** | W6 | QR login cards; never in kid bundle |
| kaplay | ✅ planned | W5 | lazy, games page only |
| Motion One | optional | W1/W2 | only if CSS keyframes fall short |
| Rive / Lottie Minny | defer | — | still asset-gated (needs animator) |
| DiceBear | ❌ skip | — | Kenney system is our identity |
| Azure Pronunciation / Immersive Reader | pilot | W7 | paid/F0 — small pilot first |
| D1 | plan | W8 | after waves ship |
| emoji sprite sets (OpenMoji/Twemoji) | ❌ drop | — | mixing art systems is what broke the avatar; CC0 sprites only |

## 13. Decision gates summary (Phương → Claude spec → Cursor)

| Gate | Blocks | What Phương decides |
|---|---|---|
| G1 palette + VI voice clips | W1 | pick 1 of 2 palettes; record vs TTS |
| G2 quest list + chest odds + combo cap | W2 | approve numbers table |
| G3 part rarity split + hat/pet pack | W3 | approve Claude's proposal |
| G4 price table | W4 | approve economy JSON |
| G5 game 1 rewards | W5 | approve |
| G6 pronunciation/reader pilot budget | W7 | yes/no + budget cap |

Each gate = Claude writes the wave spec (5-lens audited) → zone opens for Cursor.

## 14. What NOT to do (inherits V3 + new)

- Do NOT rewrite the V2 lesson engine, backend pipeline, or state-core architecture.
- Do NOT mix art systems (no emoji on the monster, ever again).
- Do NOT add real-money purchases, rank demotion, or hidden odds.
- Do NOT touch `lesson.astro` in feature waves (juice goes through `__r2lJuice`).
- Do NOT invent economy numbers — constants come from approved `r2l-economy.json`.
- Do NOT add npm deps outside §12 without a Claude-spec'd justification.

## 15. Change log
- 2026-06-10: Created from full-codebase inspection (6 areas). 5-lens audited.
