# Read2Lead — "Đảo phiêu lưu" redesign · handoff for Claude Code

**Goal:** when a Vietnamese child (5–14) opens Read2Lead, they feel *excited* — "my monster, my adventure, my rank" — instead of looking at a calm navy-and-gold adult dashboard. This is a **visual, layout, motion and tone redesign only. No new features.** Every element and action that exists today must still exist.

Design canvas (source of truth, private until shared): https://claude.ai/artifact/N1EMTXNF5Kv7ixrJL17Ke6
Approved by Phương on 2026-10-19: direction **A · Đảo phiêu lưu** (jungle/island adventure map).

---

## 0. Read this before writing any code

1. **Read2Lead is in MAINTENANCE-ONLY mode** (`.founder-os/products/read2lead/CONTROL.md`, since 2026-10-19, v105 live). Implementing this redesign needs **Phương's explicit go-ahead** and a spec under `_ops/specs/` *before* code. Do not start on an assumption that this zip is that go-ahead.
2. **Protected files — spec required for any change, even visual:**
   `src/pages/read2lead/lesson.astro` (reading + completion flow, holds "Lưu chiến công"), `public/scripts/r2l-recorder.js`, `public/scripts/r2l-mic-check.js`, `public/scripts/read2lead-speaking-check.js`. Restyle these through CSS classes / wrappers; do not change their logic, event wiring or the completion sequence.
3. `node --test` must pass before any push (hard gate). Pushing `main` = production deploy; real kids use it.
4. The live kid app is also served by a Cloudflare **Worker** release (`functions/lib/read2lead/*`, built from a release folder on Phương's machine — see `docs/R2L_WORKER_RELEASE.md`). Confirm which markup the Worker actually serves for each screen before restyling the Astro copy only.
5. Vietnamese UI copy only; English only inside stories. No English error strings shown to kids.

---

## 1. What's in this folder

| Path | What |
|---|---|
| `README.md` | This file — rules, decisions, plan, acceptance checklist |
| `SCREENS.md` | Screen-by-screen spec: layout, every element, copy, states, motion, 390 vs 1280 |
| `PROMPT.md` | A ready-to-paste prompt to start the Claude Code session |
| `screenshots/*.png` | 25 rendered mocks (still / reduce-motion versions) — the visual reference |
| `mocks/*.html` | The same 25 mocks as standalone HTML. Open in a browser to inspect sizes/colours; animations run unless the OS has reduce-motion on |
| `design-system/r2l.css` | The component + motion classes used by every mock (`.btn`, `.card`, `.chip`, `.node`, `.bar`, `.m-bob` …). Port these, don't copy the mock markup verbatim |
| `design-system/tokens.css`, `tokens.json` | Colour, type, radius, shadow, spacing, motion tokens |
| `design-system/fonts/` | Self-hosted Baloo 2 + Nunito woff2 (latin, latin-ext, **vietnamese**) + `fonts.css` (SIL OFL) |
| `assets/minny/*.svg` | **New** flat-vector Minny in 6 poses (face idle/talk/sleep, full idle/listen/cheer). Production-ready, 1–3 KB each. Suggested home: `public/assets/minny/vector/` |
| `assets/monsters-mock/*.png` | Mock-only monster renders composed from the existing Kenney parts to show expressions. **Do not ship** — production uses the child's real avatar from `src/lib/monster-avatar.ts` |
| `assets/ref/*` | Copies of existing repo assets the mocks use (cosmetics, effects, donate QR) — already in `public/assets/…` |

Mocks are fixed-size pictures (390 wide or 1280 wide). Build real responsive layouts from them (see §4).

---

## 2. Decisions already made (don't re-open)

| # | Decision |
|---|---|
| D1 | Direction A "Đảo phiêu lưu": bright sky ground, ink outlines, hard ink shadows, one juicy yellow button per screen, 3-step day shown as a path/map. |
| D2 | Home shows **top-3 for both XP and Kim cương** side by side (as today) — no tabs on home. The full leaderboard page keeps its XP / Kim cương tabs. |
| D3 | Companion picker: the "Con muốn đổi phần nào?" `<select>` becomes a wrap-grid of 12 category buttons + option tiles; ← / → and "2 / 21" counter stay. Same actions, bigger targets. |
| D4 | Reward screen: **"Xong hôm nay"** is the yellow primary, "Đọc thêm truyện" is secondary. |
| D5 | Minny is drawn as **flat vector** (`assets/minny/`) — there is no usable 3D cut-out art. She always appears in a round porthole with a red ring. |
| D6 | Every animation has a still twin (§5). |

---

## 3. Design system (summary — full board: `screenshots/00-design-system.png`)

**Colour** (all text ink unless stated; contrast checked):
| Token | Hex | Use |
|---|---|---|
| ink | `#17324D` | all text, 3px outlines, hard shadows |
| sun | `#FFC83D` | the ONE primary button per screen, progress fill, rank #1 (ink text 8.9:1) |
| sky | `#9BDDFF` | kid page ground |
| leaf | `#237A41` | done steps, success, leaderboard panel (white text 5.3:1) |
| cream | `#FFF8E7` | cards, reading text card, parent-page ground |
| sand | `#FFE7A8` | map panel |
| hill / hill-light | `#4FB868` / `#7BD389` | decoration only, never behind text |
| coral | `#FF7A3D` | finish flag, streak flame; ink text only |
| minny | `#E0362C` | Minny's ring/body only |
| bronze / silver / gold | `#E8A06B` / `#C9D3DE` / `#FFC83D` | rank tiers Đồng / Bạc / Vàng, podium 3/2/1 |

Never white text on sun, sky, coral or hill green. No grey text anywhere — secondary text is ink at weight 700.

**Type:** Baloo 2 800 for headings, buttons, numbers; Nunito 700–900 for everything else. Scale: 46 / 34 / 26 / 22 / 20 (display→H4), body 18, small 16, label 15 (900 weight only). Story English text: Nunito 800, 24–25px phone / 30–32px desktop, line-height 1.5. Numbers in Vietnamese grouping (1.080, 39.444).

**Shape:** 3px ink borders; cards radius 28 (24 flat), buttons 22, chips pill. Primary button: min-height 64 (72 hero), 6px hard ink shadow that collapses to 2px on press. Tap targets ≥ 48px everywhere, primary ≥ 64.

---

## 4. Layout / breakpoints

- **390 (phone, design first):** single column, 16px gutters, sky scene with hills behind the top 430px, primary action inside the first ~700px.
- **768:** two columns — story card + map left, rank progress + top-3 + companion right; 24px gutters.
- **1024:** same as 1280 with a 960 content width and 280px side columns.
- **1280:** 1200 container. Home = 3 columns (monster & greeting 300 | story + map | rank + top-3 300). Reading = picture left, text + actions right. Minny = Minny + question left, big mic right.
- No horizontal scrolling at any width; category chips and option grids wrap.

---

## 5. Motion rules (cheap Android first)

Only `transform` and `opacity` animate. Max 3 moving things per screen; only the halo on the next action loops forever.

| Class (r2l.css) | What | Where | Reduce-motion / still version |
|---|---|---|---|
| `m-bob` | 2.6s ±10px float | monster on home, #1 on leaderboard | static, same pose |
| `m-dance` | 1.1s wiggle-jump, 3 loops then stop | reward, rank-up, last page | static "wow" pose, arms up |
| `m-pop` | 0.6s scale-in once | greeting, reward tiles | appears instantly |
| `m-ring` / `m-halo` | 1.6s glow ring | the one primary button / current map step | thicker static outline |
| `m-burst` + `m-fall` | rays + confetti, 2 cycles | reward, rank-up | rays and confetti drawn in place |
| `m-wave` | audio bars | Minny talking | static bars |
| `m-zz` | floating "z" | Minny resting, empty state | static "z" |
| `m-drift`, `m-tw`, `m-fill` | clouds, sparkles, bar fill | decoration | static |

Implement both `@media (prefers-reduced-motion: reduce)` **and** a `.still` class on the root (the mocks use it). The existing home already has a global reduce-motion rule in `src/styles/read2lead-child-home.css` — keep it.

Sound-ready moments (no sound work in this task; leave hooks): arrival "ding", correct answer "pling", reward "ta-da", rank-up fanfare. Every sound must have a visual twin.

---

## 6. Where the screens live today (verified paths)

| Screen | Files |
|---|---|
| Kid home + logged-out parent page (sign-up, code box) | `src/pages/r2l/start.astro` → `src/components/Read2LeadChildHome.astro`, `src/styles/read2lead-child-home.css`; logged-out `/read2lead/` → `src/pages/read2lead.astro` |
| Reading page-by-page, "Lưu chiến công" | `src/pages/read2lead/lesson.astro` (**protected**), `src/styles/read2lead-story-mission.css` |
| Minny voice story, reward ("Xong hôm nay" / "Đọc thêm truyện"), Minny resting | `src/scripts/read2lead-story-voice.mjs`, `src/lib/read2lead-minny-notes.mjs` (`VOICE_POOL_REST_VI`) |
| Companion | `src/pages/read2lead/companion.astro`, `src/scripts/read2lead-companion.ts`, `src/lib/monster-builder.ts`, `src/lib/monster-avatar.ts`, `src/styles/read2lead-companion.css` |
| Leaderboard | `src/pages/read2lead/leaderboard.astro`; board data `functions/lib/read2lead/learning-stars-board.mjs` |
| Library | `src/scripts/read2lead-book-library.mjs`, `src/styles/read2lead-book-library.css`, `functions/lib/read2lead/book-library.mjs` |
| Shop đổi quà + accessory shop | `src/pages/read2lead/gifts.astro`, `src/pages/read2lead/shop.astro`, `src/lib/gift-ux.ts`, `src/lib/shop-ux.ts`, `src/styles/read2lead-gifts.css` |
| Ranks / rewards / badges | `src/lib/rank-ladder-ui.ts`, `src/lib/r2l-hero.ts`, `functions/api/_read2lead-v2-state.js` |

---

## 7. Placeholders and invented values in the mocks — replace with real data

- Child **"Minh" / "Minhdt"**, 55 💎, rank **Bạc ★★**, **320 / 400 XP**, leaderboard position **#8**, streak **3 ngày** — sample state only. Read rank progress from the real rank ladder (`rank-ladder-ui.ts`); if there is no "XP to next star" today, show the rank chip only (don't invent a rule).
- Leaderboard names and numbers come from Phương's screenshots (real at the time) — bind to live data.
- **Gifts:** names marked `[Tên quà]` and prices 60–900 💎 are invented. Use the admin-entered gifts.
- **Library:** "48 câu chuyện · 6 quyển sách" and Quyển/Bài numbers are invented; titles are real catalogue titles.
- **Story content** in the reading/Minny mocks (page text, questions, "6 trang") is illustrative.
- **New copy I wrote** (Phương should approve before shipping): home bubbles "Hôm nay có truyện mới!" / "Mình đọc tiếp nhé!"; reading feedback "Giỏi lắm!" and, for a wrong pick, "Gần đúng rồi!" + the right answer (check what the live page says first); map labels "Bắt đầu ở đây", "Về đích: nhận kim cương và XP cho cả 3 bước"; empty state "Truyện mới đang trên đường tới!…"; error headline "Trang sách bị gió thổi bay mất rồi!"; rank-up "Sao mới!", "Con lên hạng rồi!…", "Tuyệt vời!"; shop goal button "Đọc truyện kiếm kim cương"; leaderboard bottom "Đọc truyện để leo bảng"; Minny-resting helper "Phần nói với Minny tạm nghỉ. Đọc sách vẫn mở như bình thường." and monster bubble "Mình đọc cùng nhau nhé!". All other copy is the existing wording from the code.
- **Monster expressions** (wave, wow, oops, sleepy) are mock renders. For v1, animate the child's **saved avatar unchanged** (bob/dance/pop). Expression swaps (eyes/mouth per mood) would touch the avatar renderer — treat as optional, ask Phương.

---

## 8. Suggested implementation order (one PR per step, each green on `node --test`)

1. Tokens + self-hosted fonts + `r2l` component classes (no screen changes yet).
2. Kid home (first visit / mid-story / empty states) — biggest emotional win.
3. Reward + rank-up celebration.
4. Library, leaderboard, companion, shop.
5. Reading + Minny voice (**protected — needs spec**; styling only).
6. Parent public page.
7. Minny vector art swap everywhere she appears.

---

## 9. Acceptance checklist (per screen)

- [ ] Every element/action present today still exists (diff against the current screen, not against the mock).
- [ ] Exactly one sun-yellow primary button; its label is an explicit Vietnamese instruction.
- [ ] No English UI strings; no grey text; all text ≥ 16px (labels 15px/900).
- [ ] Tap targets ≥ 48px; primary ≥ 64px.
- [ ] Contrast ≥ 4.5:1 for all text (use the token pairs in §3).
- [ ] No horizontal scroll at 360, 390, 768, 1024, 1280.
- [ ] Reduce-motion ON → no movement, nothing missing; `.still` twin identical.
- [ ] Rendered and screenshotted on the deployed preview, compared side by side with `screenshots/` — **whole screen**, not just widgets.
- [ ] `node --test` passes.
