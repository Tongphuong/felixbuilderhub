# Reference — Felix Coaching Design System

Memory doc for future Cursor / Codex agents. **Reuse this system** instead of
reinventing styles. Shipped to production 2026-06-18 (main merge `8eede85`).

The system is **additive**: design tokens + `fx-*` utility classes layer on top of
the existing Tailwind utilities and `src/styles/global.css` (which stays authoritative
for body/headings). Adding the system must **not break existing pages** — never
repurpose or remove existing class names; only add `fx-*` classes and tokens.

## 1. Reusable UI primitives — `src/components/ui/`

Astro components that consume the tokens + `fx-*` classes. Prefer these over ad-hoc markup:

- `Badge.astro`
- `Button.astro`
- `Card.astro`
- `Avatar.astro`
- `SectionHeading.astro`
- `Input.astro`
- `Textarea.astro`
- `Select.astro`
- `ProgressBar.astro`
- `RankBadge.astro`
- `Faq.astro`
- `TopicTile.astro`

## 2. Design tokens — `src/styles/design-system.css`

All tokens are CSS custom properties on `:root`. Key groups:

- **Palette:** `--navy-950/900/850/800`, `--gold`, `--gold-light`, `--cream` /
  `--cream-muted` / `--cream-dim` (mirror `tailwind.config.mjs`).
- **Surfaces:** `--surface-page`, `--surface-section`, `--surface-card`,
  `--surface-raised`, `--surface-overlay`.
- **Text:** `--text-strong`, `--text-body`, `--text-muted`, `--text-on-accent`,
  `--text-link` / `--text-link-hover`.
- **Accent:** `--accent`, `--accent-hover`, `--accent-soft`, `--accent-border`.
- **Borders:** `--border-subtle`, `--border-default`, `--border-strong`.
- **Status:** `--success` / `--success-soft`, `--danger` / `--danger-soft`.
- **Read2Lead rank tiers:** `--rank-bronze/silver/gold/diamond/legend`.
- **Scales:** `--space-*` (4px base), `--radius-*`, `--shadow-card/lg/2xl`,
  **`--ring-accent`** (the gold focus/selection ring), `--ease-standard`,
  `--duration-fast/base`, type families/weights/scale, tracking/leading.

## 3. `fx-*` utility class convention

Additive component utilities defined in `design-system.css`. Verified class names:

- **Eyebrow:** `.fx-eyebrow`
- **Button:** `.fx-btn` + size `.fx-btn--sm|--md|--lg` + variant
  `.fx-btn--primary|--secondary|--ghost` + `.fx-btn--block`
- **Card:** `.fx-card` + `.fx-card--accent|--raised|--interactive`
- **Badge:** `.fx-badge` + `.fx-badge--accent|--gold|--neutral|--solid`
- **Avatar:** `.fx-avatar` + `.fx-avatar--sm|--md|--lg|--xl`
- **Form fields:** `.fx-label` (+ `.fx-label__req`), `.fx-field` (input/textarea/select),
  `.fx-field-hint`
- **Progress:** `.fx-progress` + `.fx-progress__fill` (+ `--gradient`)
- **Rank badge:** `.fx-rank` + `.fx-rank__dot` + `.fx-rank--bronze|--silver|--gold|--diamond|--legend`
- **FAQ/accordion:** `.fx-faq` + `.fx-faq__body` (on `<details>/<summary>`)
- **Topic tile (Read2Lead):** `.fx-topic` + `.fx-topic--selected` + `.fx-topic__emoji` + `.fx-topic__label`
- **Section heading:** `.fx-section-heading__title` + `.fx-section-heading__lead`

A `prefers-reduced-motion: reduce` block disables non-essential transitions.

## 4. The additive principle

Tokens + `fx-*` classes are **additive** and must not break existing pages. When
applying the system to a new page, add `fx-*` classes / primitives; do not rip out
the page's current Tailwind/global styling unless intentionally redesigning it.

## 5. Known follow-up advisory — a11y focus ring (incomplete)

The focus-ring pass is **not finished** and is a candidate for a future a11y pass:

- `.fx-btn` has **no `:focus-visible`** state — the intended gold ring
  (`--ring-accent`) is not applied on keyboard focus.
- `.fx-field:focus` only changes `border-color` (no visible ring).
- `--ring-accent` exists and is already used by `.fx-topic--selected`; reuse it when
  completing the focus-visible states across buttons and fields.

## 6. Migration status

- **Migrated (live):** Home `/`, `/coaching` (copy reverted to original), `/read2lead/build`.
- **Wave 3 remaining:**
  - Wire `/read2lead/build` to the real backend (currently client-side scaffold via
    `src/scripts/r2l-builder.client.ts`).
  - Align `src/pages/msmw.astro` to its mockup.
  - Apply the primitives to the other Read2Lead app pages.
  - Complete the focus-ring a11y pass (section 5).
