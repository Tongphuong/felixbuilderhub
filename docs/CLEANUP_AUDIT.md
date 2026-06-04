# Cleanup audit — felixbuilderhub.com

Generated: 2026-06-05 (Phase α.1.7)

## Components by usage

### Dead (0 imports)

None — clean.

### Used (≥1 imports)

| Component | Imported by |
|---|---|
| Header.astro | src/pages/404.astro; src/pages/index.astro; src/pages/coaching.astro; src/pages/msmw.astro; src/pages/read2lead.astro; src/pages/read2lead/leaderboard.astro; src/pages/read2lead/lesson.astro; src/pages/read2lead/review.astro; src/pages/privacy.astro; src/pages/space.astro |
| Footer.astro | src/pages/index.astro; src/pages/404.astro; src/pages/msmw.astro; src/pages/space.astro; src/pages/read2lead.astro; src/pages/coaching.astro; src/pages/read2lead/leaderboard.astro; src/pages/privacy.astro; src/pages/read2lead/lesson.astro; src/pages/read2lead/review.astro |

## Hardcoded brand hex codes

None — fully tokenized.

Audit note: the hex-pattern scan found `&#039;` in
`src/pages/read2lead/leaderboard.astro`, but this is an HTML entity used to
escape an apostrophe, not a color literal.

## Recommendations

1. Phase γ.1: remove dead components after confirming with Phương.
2. Phase γ.2: replace hardcoded hex with Tailwind tokens.
