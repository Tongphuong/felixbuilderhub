# SEO + A11y audit — felixbuilderhub.com

Generated: 2026-06-05 (Phase α.3)

## Per-page SEO + A11y matrix

All 11 pages use `BaseLayout`, which provides `<title>`, meta description,
OpenGraph title/description/image, canonical URL, viewport, and `<html lang="vi">`.

| Route | Title | Description | OG tags | Canonical | Viewport | Lang | Image alt | Form labels |
|---|---|---|---|---|---|---|---|---|
| `/` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | ✓ | N/A |
| `/read2lead` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | ✓ | ✗ |
| `/read2lead/lesson` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | ✓ | ✗ |
| `/read2lead/review` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | N/A | ✓ |
| `/read2lead/leaderboard` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | N/A | N/A |
| `/msmw` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/coaching` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/space` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | N/A | ✓ |
| `/admin/codes` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | ✓ | ✗ |
| `/privacy` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | N/A | N/A |
| `/404` | ✓ | ✓ | ✓ (3/3) | ✓ | ✓ | ✓ | N/A | N/A |

## Gaps summary

### Missing description

None — all pages inherit or pass a meta description through `BaseLayout`.

### Missing OG tags

None — `BaseLayout` emits `og:title`, `og:description`, and `og:image`.

### Missing alt on img

None found. Multi-line `<img>` tags on `/` and `/coaching` include `alt`.
Decorative dynamically rendered Read2Lead lesson images use empty `alt=""`,
which is acceptable for decorative assets.

### Forms without labels

- `src/pages/read2lead.astro`: access-code input has a nearby visual `<label>`
  but no `for`/`id` association and the input is not wrapped by the label.
- `src/pages/admin/codes.astro`: create-code form labels are visual only; the
  text/number/select controls have no `id` and labels have no `for`.
  Affected fields: `parent_name`, `parent_zalo`, `student_name`,
  `student_age`, `student_level`, `child_gender`, `uses`, `expiry_days`,
  `notes`.
- `src/pages/read2lead/lesson.astro`: generated dictation text input uses
  placeholder text inside a visual card, but no explicit label/aria label.
  Hidden inputs are ignored for this audit.

### Buttons without clear accessible labels

- `src/pages/admin/codes.astro`: `#copy-code` button is empty before JS fills
  it and has no `aria-label`.
- `src/pages/read2lead/lesson.astro`: one generated voice-record button uses a
  microphone emoji plus `title`, but no `aria-label`; later generated variants
  already include `aria-label`.

### Fixed pixel inline widths

None found in inline `style` attributes. Static image `width`/`height`
attributes are present where appropriate and are not layout regressions.

## Sitemap + robots.txt

- Sitemap.xml present? Yes — `public/sitemap.xml`
- robots.txt present? Yes — `public/robots.txt`
- Astro sitemap integration present? No explicit `astro-sitemap` integration
  in `astro.config.mjs`; sitemap appears to be a static public file.

## Recommendations (Phase γ candidates)

1. Add explicit `id` + `for` associations for `/read2lead` access-code input.
2. Add `id` + `for` associations in `/admin/codes` create-code form, or wrap
   each control inside its visible label.
3. Add accessible labels for generated Read2Lead lesson dictation inputs.
4. Add `aria-label` to icon-only or initially-empty buttons (`#copy-code`,
   voice-record button variant).
5. Consider adopting `astro-sitemap` later if route count grows or dynamic
   route generation appears; static `public/sitemap.xml` is adequate for now.
