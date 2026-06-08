# Page consistency audit — felixbuilderhub.com

Generated: 2026-06-05 (Phase α.1.6)

## Coverage matrix

| Route | File | Lines | BaseLayout | Header | Footer |
|---|---|---:|---|---|---|
| `/` | src/pages/index.astro | 157 | ✓ | ✓ | ✓ |
| `/read2lead` | src/pages/read2lead.astro | 575 | ✓ | ✓ | ✓ |
| `/read2lead/lesson` | src/pages/read2lead/lesson.astro | 1589 | ✓ | ✓ | ✓ |
| `/read2lead/review` | src/pages/read2lead/review.astro | 5 | ✓ | — | — |
| `/hoc-sinh` | src/pages/hoc-sinh/index.astro | — | ✓ | ✓ | ✓ |
| `/read2lead/leaderboard` | src/pages/read2lead/leaderboard.astro | 194 | ✓ | ✓ | ✓ |
| `/msmw` | src/pages/msmw.astro | 388 | ✓ | ✓ | ✓ |
| `/coaching` | src/pages/coaching.astro | 297 | ✓ | ✓ | ✓ |
| `/space` | src/pages/space.astro | 172 | ✓ | ✓ | ✓ |
| `/admin/codes` | src/pages/admin/codes.astro | 366 | ✓ | ✗ | ✗ |
| `/privacy` | src/pages/privacy.astro | 73 | ✓ | ✓ | ✓ |
| `/404` | src/pages/404.astro | 27 | ✓ | ✓ | ✓ |

## Exceptions

- `/admin/codes` uses `BaseLayout` but does not import the shared `Header` or
  `Footer` components. The page has a custom inline admin header with the Felix
  logo and an admin-only label, which appears intentional for the password-gated
  admin surface. It currently has no shared footer.

## Recommendations

1. Decide whether `/admin/codes` should keep its custom admin header or wrap the
   shared `Header` with an admin-specific badge/variant.
2. Add a footer treatment to `/admin/codes` for baseline site consistency, or
   document the admin-only exception as intentional.
3. Phase γ should split large pages before layout refactors, especially
   `/read2lead/lesson` (1589 lines), `/read2lead` (575 lines), and
   `/read2lead/review` (457 lines).
