# TASKS.md — Apply new felixbuilderhub logo

**Repo:** `felixbuilderhub/` (Astro + Tailwind, https://github.com/Tongphuong/felixbuilderhub)
**Ship goal:** replace the old gold-gradient "FB" tile everywhere with the new sparkle-star + wordmark lockup.

All new assets are in this bundle's `assets/` folder. **The SVGs are fully self-contained** — the wordmark is outlined to vector paths, no font dependency.

---

## Task 1 — Copy new assets

Copy every file from `assets/` in this bundle into `felixbuilderhub/public/assets/`:

```
public/assets/logo-lockup-dark.svg      (primary header lockup)
public/assets/logo-lockup-light.svg     (light-bg lockup)
public/assets/logo-mark.svg             (star alone, gold)
public/assets/logo-mark-navy.svg        (star alone, navy)
public/assets/favicon.svg               (browser tab)
public/assets/favicon-32.png            (legacy fallback)
public/assets/favicon-64.png            (legacy fallback)
public/assets/apple-touch-icon.svg
public/assets/apple-touch-icon.png      (180×180, iOS home screen)
public/assets/icon-512.png              (PWA / social share)
```

## Task 2 — Replace header logo

**File:** `src/components/Header.astro`

Find the current logo `<img>` (currently references `/assets/logo-header.png` or `/assets/logo-header.webp`) and replace with:

```astro
<a href="/" aria-label="felixbuilderhub — trang chủ" class="inline-flex items-center">
  <img
    src="/assets/logo-lockup-dark.svg"
    alt="felixbuilderhub"
    width="212"
    height="40"
    class="h-8 md:h-10 w-auto select-none"
    draggable="false"
  />
</a>
```

- Do NOT wrap in `<picture>` or use a `.webp` — the SVG is the source of truth.
- Keep any existing surrounding container / flex classes on the parent `<div>`.
- `h-8 md:h-10` gives 32px mobile / 40px desktop; adjust if the header nav is taller/shorter but keep the SVG's natural aspect ratio (`w-auto`).

## Task 3 — Replace favicons

**File:** `src/layouts/BaseLayout.astro` (or whichever layout owns `<head>` — check `src/layouts/*.astro`).

Remove any existing `<link rel="icon">` / `<link rel="apple-touch-icon">` lines and replace with:

```astro
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
<meta name="theme-color" content="#10273a" />
```

## Task 4 — Update OG / social share (if present)

Search for `og:image` and `twitter:image` in the codebase:
```bash
rg -n "og:image|twitter:image" src/
```
If either points at `/assets/logo-header.png` or `/assets/favicon.png`, repoint to `/assets/icon-512.png`. Don't add these tags if they don't already exist.

## Task 5 — Delete archived assets

Only after tasks 1–4 are verified in a local build:

```bash
git rm public/assets/logo-header.png
git rm public/assets/logo-header.webp
git rm public/assets/favicon.png
```

Do NOT delete `favicon.ico` if one exists at the site root — leave it as final fallback.

## Task 6 — Verify

```bash
npm run dev
```

Check:
- [ ] Header shows sparkle star + `felix` (cream) + `builder` (gold) + `hub` (cream) on navy.
- [ ] At mobile widths the wordmark is legible (not truncated behind the burger).
- [ ] Browser tab shows the navy tile with gold star.
- [ ] `npm run build` succeeds with no broken-asset warnings.
- [ ] `rg -n "logo-header|favicon\.png" src/ public/` returns no hits.

Commit message:
```
chore(brand): swap in new felixbuilderhub logo (sparkle wordmark)

- Replace FB monogram with outlined-path lockup (star + wordmark)
- New favicon + apple-touch-icon set (SVG + PNG fallbacks)
- Archive old logo-header.{png,webp} and favicon.png
```

---

## Design tokens (already present in the site — do not redefine)

| Token | Hex | Notes |
|---|---|---|
| `--navy-950` | `#10273a` | Header bg, favicon bg |
| `--gold` | `#c88f38` | Star, "builder" text |
| `--cream` | `#f5e6c8` | "felix" and "hub" text on navy |

Font: Manrope 800 — already loaded via `fonts.css`. The shipped SVGs don't rely on it (outlined), but the fallback is still there if any consumer inlines the wordmark as `<text>` later.

## Notes for future work (out of scope of this task)

- If you later need the wordmark on **cream / print** surfaces (invoices, business cards), use `logo-lockup-light.svg` — both the star and text are navy on that variant.
- The star alone (`logo-mark.svg`) is the correct symbol for very small chrome (loading spinners, empty states) where the wordmark won't be legible.
- Minimum lockup width: **120px**. Below that, use the star mark alone.
