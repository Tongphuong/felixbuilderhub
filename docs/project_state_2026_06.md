# Project State — 2026-06

Snapshot of felixbuilderhub production state as of June 2026.

## Design Handoff — shipped to production (2026-06-18)

The design handoff (Phase 1) is **live on `main` / production**. It introduced a
reusable design system and redesigned the first batch of pages.

- **Integration branch:** `design/handoff-phase1` (HEAD `0c8d594`) — retained ~1 week
  for easy rollback; do not delete yet.
- **Promoted to `main`:** merge commit **`8eede85`** (`--no-ff` merge of
  `design/handoff-phase1`), pushed to origin → production auto-deploy.
- **Build:** green. `astro check` = 412 errors (unchanged pre-existing baseline in
  `src/pages/hoc-sinh/index.astro`); the design files contribute **0 new diagnostics**.

### Wave 1 + Wave 2 — pages redesigned with the new design system
- **Home `/`** (`src/pages/index.astro`) — Wave 1 (cursor-1).
- **`/coaching`** (`src/pages/coaching.astro`) — Wave 1 (cursor-2). Note: marketing
  **copy was reverted to the original**; only the design-system layout was applied.
- **`/read2lead/build`** (`src/pages/read2lead/build.astro` + `src/scripts/r2l-builder.client.ts`)
  — Wave 2 (cursor-3).

### Design system foundation (additive)
- **Tokens:** `src/styles/design-system.css` (`:root` CSS custom properties).
- **UI primitives:** `src/components/ui/*.astro` (Badge, Button, Card, Avatar,
  SectionHeading, Input, Textarea, Select, ProgressBar, RankBadge, Faq, TopicTile).
- **Utility convention:** additive `fx-*` classes; existing pages untouched.
- See `docs/reference_design_system.md` for the full reference.

## Wave 3 — remaining design work
- Wire `/read2lead/build` to the real backend (currently client-side scaffold).
- Align `src/pages/msmw.astro` to its mockup.
- Apply the UI primitives to the remaining Read2Lead app pages.
- A11y follow-up: complete the focus-ring pass (see reference doc advisory).
