# Lesson Focus Header - Phuong UX Exception

**Date:** 2026-06-12  
**Decision owner:** Phuong  
**Executor:** Codex  
**Status:** Approved for direct production release after tests

## Why

The lesson page header showed the full site navigation beside rank, reading level,
XP, coins, and streak. On a learning screen this created too many competing
targets before the child reached the lesson controls.

## Approved change

- Keep a small Felix logo, the child's compact achievement state, and one
  `Them` overflow control in the top lesson header.
- Move coins, streak, Coaching, parent progress, Read2Lead, MSMW, and contact
  links into the overflow panel.
- Leave the lesson progress bar (`Ho so`, `Phan n/6`, sound toggle) unchanged.
- Leave `lesson.astro`, completion logic, recording, API contracts, and reward
  values unchanged.
- Keep the normal full site header unchanged on non-lesson pages.

## Claude audit note

This task did not have a Claude-authored spec. Phuong explicitly approved the
UX exception and requested a direct push to `main`, with this note recorded for
Claude's follow-up audit.
