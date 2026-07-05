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
| 1 | Phase 7a — Homework-feedback design mocks | Claude Design | approved (Phuong, 2026-07-05) | n/a (design folder: `design_handoff_speakup_phase_7a/`) | n/a |
| 2 | Phase 2 — Homework Practice mode (no TTS) | Aider Senior (backend) + Claude Sonnet 5 (frontend) | done | yes (b35da76) | no |
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

- Visible result: Phase 1 (homework store + class-board form) and Phase 2
  (homework practice mode end-to-end: sentence + speech-frame scoring,
  homework mode card, frame-step UI, rubric result, end-of-set summary) both
  built, reviewed, tested, and committed to `claude/speakup-v0` — not yet on
  preview QA by Phuong. Phase 7a design mocks approved by Phuong (2026-07-05).
- Completed: resolved a design-provenance mix-up — two design bundles existed
  (`design_handoff_speakup/` and `design_handoff_speakup_phase_7a/`); Phuong
  deleted the former and confirmed the latter (`_ds/` design-system tokens +
  `dc-runtime`-generated `support.js`) as the genuine Claude Design output to
  build from. Also caught and fixed a pronoun mismatch: the approved spec's
  Vietnamese copy said "cô Phương" (female teacher) in two places while the
  design mock and the site's existing live copy (`index.astro`, `coaching.astro`)
  both use "thầy Phương" (male); Phuong confirmed thầy is correct, fixed in
  `_ops/specs/SPEC_SPEAKUP_V0.md`.
  Phase 2 backend (`minny-speaking-context.js`'s `buildHomeworkSteps`,
  `read2lead-speaking-check.js`'s `scoreSpeechFrame`) dispatched to Aider
  Senior — succeeded on the second attempt; the first full-phase dispatch
  (4 files at once) degenerated into a runaway repetition loop generating CSS
  and produced nothing, so the task was split into a smaller backend-only
  dispatch, which succeeded cleanly ($0.03). A follow-up one-line test fix
  dispatched to Aider Junior hallucinated garbled text into the file; fixed
  directly rather than re-dispatching a trivial revert. Phuong then approved
  running a parallel Claude Sonnet 5 background agent (enabled by her Claude
  Max upgrade) for the frontend (`speaking.astro`) piece specifically because
  of Aider's reliability issues on this file cluster — it built the
  homework-mode UI (frame-step stems display, rubric checklist, smile
  reminder, end-of-set summary) cleanly and flagged one real integration gap
  (the backend's `expected_text` field was unconditionally required, which
  would have rejected every frame-mode submission since frame steps carry no
  `expected_text`) — fixed with a one-line backend validation relaxation.
  Full suite: 747/747 green. `founder_check.py --gate build`: PASS.
- Cost today: USD ~0.03 (Aider Senior backend dispatch; Aider Junior dispatch
  cost negligible) + Claude Max usage for the parallel frontend agent (not
  metered against the DeepSeek budget)
- Problem: none blocking. Aider (both Senior and Junior) proved unreliable
  today on this specific file cluster (speaking.astro / read2lead-speaking-check.js)
  — two degenerate/hallucinated outputs on tasks of very different sizes.
  Worth watching whether this recurs on Phase 3 (also touches these files).
- Next: Phase 7b (conversation UI mocks) still not started — gates Phase 8.
  Phase 3 (Minny TTS + audio cache) is next in the wave order and only
  depends on Phase 1.
- Need Phuong: (1) the Phase 1 open question — is "same homework for the
  whole group, occasionally tweaked for one kid" the right default, or does
  she routinely assign fully different homework per kid? Proceeding with the
  class-first default in the UI either way, easy to flip. (2) whether saving
  homework should notify the parent on Zalo — proceeding with no for V0 per
  the spec's own recommendation, revisit after pilot. (3) confirm the
  `design_handoff_speakup_phase_7a/` bundle's other copy (README calls it
  "SpeakUp" with a koala mascot "Minny" narrating a "MY TRIP STORY" flow) has
  no other assumptions that clash with the approved spec beyond the
  thầy/cô one already fixed — flagging in case a closer read turns up more.
