# Handoff: Read2Lead student home hub (`/r2l/start`)

## Overview
This replaces the current **topic-picker** screen at `src/pages/r2l/start.astro` with a
child's **home hub**: a warm, scannable front door with two primary actions and three
secondary ones, plus the child's own world (rank, streak, coins, pet, current book).
It is the screen a child opens from their magic link most days.

> This is the redesign the founder approved after rejecting attempt 1 (branch
> `claude/r2l-student-home`). Do **not** revive the topic grid or the interests input.

## About the design files
The two files in this bundle are **design references created in HTML/DC**, not production
code to paste in:
- `Read2Lead Home Hub.dc.html` — the hub itself: the `ready` state plus all four other
  states (`resolving`, `generating`, `result`, `error`, `gen-error`). The bottom "Xem thử"
  bar and the demo interactivity are **preview-only** — do not ship them.
- `Responsive Preview.dc.html` — a viewer that shows the hub in phone/tablet/laptop frames.
  Reference only; do not port it.

**Your task:** recreate the hub inside the existing codebase (**Astro 5 + Tailwind + the
`fx-` design system**), reusing the real components and the real data. This is NOT a
greenfield build — almost everything you need already exists in the repo. See "Reuse, don't
rebuild" below. When this document and the HTML disagree on a value, the HTML is the source
of truth for **look**, this README is the source of truth for **wiring**.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and copy are final. Recreate pixel-faithfully
using the `fx-` classes and CSS custom properties already defined in
`src/styles/design-system.css` — **never hardcode hex**. The HTML mock uses those exact
tokens via inline styles; translate each inline style to the matching token / `fx-` class /
Tailwind utility.

---

## Reuse, don't rebuild (this is what keeps it at 100%)

Everything below already exists in the repo — use it, don't reinvent it:

| Need | Already in repo | Notes |
|---|---|---|
| Page shell, phase machine | `src/pages/r2l/start.astro` | Keep the `data-phase` on `<main>` + the `.phase-*` display CSS. Just swap the `ready` block's content. |
| Client logic (token resolve, generate, poll, phase flips) | `src/scripts/r2l-start.client.ts` | Keep as-is; edit only where noted in "Client script changes". |
| Buttons / cards / progress bar | `src/components/ui/Button.astro`, `Card.astro`, `ProgressBar.astro` | Use these, not raw markup. |
| Rank tier → label + colour mapping | `PROFILE_TIERS` in `src/pages/ho-so/ho-so-kid-view.ts` | `[Đồng, Bạc, Vàng, Bạch Kim, Kim Cương, Tinh Anh, Cao Thủ, Thách Đấu]`. Map `rank_ladder.tier_index` → tier. |
| Contextual "continue vs create" decision | `buildHeroCta()` in `ho-so-kid-view.ts` | Returns `{label, action:'lesson'\|'create'\|'wait', href}`. **Reuse this exact function** — it already encodes the rule the founder wants. |
| Pack status (step 0–3, labels) | `statusMeta()` in `ho-so-kid-view.ts` | Use its `step` to derive the book progress %. |
| Pet monster art | `defaultMonsterSvg()` in `ho-so-kid-view.ts` | Same purple monster used in the mock. If `read2lead_state.avatar.monster` exists, render the real one via `renderMonster()` (`src/lib/monster-avatar.ts`) as ho-so does; else fall back to `defaultMonsterSvg()`. |
| Rank medals (SVG) | `public/assets/r2l/ranks/rank-l{0..5}-*.svg` | Map tier → medal: bronze→l1, silver→l2, gold→l3, diamond→l4, legend→l5. |
| Minny (red robot) | `public/assets/minny/minny.png` | SpeakUp tile only. It's a **red robot**, never a koala. |

**Data source:** the page already knows the child's `access_code` after token resolve. Add one
call to `GET /api/read2lead-progress?code=<code>` (same endpoint ho-so uses) and read the same
`ProgressPayload` shape ho-so-kid-view.ts consumes. No new backend work.

---

## The `ready` screen

### Layout
- Centred column, `width: min(1060px, 100%)`, side padding `clamp(16px,4vw,32px)`,
  bottom padding for breathing room.
- **Two columns via `flex-wrap`** (no media queries needed — intrinsic responsive):
  - `aside` (the world) — `flex: 1 1 320px`
  - `main` (the actions) — `flex: 1.7 1 440px`
  - `gap: 18px`, `align-items: stretch`
  - Below ~800px total width the two wrap to **one column** (world on top, actions below).
    On a 390px phone everything is a single stack.

### Column A — "the child's world" (`aside`)
Card: `background: var(--surface-raised)`; `border: 1px solid var(--border-subtle)`;
`border-radius: var(--radius-2xl)` (24px); `padding: clamp(20px,3.5vw,30px)`;
`box-shadow: var(--shadow-card)`. A few absolutely-positioned `★` glyphs twinkle in the
corners (subtle; honor `prefers-reduced-motion`).

Contents, top to bottom:
1. Eyebrow `HỌC SINH READ2LEAD` — `.fx-eyebrow`, colour `var(--gold)`.
2. `<h1>` `Chào con <span id="greeting-name">{name}</span>! 👋` — Manrope 800,
   `font-size: clamp(26px,4.4vw,34px)`, `line-height:1.25`, `text-wrap:balance`.
3. **Pet** — `defaultMonsterSvg()` (or real monster), `width: clamp(150px,42vw,190px)`,
   square, centred, gentle float (`translateY` bob ~4s), soft purple radial glow behind it,
   `drop-shadow`. The **rank medal** SVG overlaps the pet's bottom-right,
   `width: clamp(46px,13vw,58px)`.
4. `Hạng <b>{rank_ladder.label_vi}</b>` — centred, Manrope 700, label in `var(--gold-light)`.
5. **Stat chips** (flex-wrap row, centred, pushed to bottom with `margin-top:auto`):
   - `Cấp <span id="greeting-level">{level}</span>` — gold pill:
     `background: var(--accent-soft)`, `border: 1px solid var(--accent-border)`,
     text `var(--gold-light)`, `border-radius: var(--radius-full)`.
   - `🔥 {streak_days} ngày` — neutral pill (flame gently pulses).
   - `🪙 {coins} xu` — neutral pill.
   - Neutral pill = `background: color-mix(in srgb, var(--navy-950) 55%, transparent)`,
     `border: 1px solid var(--border-subtle)`, text `var(--cream)`, weight 600.

### Column B — the actions (`main`, `flex-direction:column; gap:14px`)

**1. PRIMARY (contextual). Render ONE of these based on `buildHeroCta()`:**

*Continue (when `current_pack` is open and not completed):*
- Card: `background: color-mix(in srgb, var(--gold) 9%, var(--surface-raised))`,
  `border: 1.5px solid var(--accent-border)`, `border-radius: var(--radius-2xl)`,
  `padding: clamp(18px,3vw,24px)`, `box-shadow: var(--shadow-lg)`. This is the **most
  prominent thing on screen** — it must out-weigh everything else.
- Eyebrow `ĐỌC TIẾP` (`var(--gold-light)`).
- Row: a **cover tile** (`aspect-ratio:3/4`, `border-radius: var(--radius-lg)`,
  `background: linear-gradient(140deg,#2f6285,var(--navy-850))`, a thin gold "spine" bar on
  the left, a centred `📖`) + text block: `Con đang đọc dở cuốn` (13px, `--cream-muted`) then
  `{current_pack.story_title}` (Manrope 800, `clamp(19px,3.2vw,24px)`).
- Progress: `<ProgressBar gradient>` (`.fx-progress` + `--gradient` fill) at the derived %,
  with `{pct}%` label in `var(--gold-light)`. Derive % from `statusMeta().step` (0–3) →
  `step/3*100` (see "Data we don't cleanly have").
- Primary CTA: `<a id="continue-link" class="fx-btn fx-btn--primary fx-btn--lg fx-btn--block"
  href="{lesson href from buildHeroCta}">Đọc tiếp 📖</a>`, `border-radius: var(--radius-xl)`.
- Below it, a ghost button `hoặc nhận một cuốn truyện mới ✨` — **this is `#generate-btn`**
  (must be a real `<button>`).

*Create (no open book — `buildHeroCta().action === 'create'`):*
- Same gold-wash card, centred. `📖` glyph, eyebrow `BÀI ĐỌC MỚI`, title
  `Nhận một cuốn truyện mới`, sub `và bắt đầu đọc ngay 🎧`, then the primary block button
  `Tạo bài đọc` — **this is `#generate-btn`** here.

> Only one `#generate-btn` exists in the DOM at a time (whichever variant renders).

**2. PRIMARY — SpeakUp** (`<a id="speak-link" href="/speak-up?code={code}">`):
- Card: `var(--surface-raised)`, `border: 1px solid var(--border-strong)`,
  `border-radius: var(--radius-2xl)`, `padding: 16px clamp(16px,2.6vw,22px)`,
  `box-shadow: var(--shadow-card)`. Hover: `border-color: var(--gold); translateY(-2px)`.
- Left: Minny in a 64px circle — `overflow:hidden; border-radius:50%`,
  `border: 2px solid color-mix(in srgb,#e0533f 60%,transparent)`,
  `box-shadow: 0 0 0 4px color-mix(in srgb,#e0533f 16%,transparent)`; the PNG uses
  `object-fit:cover; object-position:50% 36%` to frame the robot.
- Middle: `SpeakUp` (Manrope 800, `clamp(19px,3vw,23px)`) + `Luyện nói tiếng Anh cùng Minny`
  (14px, `--cream-muted`).
- Right: `→` in `var(--gold)`.

**3. SECONDARY — three tiles** (`display:grid; grid-template-columns:repeat(3,1fr); gap:10px`):
Each tile: `var(--surface-card)`, `border:1px solid var(--border-subtle)`,
`border-radius: var(--radius-xl)`, `min-height:112px`, column-centred, hover border → gold.
Icon in a 44px circle (`background: color-mix(in srgb, var(--gold) 12%, transparent)`).
| id | href | icon | label | sub |
|---|---|---|---|---|
| `#hoso-link` | `/ho-so?code={code}` | 👤 | Hồ sơ | Tiến độ của con |
| (none) | `/read2lead/leaderboard` | 🏆 | Xếp hạng | Thi cùng các bạn |
| `#shop-link` | `/read2lead/shop?code={code}&v3=1` | 🛒 | Cửa hàng | 🪙 {coins} xu |

**Honeypot** (keep exactly): an off-screen `<input id="website" name="website">` wrapped in an
`aria-hidden` container positioned `left:-9999px`.

---

## The other four states
Keep the existing `data-phase` machine and `.phase-*` reveal CSS. Restyle each block to match
the mock; all live in the DOM at once.

- **`resolving`** — centred: gold spinner (`border-top-color: var(--gold)`, spin) +
  `Đang mở bài của con…` (Manrope 700).
- **`generating`** — centred: the pet bobbing, `<h2>Đang chuẩn bị bài đọc cho con…`, a raised
  card with `#gen-progress` (`.fx-progress` gradient fill, animated shimmer), `#stage-label`
  (rotates through the existing `STAGE_LABELS`), `#gen-note`.
- **`result`** — centred, gentle pop-in: `✨`, gold-wash card, `<h2>Bài học của
  <span id="result-name"></span> đã sẵn sàng!`, `Tên truyện: <b id="result-story-title">`
  (wrap in `#result-story`), then `<a id="open-lesson" class="fx-btn fx-btn--primary fx-btn--lg">Mở bài học →</a>`
  and `<button id="reset" class="fx-btn fx-btn--secondary">Tạo bài khác</button>`.
- **`error`** — `😕`, `Không mở được link`, `#error-message`, secondary button `Nhắn Zalo Felix`
  (`href={ZALO_URL}`).
- **`gen-error`** — `🌧️`, `Chưa tạo được bài học`, `#gen-error-message`,
  `<button id="retry" class="fx-btn fx-btn--primary fx-btn--lg">Thử lại</button>`, Zalo note.

---

## Client-script changes (`src/scripts/r2l-start.client.ts`)
Small, additive:
1. After a successful token resolve, also `fetch('/api/read2lead-progress?code=' + accessCode)`
   and populate: greeting name/level (already done), rank medal + label, streak, coins, and the
   current-book block.
2. Delete everything about `tiles` / `topicIndex` / `topicValues` / `topicLabels` and the
   interests input (topic picker is gone). `startGenerate()` should POST with `topic: ''` (server
   ignores it) and no interests.
3. Compute the primary CTA with `buildHeroCta(pack, data, code)` and render continue-vs-create.
   The continue `<a#continue-link>` href = `buildHeroCta().href` (already the lesson link with
   `pack_id`).
4. Keep `#generate-btn` → `startGenerate`, `#reset`/`#retry` → back to ready, the poll loop, and
   the `activateOpenLessonWhenReady()` gate — all unchanged.
5. Fill `#speak-link`, `#hoso-link`, `#shop-link` hrefs with the resolved `code` at runtime (the
   markup ships with real `href` placeholders).

## Data → endpoint field mapping (`/api/read2lead-progress`, `ProgressPayload`)
- name → `progress.student_name`  ·  level → token-resolve `level` (existing)
- rank label → `read2lead_state.rank_ladder.label_vi`  ·  tier index → `rank_ladder.tier_index`
  (→ `PROFILE_TIERS`/medal)
- streak → `read2lead_state.streak_days`  ·  coins → `read2lead_state.coins`
- current book → `progress.current_pack.story_title`, status via `statusMeta(data.state, pack)`,
  `pack_id` = `current_pack.pack_id`
- contextual action → `buildHeroCta(current_pack, data, code)`

## Data we don't cleanly have (decide before building)
- **Exact book progress %.** The endpoint exposes step-state (`statusMeta().step`, 0–3), not a
  percent. The mock shows 60%. Options: (a) map step→%, e.g. `step/3*100`; (b) show a step label
  ("Đang nghe / Làm bài") instead of a bar. Confirm which.
- **Coins & pet on this page.** Both come with the progress payload (`read2lead_state.coins`,
  `read2lead_state.avatar.monster`) so no extra call is needed — but confirm you're happy loading
  the full progress payload on the home page (it's the same one ho-so loads).

## Copy changes from the old page (all intentional — flagged for sign-off)
- **Generating title:** was `Minny đang chuẩn bị bài cho con…` → now `Đang chuẩn bị bài đọc cho
  con…`. Reason: the books are human-written (not AI) and Minny belongs to SpeakUp — she
  shouldn't be credited with preparing the reading. Stage labels unchanged.
- **Result:** dropped the `Chủ đề:` line (topic picker removed).
- **Secondary tile labels** shortened to fit 3-up at 390px: `Hồ sơ – Báo cáo tiến độ` → `Hồ sơ`
  (sub `Tiến độ của con`); `Bảng xếp hạng` → `Xếp hạng` (sub `Thi cùng các bạn`); `Cửa hàng`
  (sub `🪙 {coins} xu`). If you prefer the full labels, widen to 1-col on phone.
- **gen-error** uses `🌧️` + a gentler line. All other approved copy is verbatim.

## Design tokens (all already in `src/styles/design-system.css` — reference, don't redefine)
- Colours: `--navy-950 #10273a`, `--navy-900 #17354a`, `--navy-850 #1d3f58`,
  `--navy-800 #244a64`, `--gold #c88f38` (`--accent`), `--gold-light #f2cc7e`,
  `--cream #f5e6c8`, `--cream-muted #d9c7a4`, `--cream-dim #aa9673`. Rank:
  `--rank-bronze/silver/gold/diamond/legend`. Minny red ring uses `#e0533f` (from her art).
- Radius: `--radius-lg 12px` (cover), `--radius-xl 16px` (tiles/buttons), `--radius-2xl 24px`
  (panels), `--radius-full`.
- Shadow: `--shadow-card`, `--shadow-lg`. Motion: `--duration-base 250ms`, `--ease-standard`.
- Type: `--font-display` Manrope (700/800 headings), `--font-sans` Inter (body/UI).

## Accessibility
Real `<button>`/`<a>` semantics (no div-buttons). Tap targets ≥ 44px (tiles are 112px tall,
CTAs are `--lg`). Keep the 2px `--gold-light` focus ring. Honor `prefers-reduced-motion`
(disable the bob/twinkle/flame/shimmer). Vietnamese strings must not clip at 390px — headings
use `text-wrap:balance`, book title wraps to 2 lines.

## Reference implementation (start here — copy, don't reinterpret)
`reference_implementation/` contains production-shaped code that already matches the mock.
**Adapt these instead of rebuilding from the prose** — it's the fastest path to 100% fidelity:
- `start.astro` — drop-in replacement for `src/pages/r2l/start.astro`. Real `fx-` components,
  a scoped `<style>` using the design-system CSS vars, the phase machine, all wired IDs, and
  both continue/create CTA blocks. Fix the import paths to your tree; confirm the honeypot and
  `BaseLayout`/`Header`/`Footer` match your current usage.
- `r2l-start.client.ts` — adapt from / replace `src/scripts/r2l-start.client.ts`. Adds the
  `/api/read2lead-progress` fetch + world render + contextual CTA; keeps your generate/poll flow.
  It ships trimmed copies of `buildHeroCta`/`statusMeta`/tier map — **prefer extracting the
  canonical versions from `ho-so-kid-view.ts` into a shared module and importing them.**

One thing to reconcile: the mock keeps a single `#generate-btn`; the reference `start.astro`
renders both CTA blocks and uses `#generate-btn` (continue's ghost) + `#generate-btn-create`
(create's primary). Either consolidate to one `#generate-btn` that you move between blocks, or
keep both as the client script does. The brief only requires that a real `<button>` with id
`#generate-btn` exists whenever the create action is reachable.

## Screenshots (`screenshots/`)
`01` ready (desktop, 2-column) · `02` generating · `03` result · `04` error ·
`05` gen-error · `06` resolving. The phone/1-column layout is the same `ready` markup reflowed
(see `Responsive Preview.dc.html`).

## Files in this bundle
- `README.md` — this document (self-sufficient).
- `reference_implementation/start.astro` + `r2l-start.client.ts` — production-shaped code.
- `screenshots/01..06-state.png` — each state, captured from the design.
- `Read2Lead Home Hub.dc.html` — the interactive design (all states). Open in a browser.
- `Responsive Preview.dc.html` — phone/tablet/laptop viewer (reference only).
