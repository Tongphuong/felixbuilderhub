# Control — SpeakUp

- Product: SpeakUp
- Current goal: Build all 8 phases of `_ops/specs/SPEC_SPEAKUP_V0.md` on branch `claude/speakup-v0`, QA the full pilot on preview, THEN merge to main. No phase merges to main individually.
- Branch: `claude/speakup-v0` (off `main`)
- Preview URL: `claude-speakup-v0.felixbuilderhub.pages.dev` (Cloudflare Pages auto-deploy per push, per `claude/<topic>` convention in `BRANCH_CONVENTIONS.md`)
- Active workers: 0
- Last updated: 2026-07-04

## Phase tracker (source of truth: `_ops/specs/SPEC_SPEAKUP_V0.md`)

Wave grouping respects file-ownership: phases sharing a file (mostly `speaking.astro`)
run sequentially even where the spec's dependency graph would allow parallel work.

| Wave | Phase | Owner | Status | Merged to branch | Phuong QA'd on preview |
|---|---|---|---|---|---|
| 1 | Phase 1 — Homework store + class-board form | Aider Senior (API/schema) + Aider Junior (modal) | not started | no | no |
| 1 | Phase 7a — Homework-feedback design mocks | Claude Design | not started | n/a (design folder) | no |
| 2 | Phase 2 — Homework Practice mode (no TTS) | Aider Senior | not started | no | no |
| 3 | Phase 3 — Minny TTS + audio cache + canned phrases | Aider Senior | not started | no | no |
| 4 | Phase 4 — Session summaries → parent profile | Aider Senior | not started | no | no |
| 4 | Phase 5 — Conversation turn endpoint (test codes only) | Aider Senior | not started | no | no |
| 4 | Phase 7b — Conversation UI design mocks | Claude Design | not started | n/a | no |
| 5 | Phase 6 — Guardrail layer + red-team suite | Aider Senior (plumbing) + Sonnet 5 (wordlists/redirects/red-team) | not started | no | no |
| 6 | Phase 8 — Free Talking UI + pilot enablement | Aider Senior; gate-removal is a separate final commit | not started | no | no |

Waves 1 and 4 have two parallelizable items each (no shared files); everything
else is strictly sequential because it touches `speaking.astro`. **No phase
merges to `main`.** All 8 land on `claude/speakup-v0`, get QA'd together on
the preview URL, and only then does the whole branch merge to `main` —
per Phuong's explicit instruction (2026-07-04): build full V0 before push to
prod.

## Operating team

| Agent | Role | Current authority |
|---|---|---|
| Fable 5 | Roadmap architect (this product only) | Produces the phased build roadmap. No repo access, no code, no dispatch authority — output is reviewed and turned into tasks by Claude. |
| Claude | Lead + Reviewer | Plans, turns Fable 5's roadmap into dispatch packets, reviews every diff, integrates after Phuong's approval |
| Aider Senior (DeepSeek V4 Pro) | Senior worker | Features, multi-file changes, complex logic via `aider-senior` |
| Aider Junior (DeepSeek V4 Flash) | Junior worker | Renames, simple edits, tests via `aider-junior` |
| Lonewolf | Read-only bridge | Explains progress, decisions, learning, budget, and blockers |

Decision path: `Phuong -> Fable 5 (roadmap) -> Claude (dispatch + review) -> Aider (execute) -> Claude review -> Phuong approval`.
Aider workers never own the same file simultaneously. Lonewolf never edits,
assigns, commits, merges, deploys, or spends.

## Hard rules for this product (added 2026-07-04, per Phuong)

1. **Founder OS is mandatory from the first task, no exceptions.** Before any
   code change: check this file for an active task, run
   `founder_check.py --repo felixbuilderhub --product speakup --gate build`
   before committing. See `.claude/rules/speakup.md`.
2. **Reuse before building.** Before writing any new capability from scratch
   (conversation guardrails, TTS client, audio session handling, admin
   homework-entry form, etc.), search for an existing open-source library,
   package, or forkable project. Only hand-roll it if nothing suitable
   exists, and note that search briefly in the spec for that phase.

## Current task

- Status: active
- Task ID: SPEAKUP-P1-HOMEWORK-STORE
- Owner: Claude (spec/review) -> aider-senior (API/schema) + aider-junior (modal markup)
- Lane: product (SpeakUp V0, Phase 1 of `_ops/specs/SPEC_SPEAKUP_V0.md`)
- Acceptance criteria: class-level homework save writes the `homework` block onto
  every roster member's code record without touching any other field; per-student
  save updates only that student; validation per D8b (sentences 0-12/stems 0-8,
  charset, blank-parsing); round-trip test proves no field clobbering; node --test
  green; founder_check.py --gate build passes.
- Files owned: functions/api/_homework.js (new), functions/api/admin/classes/[id]/homework.js (new),
  src/components/admin/HomeworkModal.astro (new), src/pages/admin/classes.astro (modify),
  tests/admin-homework.test.mjs (new)
- Stop condition: tests green, Claude review clean, founder_check.py --gate build
  passes, committed to `claude/speakup-v0` (not merged to main — see Phase tracker)
- Started: 2026-07-04
- Cost spent: USD 0

## File ownership

| Path or area | Owner | State |
|---|---|---|
| functions/api/_homework.js | aider-senior | active |
| functions/api/admin/classes/[id]/homework.js | aider-senior | active |
| src/components/admin/HomeworkModal.astro | aider-junior | active |
| src/pages/admin/classes.astro | aider-junior | active |
| tests/admin-homework.test.mjs | aider-senior | active |

## Daily update

- Visible result: SPEC_SPEAKUP_V0.md approved and reconciled into Founder OS
  (Founder approved: yes, Decision: build); phase tracker set up in this file;
  Phase 1 dispatched
- Completed: PRODUCT.md/EVIDENCE.md/CONTROL.md updated to reflect the approved
  8-phase roadmap; spec claims spot-verified against real code (function names,
  KV keys, existing patterns all confirmed); `claude/speakup-v0` branch created
- Cost today: USD 0
- Problem: none
- Next: review Aider's Phase 1 diff, run tests + founder_check.py, commit to
  `claude/speakup-v0`, then start Phase 7a (homework-feedback design mocks) and
  Phase 2
- Need Phuong: one open question flagged for Phase 1 — see chat. Full list of
  open questions from the spec will surface at their relevant phase, not all at
  once.
