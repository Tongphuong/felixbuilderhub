# CLAUDE.md — felixbuilderhub logo handoff

You are Claude Code. Your job on this task is narrow and mechanical: swap the old `FB` monogram logo in the `felixbuilderhub` Astro repo for the new sparkle-star lockup provided in this bundle.

## Read first
1. `TASKS.md` — the ordered list of concrete edits. Do them in order.
2. `README.md` — brand context (colors, spacing, do/don't). Consult if a decision isn't spelled out in TASKS.md.

## What's in this folder
- `assets/` — the new SVG + PNG files to drop into `public/assets/`.
- `TASKS.md` — exact edits + snippets.
- `README.md` — designer notes.
- `preview.html` — visual reference (open in a browser to see the target look).
- `Felixbuilderhub Logo.dc.html` — original exploration file, informational only.

## Ground rules
- **Do not redesign.** The SVGs are final. Use them as-is.
- **Do not restyle the header** beyond what TASKS.md specifies. Don't change nav layout, colors, or spacing.
- **Do not add new dependencies.** No icon libraries, no font packages — the SVGs are self-contained.
- If a file path in TASKS.md doesn't exist as written, search for the current equivalent (`rg -n "logo-header" src/`) and adapt. Report what you changed.
- Ask before deleting anything not in Task 5's explicit list.

## Verification bar
`npm run build` clean, no console errors on `npm run dev`, and no remaining references to `logo-header.*` or `favicon.png` under `src/` or `public/`.
