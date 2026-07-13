# Felix Coaching — Design System

A blue night full of stars. This design system powers **felixbuilderhub.com** —
the personal site of **Tong Phuong** ("thầy Phương" / *Felix*), a solo
entrepreneur and speaking-skills coach for Vietnamese children. The brand puts
a calm, premium night-sky look behind a warm, parent-to-parent voice.

> Deep navy surfaces · golden star-light accents · warm cream text · scattered stars.

---

## What this brand is

Felix is **one person wearing three hats**, and the system has to serve all three:

1. **Felix Coaching** *(the core service)* — small-group (max 4) online classes
   that build a child's confidence to **speak**: conversation, storytelling,
   presentation, debate. English is the *medium*, not the subject.
2. **Read2Lead** *(AI product)* — a free, gamified reading/listening app. Kids
   pick a topic, an AI writes a personalised story + tasks, they earn XP, coins,
   streaks and climb rank tiers (Đồng → Huyền thoại). Parents track progress
   with a student code.
3. **MSMW — My Story, My World** *(AI product)* — bilingual (Vietnamese–English)
   personalised storybooks where **the child is the main character**, with
   AI-generated illustrations from real photos. Sold as digital + print.

Audience: **Vietnamese parents** of school-age children. All product copy is
**Vietnamese-first**.

## Sources this system was built from

- **Codebase (primary source of truth):** `felixbuilderhub/` — an Astro + Tailwind
  site. Colors, fonts, the star-field, components and copy were read directly
  from here (`src/styles/global.css`, `tailwind.config.mjs`, `src/pages/*.astro`,
  `src/components/*.astro`).
- **Codebase (backend):** `read2lead_v0_codex/` — the Python lesson-generation
  API behind Read2Lead (story/audio generation). Informs the product model, not
  the visuals.
- **GitHub:** <https://github.com/Tongphuong/felixbuilderhub> — the same project
  on GitHub. Explore it further to design more accurately against the real product.

> Reader note: you may not have access to the above. Everything needed to design
> on-brand lives in this folder; the links are recorded for provenance.

---

## CONTENT FUNDAMENTALS

**Language.** Vietnamese-first, always. English appears only as product/feature
names (Read2Lead, MSMW, online, AI) or as the *subject being taught*.

**Voice.** First person from Felix — **"tôi"** (I) and **"Felix"** (third-person
brand), speaking **to the parent ("anh chị", "bố mẹ")** about **their child
("con", "bé")**. It's the voice of a trusted individual teacher, not a company.
Example: *"Tôi là Phương — coach huấn luyện kĩ năng nói… Mỗi học sinh có trang
xem tiến độ riêng."*

**Tone.** Warm, reassuring, plain-spoken, confidence-focused. Sells outcomes
(*"dám mở miệng", "rèn tự tin thật", "nói trước đám đông"*), not test scores.
Honest about limits — beta products are labelled *"Thử nghiệm — miễn phí"*;
unfinished sections say *"Sắp ra mắt"*. Felix's philosophy recurs: *"tiếng Anh là
một ngôn ngữ, không phải một môn học."*

**Casing.** Sentence case everywhere — headings included. Short ALL-CAPS only for
eyebrow labels (`BỔ TRỢ NGOÀI LỚP`) via letter-spacing, never shouting in body.
Prices are colloquial Vietnamese: *"69k", "129k", "650.000đ / tháng"*.

**Microcopy.** CTAs are imperative and friendly: *"Đặt lịch tư vấn miễn phí →",
"Tạo bài học cho con", "Xem tiến độ con"*. Arrows (→) trail forward actions.
Reassurance follows commitments: *"Không spam.", "Felix sẽ Zalo trong 24h."*

**Emoji.** Used **sparingly and only in the kids' product / playful contexts** —
topic tiles (🐾 ⚽ 🎨), skill cards on the coaching page (💬 📖 🎤 ⚖️), checkmarks
(✓), fire-streak (🔥). **Never** in the brand voice of the marketing prose. Treat
emoji as functional iconography for children, not decoration for parents.

---

## VISUAL FOUNDATIONS

**Color.** A night sky. Backgrounds are deep **navy** (`--navy-950 #10273a`
page, `--navy-900 #17354a` alternating sections, `--navy-850/800` for raised /
hover surfaces). The single accent is **gold** (`--gold #c88f38`, hover/glow
`--gold-light #f2cc7e`) — used for CTAs, links, highlights and the star-light
glow. Text is **cream** in three weights (`--cream #f5e6c8` strong,
`--cream-muted` body, `--cream-dim` captions/hairlines). There is **no second
hue** — restraint is the brand. Read2Lead adds five rank-tier colors (bronze,
silver, gold, diamond, legend) used only inside the gamified product.

**Typography.** Two families. **Manrope** (600–800) for display/headings;
**Inter** (400–700) for body & UI. Both loaded with the **Vietnamese subset**.
Headings use `line-height: 1.35` and `text-wrap: balance` so stacked diacritics
never collide; body uses `text-wrap: pretty` and `line-height: 1.625`. Eyebrows
are extrabold, uppercase, widest tracking.

**Backgrounds.** The signature motif is `.star-field`: a vertical navy gradient
(`#10273a → #17354a → #0e2233`) overlaid with soft radial "nebula" glows and a
scatter of 1px cream/gold stars, `background-attachment: fixed` so the sky stays
put while content scrolls. Sections alternate between transparent (over the sky)
and solid `--navy-900` bands. No photographic backgrounds, no busy patterns.

**Imagery.** Warm and real — natural-light photography (the coach portrait, MSMW
book covers, in-class moments). Images sit on navy with either a **soft gold
ring** (`box-shadow: 0 0 0 4px var(--accent-soft)` on circular avatars) or a deep
drop shadow + 1px hairline border on rectangular media. Tone is warm/neutral,
never cold or desaturated. Placeholders for not-yet-real media use a "Sắp ra mắt"
badge over a navy gradient tile.

**Borders & cards.** Cards are the workhorse: translucent navy fill
(`--surface-card`), a **1px hairline** in `--cream-dim` at 20% opacity, and a
generous radius. Variants: default (subtle), **accent** (gold-tinted border for
feature/product cards), **raised** (solid surface + deep shadow). No colored
left-border-accent cards. Corner radii: `md 8px` (buttons/inputs), `lg 12px`
(cards/media), `xl 16px` (feature cards), `2xl 24px` (hero panels), `full` (pills,
avatars, badges).

**Shadows.** Deep and soft, tuned for dark surfaces — long, low-opacity black
shadows (`--shadow-card`, `--shadow-2xl`) that read as elevation against navy
rather than as gray boxes. The accent "glow" is a `ring-accent` gold halo.

**Buttons.** Primary = solid **gold** fill with **navy text**, hover lightens to
`--gold-light`. Secondary = transparent with a cream hairline border, hover
border + text shift to gold. Ghost = inline gold text link (often with a →).
Pressed state nudges down 1px; disabled drops to 60% opacity.

**Interaction & motion.** Restrained. Color/border transitions at ~250ms on a
standard ease; hover states shift *color*, not scale (except the floating Zalo
button, which lifts slightly). The only animated fill is the Read2Lead
lesson-generation bar (a moving gold gradient). No bounces, no parallax, no
decorative looping animations on content. Honor `prefers-reduced-motion`.

**Transparency & blur.** Used purposefully: sticky headers are
`navy-950` at 85–95% with `backdrop-filter: blur`; accent/gold tints are
`color-mix` washes (8–20%) rather than flat fills; card surfaces are
semi-translucent so the star-field faintly shows through.

**Focus & selection.** Accessibility is first-class: a 2px `--gold-light` focus
ring at 4px offset on every focusable element; text selection is gold background
on navy text.

**Layout.** Centered, generous, single main column. `max-w 72rem` (1152px)
content container, `max-w 48rem` for prose/FAQ, `1.5rem` side gutters; sections
breathe with ~80px vertical padding (heroes more). Mobile collapses multi-column
grids to one and the nav to a burger.

---

## ICONOGRAPHY

The brand has **no dedicated icon font or icon library**. Its iconography is
deliberately minimal and comes from three places:

1. **Inline single-path SVGs**, hand-placed where needed — brand/social glyphs
   (Facebook, Messenger, **Zalo** — the key contact channel in Vietnam),
   stroke-style line icons for contact rows (envelope, chat bubble), and the
   hamburger/close/chevron UI marks. Stroke icons use `stroke-width: 1.8–2`,
   `currentColor`, rounded caps/joins — a light, friendly line style. Reuse these
   from `felixbuilderhub/src/pages/index.astro` and `Header.astro` rather than
   drawing new ones.
2. **Emoji as functional icons inside the kids' product** — topic tiles, skill
   cards, streak (🔥), and rank/coin markers. These are intentional and
   on-brand *for children*; do not introduce emoji into parent-facing prose.
3. **Unicode glyphs** for tiny accents — `★` (★ stars), `→` (forward arrows on
   CTAs), `✓` (checklist ticks in gold). The star is the closest thing to a brand
   symbol and ties back to the night-sky theme.

The Read2Lead app additionally ships **SVG rank medals** (bronze→legend) in the
source repo at `public/assets/r2l/ranks/`. This system represents ranks with the
lightweight CSS `RankBadge` (glowing tier dot) instead; pull the real SVGs from
the repo if a design needs the literal medal art.

**Logo.** The `FB` monogram lockup ("Felix Builder Hub") — dark navy marks on a
warm gold gradient. Use `assets/logo-header.png` on navy; the rounded-square
`assets/favicon.png` is the app/avatar mark. Don't recolor or redraw it.

> Substitution note: none for fonts — Inter & Manrope are the genuine brand
> fonts, loaded from Google Fonts (Vietnamese subset). No icon-set substitution
> was needed since the brand uses inline SVG + emoji + Unicode.

---

## INDEX — what's in this folder

**Foundations**
- `styles.css` — the single entry point consumers link. Import-only.
- `tokens/colors.css` · `typography.css` · `spacing.css` · `backgrounds.css`
  (star-field) · `base.css` (resets, focus, eyebrow) · `components.css`
  (primitive classes) · `fonts.css` (Inter + Manrope).
- `foundations/*.html` — Design-System-tab specimen cards (Colors, Type,
  Spacing, Brand).

**Components** (`components/<group>/` — React primitives, namespace
`window.FelixCoachingDesignSystem_05c199`)
- `buttons/` — **Button** (primary / secondary / ghost · sm/md/lg)
- `forms/` — **Input**, **Select**, **Textarea** (labelled, gold focus ring)
- `content/` — **Card**, **Badge**, **Avatar**, **SectionHeading**, **Faq**
- `read2lead/` — **RankBadge**, **ProgressBar**, **TopicTile** (gamified)

**UI kits** (`ui_kits/<product>/` — full interactive recreations)
- `website/` — the Felix Coaching marketing homepage + booking flow.
- `read2lead/` — the Read2Lead AI lesson-builder flow + leaderboard.

**Assets** (`assets/`) — `logo-header.png/.webp`, `favicon.png`, `felix.jpg`
(coach portrait), `msmw-*.jpg` (book covers), `r2l-*.png` (product shots).

**Other** — `SKILL.md` (Agent-Skills-compatible entry point).
