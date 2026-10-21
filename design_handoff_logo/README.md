# Handoff: felixbuilderhub logo (v2)

## Overview

New primary logo for **felixbuilderhub** — replaces the current gold-gradient "FB" tile ([`assets/logo-header.png`](https://github.com/Tongphuong/felixbuilderhub) & `assets/favicon.png`). The new mark is a 4-point sparkle star + a lowercase wordmark with "builder" in gold; tuned to the site's night-sky palette (Manrope wordmark, gold accent on deep navy). Direction chosen by the user: **1a — Sparkle wordmark**.

## About the design files

The `.dc.html` file in this bundle is a **design reference** — a preview showing the logo in context (header, favicon set, avatar). The task is to drop the provided **SVG assets** into the felixbuilderhub codebase (`felixbuilderhub/public/assets/` and the site header) and remove the old PNG lockup. No new components to build; this is an asset + one header markup change.

## Fidelity

**High-fidelity.** Colors, geometry, and typography are final. All SVGs are production-ready and **fully self-contained** — the wordmark is outlined to vector paths (traced from Manrope 800), so the lockup renders pixel-identical whether inlined, loaded via `<img>`, embedded in email, or opened in Figma. No font dependency.

---

## Assets (drop into `felixbuilderhub/public/assets/`)

| File | Purpose | Use where |
|---|---|---|
| `logo-lockup-dark.svg` | **Primary lockup** — star + wordmark, cream/gold on transparent | Site header on navy backgrounds |
| `logo-lockup-light.svg` | Lockup for light backgrounds — navy text | Print, invoices, light-mode emails |
| `logo-mark.svg` | Star mark alone, gold on transparent | Loading states, small chrome, watermarks |
| `logo-mark-navy.svg` | Star mark alone, navy on transparent | On top of cream/gold surfaces |
| `favicon.svg` | 64×64 rounded-square navy tile with gold star | Browser tab, `<link rel="icon">` |
| `apple-touch-icon.svg` | 180×180 rounded app-icon variant with radial navy | iOS home-screen shortcut, PWA icon |

All assets use the exact brand tokens; no color drift.

---

## The mark (star)

- 4-point sparkle star. Curved concave sides (not straight edges) — the four "arms" swell outward and pinch at the center, matching starlight rendered as a soft cross.
- Optical center: geometric center of the 64×64 viewBox at `(32, 32)`.
- Vertical and horizontal axes are equal length; there is no rotation.
- **Only** the gold fill — no stroke, no gradient. The Read2Lead/MSMW radial-glow effect is applied *around* the mark by the page (via the existing star-field / `.ring-accent` glow), not baked in.
- SVG path (final):
  ```
  M32 3 L35.2 26.2 C35.6 29.1 37.9 31.4 40.8 31.8 L61 32
  L40.8 32.2 C37.9 32.6 35.6 34.9 35.2 37.8 L32 61
  L28.8 37.8 C28.4 34.9 26.1 32.6 23.2 32.2 L3 32
  L23.2 31.8 C26.1 31.4 28.4 29.1 28.8 26.2 Z
  ```

## The wordmark

- **Text:** `felixbuilderhub` — all lowercase, single token (no spaces, no capitals).
- **Source font:** Manrope, weight `800` (ExtraBold), traced from `@fontsource/manrope@5` (SIL Open Font License). In the shipped SVGs the wordmark is outlined to paths — the font is not required to render them.
- **Tracking used when outlining:** `-0.03em` (letter-spacing).
- **Color rhythm:** `felix` and `hub` in cream (`#f5e6c8` on navy) or navy (`#10273a` on light). The middle word **`builder`** is always gold (`#c88f38`). This gold-in-the-middle rhythm is the signature of the wordmark — don't drop it.

## Horizontal lockup

- **Star + wordmark, baseline-optically aligned.**
- Mark height ≈ **1.6× cap height** of the wordmark. In the master SVG the mark is 58px tall and the wordmark is set at 34px (cap-height ~24px).
- **Spacing between mark and wordmark:** `18px` at the master size, i.e. **~0.5× mark height**. Scales proportionally.
- **Minimum size:** 120px wide (dark lockup) / 140px wide (light lockup — navy text needs slightly more room). Below that, use the mark alone.
- **Clear space:** minimum padding equal to the width of one star arm (~8px at 64px mark height) on every side.

## Design tokens

Pulled from `_ds/felix-coaching-design-system-…/tokens/colors.css` — do not invent new values.

| Token | Hex | Used for |
|---|---|---|
| `--navy-950` | `#10273a` | Page background, wordmark on light |
| `--gold` | `#c88f38` | Star fill, "builder" text, primary accent |
| `--gold-light` | `#f2cc7e` | Hover/glow only (not the resting logo) |
| `--cream` | `#f5e6c8` | Wordmark on navy |

**Font:** `Manrope` 800, tracking `-0.03em`. Vietnamese subset already loaded by the site.

---

## Where to apply in the codebase

Everything below refers to the `felixbuilderhub/` (Astro) repo.

### 1. Header logo — `src/components/Header.astro`

Replace the `<img src="/assets/logo-header.png">` with an inline SVG or `<img src="/assets/logo-lockup-dark.svg">`. Inline SVG is preferred so the wordmark stays crisp at any DPI and picks up `currentColor` if you ever want to theme it.

Recommended: use `<img src="/assets/logo-lockup-dark.svg" alt="felixbuilderhub" height="40">` on desktop, `height="32"` on mobile. (Inlining the SVG is also fine but not required — the wordmark is outlined.) Wrap in a link back to `/` with `aria-label="felixbuilderhub — trang chủ"`.

### 2. Favicons — `src/layouts/BaseLayout.astro` (or wherever `<head>` lives)

```html
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.svg" />
```

Delete the old `favicon.png`. Keep a rasterized `favicon-32.png` fallback if you care about very old browsers (generate from `favicon.svg`; keep the same 12px corner radius).

### 3. Delete / archive the old assets

- `public/assets/logo-header.png` → archive
- `public/assets/logo-header.webp` → archive
- `public/assets/favicon.png` → archive

### 4. Update the design-system guide (optional, low priority)

The design-system guide (`_ds/…/readme.md`) currently says *"The `FB` monogram lockup … Use `assets/logo-header.png` on navy."* — update to reference the new SVGs and the "gold-in-the-middle wordmark" rule.

---

## Do & Don't

**Do**
- Keep "builder" gold. It's the wordmark's signature.
- Use the SVG at any size — it's a single path.
- Add a soft gold glow *behind* the star on hero surfaces via existing `--accent-soft` (`box-shadow`, not SVG filter).

**Don't**
- Stretch or squash the mark. If you need a taller lockup, stack star-over-wordmark (not squeeze).
- Recolor the star to cream, white, or `--gold-light` at rest. Gold at rest, gold-light only on hover.
- Use the wordmark without the star at header sizes ≥ 40px — the star grounds the mark.
- Add a stroke to the star.

---

## Files in this bundle

- `assets/logo-lockup-dark.svg` — primary lockup (dark bg)
- `assets/logo-lockup-light.svg` — lockup for light bg
- `assets/logo-mark.svg` — gold star alone
- `assets/logo-mark-navy.svg` — navy star alone
- `assets/favicon.svg` — 64×64 favicon
- `assets/apple-touch-icon.svg` — 180×180 iOS/PWA icon
- `preview.html` — visual reference showing every variant + header mock
- `Felixbuilderhub Logo.dc.html` — original design canvas with all 3 explored directions (1a, 1b, 1c) — 1a was chosen
