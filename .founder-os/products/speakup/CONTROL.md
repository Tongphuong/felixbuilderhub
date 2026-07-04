# Control — SpeakUp

- Product: SpeakUp
- Current goal: Build all 8 phases of `_ops/specs/SPEC_SPEAKUP_V0.md` on branch `claude/speakup-v0`, QA the full pilot on preview, THEN merge to main. No phase merges to main individually.
- Branch: `claude/speakup-v0` (off `main`)
- Preview URL: `claude-speakup-v0.felixbuilderhub.pages.dev` (Cloudflare Pages auto-deploy per push, per `claude/<topic>` convention in `BRANCH_CONVENTIONS.md`)
- Active workers: 0
- Last updated: 2026-07-05

## Phase tracker (source of truth: `_ops/specs/SPEC_SPEAKUP_V0.md`)

Wave grouping respects file-ownership: phases sharing a file (mostly `speaking.astro`)
run sequentially even where the spec's dependency graph would allow parallel work.

| Wave | Phase | Owner | Status | Merged to branch | Phuong QA'd on preview |
|---|---|---|---|---|---|
| 1 | Phase 1 — Homework store + class-board form | Aider Senior (API/schema) + Aider Junior (modal) | done | yes (fb348b8) | no |
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

- Status: none
- Task ID: none
- Owner: none
- Lane: none
- Acceptance criteria: none
- Files owned: none
- Stop condition: none
- Started: none
- Cost spent: USD 0

## File ownership

| Path or area | Owner | State |
|---|---|---|
| none | none | none |

## Daily update

- Visible result: Phase 1 (homework store + class-board form) built, reviewed,
  tested, and committed to `claude/speakup-v0` (commit fb348b8) — not yet on
  preview QA by Phuong
- Completed: dispatched to aider-senior (backend: `_homework.js`, the
  `[id]/homework.js` endpoint, `admin-homework.test.mjs`) and aider-junior
  (frontend: `HomeworkModal.astro`, `classes.astro` wiring) in parallel per
  the file-ownership split; reviewed both diffs; found and fixed two gaps via
  a small follow-up aider-junior patch — `enrichClass()` in `_classes.js`
  wasn't exposing `codeData.homework` to the class board (so the "📚 có bài"
  tag could never show), and the per-student prefill read a field shape
  (`sentences_text`/`frame_text`) that doesn't exist on the real homework
  record; full suite (735/735) green; `founder_check.py --gate build`: PASS
- Cost today: USD 0 (DeepSeek metered calls — actual OpenRouter spend to be
  confirmed against `BUDGET.md`'s unconfirmed figures)
- Problem: none
- Next: start Phase 7a (homework-feedback design mocks) and Phase 2
  (Homework Practice mode) — Phase 2 depends on Phase 7a's approved mock per
  the spec
- Need Phuong: (1) the Phase 1 open question — is "same homework for the
  whole group, occasionally tweaked for one kid" the right default, or does
  she routinely assign fully different homework per kid? Proceeding with the
  class-first default in the UI either way, easy to flip. (2) whether saving
  homework should notify the parent on Zalo — proceeding with no for V0 per
  the spec's own recommendation, revisit after pilot. (3) Phase 1 is on the
  branch only — nothing is on the live preview to look at yet by itself;
  Phuong QA's the whole pilot once more phases land, per the "no phase
  merges to main individually" rule.
