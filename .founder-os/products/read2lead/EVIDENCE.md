# Evidence — Read2Lead

- Decision: product
- Last reviewed: 2026-07-11

## User reports

| Date | User | Observed behavior | Problem | Source |
|---|---|---|---|---|
| 2026-07-11 | Automated e2e as a kid (R2L-PILOT-CYJS) | Book lesson: ~6.5 min forced passive listening before ANY interaction; questions batched minutes after their content (most missed on first try); options reshuffled on every retry; 31+ read-aloud chunks (4-9/page, 3 attempts each); ~18-20 min total; one skipped chunk → completed_without_reward → 0 XP/coins/rank for the whole session | Flow exhausts the 6-12 age group and punishes tired kids; conflicts with PRODUCT_CONTEXT "activities must be snappy" | Full e2e report reviewed by Phương 2026-07-11; founder decision: rebuild page-by-page (SPEC_R2L_PAGE_LOOP.md) |
| 2026-07-03 | Kids (multiple) | Progress lost after phone call or app switch on iPad/iPhone | When a call comes in mid-lesson, returning to Safari resets the lesson to the beginning | Phuong relaying kid complaints |

## Root cause

The lesson page saves progress to localStorage/sessionStorage, but only triggers the save on `pagehide`. On iOS Safari, `pagehide` does not fire reliably when the app is merely backgrounded (phone call, app switch). The `visibilitychange` event is the correct detection method for mobile app switches.

## Fix scope

- Add `visibilitychange` and `freeze` event listeners to trigger progress save on app background
- No new features, no state shape changes, no new dependencies
- Affected file: `src/pages/read2lead/lesson.astro` (one location, ~15 lines added)

## Next evidence action

- Action: Deploy fix and confirm with kids that progress survives phone calls
- Stop condition: Kids confirm the problem is resolved
