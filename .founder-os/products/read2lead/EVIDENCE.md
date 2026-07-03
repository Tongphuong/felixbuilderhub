# Evidence — Read2Lead

- Decision: product
- Last reviewed: 2026-07-03

## User reports

| Date | User | Observed behavior | Problem | Source |
|---|---|---|---|---|
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
