# V3 PHASE C2 — Monster Avatar (build-a-monster, ClassDojo-style, CC0) · SPEC

**Author:** Claude (tech commander) · **Date:** 2026-06-10 · **Executor:** Cursor
**Repo:** felixbuilderhub · **Branch:** `v3-avatar` (off `v3`, after `v3-harden` merges — both touch `hoc-sinh`)
**Flag:** gated behind `isV3Enabled()`. Off in prod until launch.

> **Why:** The shop sells cosmetics but there's no avatar to wear them — the loop is meaningless without this. This adds a "build your own monster" avatar (ClassDojo-style) that the cosmetics sit on. Uses **Kenney Monster Builder Pack (CC0 — free, commercial OK, no attribution required)** → no artist, no IP risk, and **no new npm dependency** (just PNG sprites + CSS + our own compositor).
>
> **Legal:** We do NOT copy ClassDojo's art. We build the same *experience* from CC0 parts.

---

## 0. Assets (Phương drops them; Cursor builds around them)
- **Phương (simple):** download the **Kenney Monster Builder Pack** (https://kenney-assets.itch.io/monster-builder-pack), extract **everything into ONE folder** `public/assets/monsters/raw/` — no sorting needed. Add `public/assets/monsters/CREDITS.txt` = "Monster art: Kenney.nl — CC0".
- **Cursor auto-sorts:** scan `public/assets/monsters/raw/`, **auto-categorize each PNG by its filename** (Kenney names parts with prefixes like `body_*`, `eye_*`/`eyes_*`, `mouth_*`, `arm_*`/`leg_*`, `detail_*`/`antenna_*`/`horn_*`; map anything unclear to `detail`). Generate the manifest `src/data/monster-parts.json` = `{ "body":[{id,file}], "eyes":[...], "mouth":[...], "arms":[...], "detail":[...] }` referencing files in `raw/` directly (no need to move them). **Report the category counts** (e.g. "body: 12, eyes: 9, …") so Phương/Claude can sanity-check the mapping; any miscategorized part is a one-line manifest fix. The whole system is **manifest-driven** so it works with whatever parts exist.
- **Unblock rule:** if the pack isn't present yet, build against the manifest and render a **CSS fallback** (a colored rounded blob + simple CSS eyes/mouth) so the system + tests work without the assets; it auto-upgrades to the Kenney PNGs once they're in the folder.

---

## 1. State (additive — `functions/api/_read2lead-v2-state.js`)
- Flip `avatar.enabled = true`.
- Add `avatar.monster = { body, color, eyes, mouth, arms, detail }`:
  - each part field = a part `id` from the manifest (string); `color` = a palette key (e.g. `'mint' | 'coral' | 'sky' | 'lemon' | 'grape'` mapped to a hex/tint).
  - **Default** = deterministic from the access code (hash → pick a part per slot + a color) so every kid starts with a unique monster they can then customize.
- `normalizeAvatarMonster(raw, manifest)`: keep valid ids, else fall back to the default; **old records (no `avatar.monster`) → default monster, never crash.**
- Include `avatar` (with `monster`) in `publicProgressState`. Additive only — do not touch level/XP/coins/rank.
- Tests: default is deterministic per code; invalid ids clamp; old record → default, no crash.

## 2. Compositor (`src/lib/monster-avatar.ts`)
`renderMonster(container, config, opts)` builds a layered avatar:
- **Z-order (back→front):** body → arms → detail → eyes → mouth.
- **Body color:** if the pack's bodies are white/grayscale → apply CSS `filter`/tint by `config.color`; if they're pre-colored → pick the colored file. Support both; document which the pack gave.
- **Cosmetics layer** (when `opts.withCosmetics`): `frame` = CSS class on the container ring; `hat` = absolute top-center overlay; `pet` = absolute bottom-right (smaller); `name` rendered in `opts.nameColorClass`. Cosmetic hat/pet art = the shop emoji for now (OpenMoji SVG is a later drop-in via the existing `css_class` hooks).
- **"Fake-3D" depth:** `filter: drop-shadow(...)` + an idle `@keyframes r2l-monster-float` bob + slight hover tilt. **Respect `prefers-reduced-motion`** (no animation).
- **Performance:** only load the part images actually used (selected parts + the options currently being browsed) — never preload all 170 sprites. Avatar assets load on the profile, NOT in the lesson bundle.

## 3. Customizer UI — profile `src/pages/hoc-sinh/index.astro` (+ `src/components/read2lead/v3/avatar/MonsterBuilder.astro`), gated
- "Tạo quái của con": one row per slot (Thân / Mắt / Miệng / Tay / Màu / Chi tiết) with prev/next arrows (or a small option strip) → **live preview** updates instantly → **Lưu**.
- Below/around it: the owned shop cosmetics with equip/unequip (reuse the Phase C equip API) so kids dress the monster.
- **Save endpoint:** add `action:'avatar'` to `functions/api/read2lead-shop.js` (or a new `read2lead-avatar.js`): POST `{ access_code, monster:{...} }` → validate ids against the manifest → save `state.avatar.monster`. Rate-limited via `_rate-limit.js`. Consistent `{ok,...}` JSON.

## 4. Display
- **Profile:** big monster (~180px) wearing equipped cosmetics + name in name-color.
- **Lesson header + leaderboard:** small monster (~44px, base + frame + hat only, no pet) for identity.
- All gated `isV3Enabled()`. Flag off in prod → live unaffected.

## 5. Deploy
`v3-avatar` off `v3` → tests green (`node --test`) + `astro check` no new errors → push → merge to `v3`. **Do NOT merge to `main`, do NOT flip the flag.** HOLD for Phương feel-review (`?v3=1`) + Claude review before launch.

## 6. Phương decisions (defaults set; tune on preview)
- How many options per slot (depends on the pack); the 5-color default palette; avatar sizes; whether to add a "random monster" 🎲 button.

## 7. 5× AUDIT
1. **Correctness:** additive state, manifest-driven, graceful CSS fallback, gated → no live-data/regression risk. ✓
2. **Engagement/pedagogy:** a personal monster = the core identity hook (ClassDojo/Roblox); finally makes the coin→shop→cosmetic loop pay off. ✓
3. **Kid/parent UX:** 2D PNG + CSS = light on cheap Android/3G; build-a-monster is intuitive and fun; reduced-motion respected. ✓
4. **Risk:** sprite weight → mitigated by on-demand part loading (never all 170), profile-only (not lesson bundle), and PNG size sanity. No new npm dep. ✓
5. **Maintainability:** manifest + compositor + one component + one endpoint action; isolated, revertible; replaces the dropped DiceBear plan with something lighter. ✓
**Refinement folded in:** on-demand part loading (don't preload the whole pack) to keep the profile fast.
