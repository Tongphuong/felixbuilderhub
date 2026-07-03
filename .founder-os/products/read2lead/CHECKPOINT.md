# Checkpoint — Read2Lead

- Last updated: 2026-07-03
- Branch: fix/lesson-progress-visibility
- Commit: pending

## Status

- Code change complete: yes
- Tests pass: yes (704/704)
- Pushed: no
- Merged: no
- Phuong approval: pending

## What changed

Added `visibilitychange` and `freeze` event listeners next to the existing `pagehide` listener in lesson.astro. All three now flush the debounce timer before saving. This ensures progress is saved when kids switch apps or receive phone calls on iPad/iPhone.

## Next action

- Phuong approves → commit, push, and merge to main
