# CHANGELOG — felixbuilderhub.com

Format: [Keep a Changelog](https://keepachangelog.com/). Versioning:
[SemVer](https://semver.org/) — MAJOR.MINOR.PATCH.

## v1.0.1 - 2026-06-05 — Pilot Launch

### Removed
- Maintenance banner on `/read2lead` landing page. Backend now resilient
  enough for 20-kid pilot self-serve (see read2lead v1.0.1 release).

## [Unreleased]

(future α.1.3+ entries land here)

## [1.0.0] — 2026-06-05

First stable release. Bundles all pre-α work (M1→M5, V4→V6, Phase G→N).

### Features

- **Read2Lead end-to-end**: parent intake form → Render backend
  generation → 5-cluster interactive web lesson (read, listen, dictation,
  comprehension, retell) → soft-graded submit → review dashboard +
  leaderboard
- **Read2Lead lesson dopamine layer**: per-slot SFX + confetti + Minny
  mascot pop on all-correct; no-shame encouraging toast on wrong
- **Read2Lead voice recording option** on open-response items
  (MediaRecorder, playback widget, soft-grade placeholder text)
- **Read2Lead inline grading** via `/api/grade-slot` (red ring + label
  per wrong item, jump-to-fix on retry)
- **Read2Lead asset library** (Minny sprites, kid sprites, settings,
  animals) emitted per pack via `pickPackAssets`
- **Story-first prompt workflow** (Phase N2.2): organic story written
  first, chunks extracted post-hoc, pronoun-neutral chunk rule
- **story_cloze activity** replaces fabricated chunk_in_context (Phase N):
  3 sentences from story_text with chunk blanked, structural validator
  only (verbatim regex dropped in O.2 for natural-flow priority)
- **Anti-homework wording**: conversational tone + Minny voice
  throughout UI ("Câu cần xem lại" not "Câu sai", "Minny đang xem"
  not "Đang chấm", etc.)
- **MSMW Telegram lead form** at `/msmw`
- **Coaching booking Telegram lead** at `/coaching`
- **Sharing subscribe Telegram lead** on share-CTA buttons
- **Admin codes panel** at `/admin/codes` (password-gated) — create,
  edit, delete student access codes
- **Self-heal stale generation_in_progress** on Felixar dashboard
  (recovers from incomplete backend tasks)

### Documentation

- README.md — comprehensive architecture + page/endpoint matrix
- docs/ENV.md — env binding reference (Phase α.1.1)
- Note/R2L_ACTIVITY_MAP.md — web ↔ PDF activity mapping for R2L

### Tech stack

- Astro 5.18 + Tailwind 3.4 frontend
- Cloudflare Pages Functions (Workers) edge runtime
- Cloudflare KV (`READ2LEAD_CODES`) state
- Telegram Bot API for lead delivery

### Known issues (deferred to v1.1+)

- `src/pages/read2lead/lesson.astro` is 1589 lines — god file, scheduled
  for split in Phase γ
- `functions/api/_read2lead-lesson.js` is 777 lines — same
- No TypeScript, no test suite, no CI/CD lint gate — scheduled for
  Phase β (schema contract + tests)
- Forced "Then [Name] will X and Y to finish the mission" inventory
  close still occasionally slips past prompt rules — backlogged Phase O.3
- Maintenance notice banner on `/read2lead` will be removed when pilot
  resumes (Phương's call)
