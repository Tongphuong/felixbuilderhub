# W1 SPEC B — GAME SHELL & DESIGN SYSTEM · Cursor Agent B

**Author:** Claude (tech commander) · **Date:** 2026-06-10 · **v1.1** (EdTech-UX audit passed — contract §2 CONFIRMED FROZEN, no changes; A & C gained scope, B unchanged) · **Executor:** Cursor Agent B
**Branch:** `v4/b-game-shell` off `v3` → PR into `v3`. Never `main`.
**Role:** You define the kid design system every other W1 agent consumes. **Land your §2 contract commit FIRST (flags + tokens + component shells), push early** so A and C integrate against real code.

**Files you own (EXCLUSIVE):**
- `src/config/flags.ts` (add `isW1Enabled`)
- `src/styles/r2l-kid.css` (NEW)
- `src/components/read2lead/v4/*` (NEW — all components below)
- `src/pages/read2lead/shop.astro`, `games.astro`, `leaderboard.astro` (reskin markup/classes ONLY — zero logic change)
- `src/components/Header.astro` (additive `kidMode` prop)
- `package.json` (one dep: `@fontsource-variable/baloo-2`)

**Files you must NOT touch:** `lesson.astro` (Agent A), `hoc-sinh/*` + parent page (Agent C), `functions/api/*`, `_read2lead-v2-state.js`.

---

## 1. Goal (Phương, 2026-06-10)

Read2Lead phải có **feeling chơi game nhưng cốt lõi là học** — một "Liên Quân của việc đọc". Marketing pages (index, coaching, msmw) giữ nguyên brand navy. Kid pages opt in qua class.

## 2. THE CONTRACT — frozen API for Agents A & C (do not rename anything here)

### 2.1 Flag (`src/config/flags.ts`) — additive, mirror of `isV3Enabled`
```ts
export function isW1Enabled(): boolean {
  if (import.meta.env.PUBLIC_R2L_W1 === '1') return true;
  if (typeof window !== 'undefined') {
    return new URLSearchParams(window.location.search).get('w1') === '1';
  }
  return false;
}
```
Cloudflare env: production `PUBLIC_R2L_W1=0`, preview `=1`.

### 2.2 Theme tokens (`src/styles/r2l-kid.css`) — scoped under `.r2l-kid`
```css
.r2l-kid {
  --r2l-bg: #eaf6ff;          /* sky day */
  --r2l-bg-deep: #d6ecff;
  --r2l-surface: #ffffff;
  --r2l-ink: #1e2a4a;          /* readable navy text */
  --r2l-ink-soft: #5a6a8c;
  --r2l-accent: #ff6b57;       /* coral CTA */
  --r2l-accent-ink: #ffffff;
  --r2l-sun: #ffc83d;          /* coins, stars, XP */
  --r2l-mint: #34d399;         /* correct, success */
  --r2l-sky: #38bdf8;          /* info, listen */
  --r2l-grape: #a78bfa;        /* rank, epic */
  --r2l-danger: #f87171;       /* wrong (soft, never harsh) */
  --r2l-radius: 20px;
  --r2l-radius-sm: 12px;
  --r2l-shadow: 0 4px 0 rgb(30 42 74 / 0.15);        /* chunky cartoon drop */
  --r2l-shadow-press: 0 1px 0 rgb(30 42 74 / 0.15);  /* pressed state */
  --r2l-font-display: 'Baloo 2 Variable', system-ui, sans-serif;
}
```
Usage rule: kid pages set `class="r2l-kid"` on `<main>` (gated: only when `isW1Enabled()`, else legacy classes). All v4 components style exclusively from these vars.

### 2.3 Components (`src/components/read2lead/v4/`) — exact names + API

| Component | Props / markup contract | Behavior |
|---|---|---|
| `KidButton.astro` | `variant: 'primary'\|'ghost'\|'danger'`, `size: 'md'\|'lg'`, `id`, `class` passthrough; slot = label | min-height 48/56px, Baloo 2 700, chunky shadow, `:active` translate-down + `--r2l-shadow-press` (the "squash"), `disabled` = 50% + no shadow |
| `KidCard.astro` | `class` passthrough; slot | surface, radius, shadow, 16-20px padding |
| `CoinPill.astro` | `id` for the number span; renders `🪙 <span>` | gold pill; exposes `data-r2l-coin-value` span for JS updates |
| `XpBar.astro` | `value`, `max`, `label?` | rounded track + fill (width %, `transition: width .6s cubic-bezier(.34,1.56,.64,1)` — overshoot pop); `data-r2l-xp-fill` on the fill div |
| `HudBar.astro` | slots: `avatar`, `left`, `right`; emits fixed markup hooks `data-r2l-hud-story` (empty button mount A fills), `data-r2l-hud-coins`, `data-r2l-hud-xp` | sticky top bar, surface blur, holds avatar chip + coin pill + xp bar + story button. Pure layout — NO data fetching |
| `KidModal.astro` + `src/scripts/r2l-kid-modal.ts` | `kidConfirm({title, body, okText, cancelText}): Promise<boolean>`; `kidAlert({title, body})` | replaces every `window.confirm/alert` on kid pages; big buttons, backdrop tap = cancel, focus-trapped, Esc closes |
| `QuestPath.astro` | server-renders an empty `<ol data-r2l-quest-path>`; companion `src/scripts/r2l-quest-path.ts` exports `renderQuestPath(el, nodes)` with `nodes: [{icon, label, state: 'done'\|'current'\|'locked'}]` and click→`onSelect(i)` | horizontal path with connector line; done=✅ mint, current=pulsing ring, locked=🔒 gray. Replaces lesson dots + reusable on hub |
| `KidToast.astro` + script export `kidToast(msg)` | single mount per page | bottom toast, auto-dismiss 2.5s, queue of 1 (drop older) |

Scripts are plain TS modules (no framework). All animation respects `prefers-reduced-motion` (reduce → no pulse/squash, instant transitions).

### 2.4 Font
`npm i @fontsource-variable/baloo-2`. Import ONLY in kid-page layouts/pages (never marketing): `import '@fontsource-variable/baloo-2/vietnamese.css';` plus latin. Verify Vietnamese diacritics render (ư ơ ấ ậ ễ).

## 3. Your build order

1. **Contract commit (Day 1):** flags.ts + r2l-kid.css + empty-but-rendering component shells with the exact APIs above. Push → tell the team thread the contract is live.
2. Component implementations + polish.
3. **Reskin shop / games / leaderboard:** wrap each `<main>` with gated `r2l-kid`, swap raw buttons → `KidButton`, cards → `KidCard`, the shop's `window.confirm` → `kidConfirm` (this is a logic-adjacent edit you DO own — keep H1's disable-on-click behavior intact). Balance display → `CoinPill`. No endpoint/data changes.
4. **Header `kidMode` prop** (default `false` — zero diff for marketing): when true, compact header — logo + small avatar slot `data-r2l-header-avatar`, no marketing nav links, no CTA buttons. Kid pages pass `kidMode={isW1Enabled()}`.

## 4. Game-feel principles (apply across all your surfaces)

- **Everything reacts:** every tappable has hover/active states; numbers never jump silently (coin/xp changes animate via the components).
- **One hero action per screen** — the biggest, most colorful thing is always "the next thing to do".
- **No walls of text:** max 1 short instruction line per card; icons carry meaning.
- **Soft failure:** danger color is soft coral-red, never black/harsh; error copy always tells the kid what to DO next.
- Touch targets ≥ 48px. Test at 360px width.

## 5. Tests & done-when

- `node --test tests/*.test.mjs` stays green (you change no logic; if a test asserts shop markup, update it with the test).
- Preview QA (`?w1=1` + `?v3=1`): shop/games/leaderboard fully kid-themed, buy flow works incl. kidConfirm; `?w1` absent → pixel-identical legacy; marketing pages diff = zero.
- Lighthouse mobile perf on shop ≥ current score (font subset + no new render-blocking).
- Report: branch hash, the contract commit hash (A/C need it), screenshots of each reskinned page at 360px.

## 6. Do NOT
- Do not touch lesson.astro or hoc-sinh/* even for "quick fixes" — report needs to Agent A/C instead.
- Do not add any dep beyond `@fontsource-variable/baloo-2`.
- Do not introduce sounds (W2), chests (W2), or avatar changes (W3).
- Do not rename anything in §2 after the contract commit — A and C build against it.
