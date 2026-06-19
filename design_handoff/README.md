# Handoff: Felix Coaching design system → felixbuilderhub.com

> For the AI/dev implementing this: read this file end-to-end before touching code. The supporting files are referenced inline.

## TL;DR

Bring the live site `felixbuilderhub.com` (Astro + Tailwind, repo: `felixbuilderhub/`) into 1:1 alignment with the **Felix Coaching design system** (this bundle). The brand foundation already matches — colors, fonts, the `.star-field` background and the layout grid are identical. The work is **component-level refinement** plus building **one new section of the Read2Lead product UI** (the lesson-builder flow).

This is **high-fidelity** work. The files in `mockups/` are design references created in HTML — recreate them inside the existing Astro/Tailwind codebase using the patterns already in `felixbuilderhub/src/`. Do **not** ship the HTML mockups directly.

---

## About the files in this bundle

| Folder | What's in it | Use it for |
|---|---|---|
| `brand-spec.md` | Full written brand spec — voice, tone, color, type, motion, microcopy rules. | Source of truth for any judgment call. Read first. |
| `tokens/` | All design tokens as CSS custom properties (`--navy-950`, `--gold`, `--text-h2`, etc.). | Confirm exact values. The Tailwind theme in the repo already mirrors these — see "Drift check" below. |
| `mockups/website/` | Marketing-site mockup: `Website.dc.html` (entry), `Chrome.jsx.txt` (header/footer), `Screens.jsx.txt` (home), `Contact.jsx.txt` (booking form). | Visual reference for the homepage + booking redesign. |
| `mockups/read2lead/` | Read2Lead app mockup: `Read2Lead.dc.html`, `App.jsx.txt`. | Visual reference for the gamified app shell. |
| `mockups/read2lead-lesson/` | Read2Lead **lesson builder** flow — code entry → topic grid → generating → lesson ready. | Visual reference for the new lesson-builder UI. |
| `components-reference/` | The design-system React component source (`Button`, `Card`, `Faq`, `SectionHeading`, `Input`, `RankBadge`, `ProgressBar`, `TopicTile`, etc.). Each component is one inline-styled JSX file, saved here with a `.jsx.txt` extension — rename to `.jsx` if your editor needs the extension for syntax highlighting. | Read the JSX to see how each component is built — exact paddings, radii, hover states, focus rings. Reimplement equivalents as Astro/Tailwind in the repo. |

> The mockups can be opened in a browser (they load a compiled bundle from the design-system project). For this handoff, treat them as **screenshots-in-HTML**: structure and styling reference, not runnable code to import.

---

## Repo target

- Repo: `felixbuilderhub/` (Astro + Tailwind, deployed via Cloudflare Pages)
- Key paths:
  - `src/pages/*.astro` — the routes
  - `src/components/Header.astro`, `Footer.astro` — site chrome
  - `src/styles/global.css` — base styles + the star-field gradient
  - `tailwind.config.mjs` — color/font theme
  - `src/pages/read2lead/*.astro` — the R2L app pages
- Languages: Vietnamese-first for all user copy. English only for product names (Read2Lead, MSMW) and the subject being taught.

---

## Drift check — what already matches, what to change

I compared the design system against the current `felixbuilderhub/` repo. **Most of the brand foundation is already correct.** Do not regress these:

✅ **Already correct in `tailwind.config.mjs`:**
- `navy-950 #10273a`, `navy-900 #17354a`, `navy-850 #1d3f58`, `navy-800 #244a64`
- `accent / gold = #c88f38`, `accent-hover / gold-light = #f2cc7e`
- `cream #f5e6c8`, `cream-muted #d9c7a4`, `cream-dim #aa9673`
- Font families: `Inter` (body), `Manrope` (display)

✅ **Already correct in `src/styles/global.css`:**
- `body.star-field` gradient + scattered stars + `background-attachment: fixed`
- Gold focus ring (`#f2cc7e`, 2px, 4px offset)
- Gold text selection
- `h1/h2/h3.font-display { line-height: 1.35; text-wrap: balance }`
- `p/li/summary { text-wrap: pretty }`

⚠️ **Add to `tailwind.config.mjs` (semantic tokens currently missing):**
The design system has named semantic tokens that the repo doesn't expose. Add Tailwind utilities for them by extending the theme with the values from `tokens/colors.css`:

- `--surface-card` → `color-mix(in srgb, var(--navy-900) 70%, transparent)` — translucent card fill
- `--surface-raised` → `var(--navy-850)`
- `--border-subtle` / `--border-default` / `--border-strong` → cream-dim at 20% / 30% / 40%
- `--accent-soft` / `--accent-border` — gold mixes for tinted backgrounds + borders
- `--rank-bronze` `--rank-silver` `--rank-gold` `--rank-diamond` `--rank-legend` — only for Read2Lead tiers

Prefer wiring these as CSS variables in `global.css` and referencing them in components, rather than fattening the Tailwind palette.

⚠️ **Add a body class strategy:** the design system assumes every page has `class="star-field"` on `<body>`. The repo currently only puts it where used. Confirm `BaseLayout.astro` applies it sitewide.

---

## What to build, in priority order

### Phase 1 — Component primitives (do this first)

Build these as **Astro components** in `src/components/ui/` mirroring the design-system JSX in `components-reference/`. Each `.jsx` is short (50–150 lines) — copy the inline styles to Tailwind classes.

| Build | Reference file | Notes |
|---|---|---|
| `<Button>` | `components-reference/buttons/Button.jsx` | Variants: `primary` (solid gold), `secondary` (cream border), `ghost` (gold text). Sizes: `sm`, `md`, `lg`. The repo already inlines these styles — refactor existing button markup to use this single component. |
| `<Card>` | `components-reference/content/Card.jsx` | Variants: `default`, `accent`, `raised`. Translucent navy fill, hairline border, generous radius. |
| `<SectionHeading>` | `components-reference/content/SectionHeading.jsx` | Eyebrow (uppercase, extrabold, gold) + h2 + optional subtitle. Standardize the existing section headers across the site to this pattern. |
| `<Badge>` | `components-reference/content/Badge.jsx` | Pill, with variants for gold-tinted and cream-outline. |
| `<Avatar>` | `components-reference/content/Avatar.jsx` | Circular, with the gold ring for emphasis. |
| `<Faq>` | `components-reference/content/Faq.jsx` | Disclosure pattern; chevron rotates, gold underline on hover. |
| `<Input>`, `<Select>`, `<Textarea>` | `components-reference/forms/*.jsx` | Labelled, gold focus ring, danger state. Replace all raw form fields in `coaching.astro` contact section. |

### Phase 2 — Read2Lead primitives (gamified product only)

Only used inside the R2L app pages.

| Build | Reference file |
|---|---|
| `<RankBadge>` | `components-reference/read2lead/RankBadge.jsx` |
| `<ProgressBar>` | `components-reference/read2lead/ProgressBar.jsx` |
| `<TopicTile>` | `components-reference/read2lead/TopicTile.jsx` |

### Phase 3 — Page-by-page application

| Repo page | Visual reference | What changes |
|---|---|---|
| `src/pages/index.astro` | `mockups/website/Website.dc.html` (home view) | Replace inline button/section markup with the new components from Phase 1. Adopt the eyebrow → h2 → subtitle rhythm on every section. |
| `src/pages/coaching.astro` | `mockups/website/Screens.jsx` (skills section) + `Contact.jsx` (booking form) | Use `<Card>` for skill cards (💬 📖 🎤 ⚖️ emoji + heading + body). Rebuild the booking form with `<Input>` / `<Textarea>` / `<Select>` + `<Button>`. |
| `src/pages/read2lead.astro` | `mockups/read2lead/App.jsx` header strip | Match the sticky header with logo + `<RankBadge>` + coin/streak counters + `<ProgressBar>` for the level XP. |
| `src/pages/read2lead/lesson.astro` | `mockups/read2lead-lesson/Read2LeadLesson.dc.html` | **New design.** Three states (`build`, `generating`, `result`) — step indicator, student-code `<Input>`, topic `<TopicTile>` grid, generate button, animated gradient `<ProgressBar>` during generation, "lesson ready" success card. Logic lives in the `Read2LeadLesson.dc.html` `<script>` block — port the state machine to a small Astro client island. |
| `src/components/Header.astro` | `mockups/website/Chrome.jsx` `SiteHeader` | Confirm matches: sticky, `backdrop-blur(8px)`, nav links shift to gold when active, mobile burger. |
| `src/components/Footer.astro` | `mockups/website/Chrome.jsx` `SiteFooter` | Centered, cream-dim text, hairline top border. |

Pages **not in the design system** (e.g. `src/pages/read2lead/games.astro`, `leaderboard.astro`, `library.astro`, `review.astro`, `shop.astro`, `speaking.astro`, `hoc-sinh/`, `phu-huynh/`): leave alone for now, or apply the Phase 1 components opportunistically as you encounter inline-styled buttons/cards. Don't redesign them — that's a separate scope.

---

## Style rules to honor

Pulled from `brand-spec.md`. Read that file for the full list — these are the ones most easily violated:

1. **Sentence case for headings.** Not Title Case. No shouting.
2. **No second hue.** Navy + gold + cream. The five rank colors are the only exception, scoped to Read2Lead.
3. **No emoji in parent-facing prose.** Only inside the kids' product (topic tiles, skill cards 💬 📖 🎤 ⚖️, streak 🔥, ranks).
4. **Vietnamese-first.** Every label, every CTA. English only as a product name or as "the subject being taught".
5. **Sparing motion.** ~250ms color/border transitions, no scale-on-hover (except the floating Zalo button). No parallax, no looping decorative animations. Honor `prefers-reduced-motion`.
6. **Cards over colored-left-border accents.** Never use the "colored stripe on the left" card pattern.
7. **No photographic backgrounds.** The star-field is the only motif.
8. **CTAs end in →** for forward actions.
9. **Reassurance copy follows commitments** — *"Không spam."*, *"Felix sẽ Zalo trong 24h."*

---

## Interactions & state

The lesson-builder is the only screen with non-trivial client state. The reference implementation is in `mockups/read2lead-lesson/Read2LeadLesson.dc.html` (inside the `<script type="text/x-dc">` block):

- `phase`: `'build' | 'generating' | 'result'`
- `code`: student code (auto-uppercased on input)
- `topic`: selected topic index (single select)
- `stage`: 0..3 — current generation step, advances every 1300ms while generating
- Generate is disabled until `code` is non-empty.
- "Generating" stage labels rotate through (Vietnamese): *Đang viết câu chuyện riêng cho con… → Đang chuẩn bị phần nghe… → Đang ghi âm các cụm câu… → Đang chuẩn bị nhiệm vụ web…*
- After the last stage, after 900ms transition, switch to `result`.
- Reset button on the result returns to `build`.

Port this to a small Astro client component (`client:load`) — or a vanilla `<script>` if preferred to avoid the React dependency on this route. Real generation will replace the `setInterval` simulator with the actual API call to the `read2lead_v0_codex` backend; for now match the visual cadence and copy exactly.

---

## Assets

The repo already has the brand assets it needs:
- `felixbuilderhub/public/images/felix.jpg` — coach portrait
- `felixbuilderhub/public/assets/logo-header.png` — logo lockup
- `felixbuilderhub/public/assets/favicon.png` — favicon / app mark
- `felixbuilderhub/public/assets/r2l/ranks/*.svg` — rank medals (use directly; the design system's CSS `RankBadge` is the lightweight fallback, but the real medals are nicer for the R2L app)

No new assets in this handoff.

---

## Done = …

A change is "done" when:
- It uses the new Phase 1/2 components (no more inline-styled buttons or cards on the redesigned page).
- Colors / spacing / typography come from CSS variables or Tailwind tokens — no hardcoded hex anywhere.
- It looks like the corresponding mockup at 1280px wide and at 375px wide (the mockups responsively collapse multi-column grids to one).
- Vietnamese diacritics never collide on headings (`text-wrap: balance` + `line-height: 1.35`).
- Focus state is visible (gold ring) on every interactive element.
- `prefers-reduced-motion: reduce` removes any non-essential animation.

---

## Questions for the implementer to confirm

1. **Lesson-builder backend.** Is the generation API in `read2lead_v0_codex` ready to call, or should this PR keep the simulator and add the API wire-up later?
2. **Hoc-sinh / Phu-huynh hubs.** Out of scope for this redesign — confirm.
3. **MSMW page.** The design system covers it inside the marketing-site mockup (`Screens.jsx` `HomeScreen` has an MSMW section). The repo has a standalone `src/pages/msmw.astro` — confirm whether to align both or only the homepage section.
