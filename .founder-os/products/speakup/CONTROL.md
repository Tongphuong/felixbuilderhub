# Control — SpeakUp

- Product: SpeakUp
- Current goal: Build all 8 phases of `_ops/specs/SPEC_SPEAKUP_V0.md` on branch `claude/speakup-v0`, QA the full pilot on preview, THEN merge to main. No phase merges to main individually.
- Branch: `claude/speakup-v0` (off `main`)
- Preview URL: `claude-speakup-v0.felixbuilderhub.pages.dev` (Cloudflare Pages auto-deploy per push, per `claude/<topic>` convention in `BRANCH_CONVENTIONS.md`)
- Active workers: 0
- Last updated: 2026-07-05 (Phase 3 closed out)

## Phase tracker (source of truth: `_ops/specs/SPEC_SPEAKUP_V0.md`)

Wave grouping respects file-ownership: phases sharing a file (mostly `speaking.astro`)
run sequentially even where the spec's dependency graph would allow parallel work.

| Wave | Phase | Owner | Status | Merged to branch | Phuong QA'd on preview |
|---|---|---|---|---|---|
| 1 | Phase 1 — Homework store + class-board form | Aider Senior (API/schema) + Aider Junior (modal) | done | yes (fb348b8) | no |
| 1 | Phase 7a — Homework-feedback design mocks | Claude Design | approved (Phuong, 2026-07-05) | n/a (design folder: `design_handoff_speakup_phase_7a/`) | n/a |
| 2 | Phase 2 — Homework Practice mode (no TTS) | Aider Senior (backend) + Claude Sonnet 5 (frontend) | done | yes (b35da76) | no |
| 3 | Phase 3 — Minny TTS + audio cache + canned phrases | Aider Senior | done | yes (1aeaba3) | no |
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

- Visible result: Phase 3 (Minny voice service) built, reviewed, tested, and
  committed to `claude/speakup-v0` (1aeaba3) — not yet on preview QA by
  Phuong. Phases 1, 2, and 7a remain as previously recorded (done/approved,
  not yet on preview either — the whole pilot QAs together at the end).
- Completed: dispatched backend (`_minny-tts.js`: OpenAI tts-1-hd/nova call,
  sha256 cache key, KV cache with no expiry; `_minny-phrases.js`: 12 canned
  lines; `minny-voice.js`: the POST endpoint, allowlisted to only the
  caller's own homework sentences or a canned phrase id — never open text)
  to Aider Senior in one clean pass, no repetition-loop or hallucination
  incident this time. Reviewed the diff directly against the spec's D3/D6/D7
  cost and safety reasoning — allowlist is the cost-abuse guard, cache means
  repeat requests for the same line cost nothing after the first. Then
  dispatched a small, surgical instruction to Aider Senior for
  `speaking.astro`'s `playMinnyAudio` (try `/api/minny-voice` for homework
  steps, fall back to the existing `speechSynthesis` path on any failure
  including an autoplay-gesture rejection) — applied exactly as specified,
  no drift, despite this file's rocky history in Phase 2. 754/754 tests green
  (7 new). `founder_check.py --gate build`: PASS.
- Cost today: ~USD 0.017 (two Aider Senior dispatches, per aider's own
  session cost report — `aider-cost` itself has no data yet, worth checking
  why it isn't tracking).
- Problem: none blocking. The spec's Phase 3 egress-verification acceptance
  criterion (a real OpenAI TTS call from the deployed preview, checking for
  the 403 geo-block class that hit Whisper on 2026-06-11) was **not** run —
  this session had no Cloudflare/KV credentials to safely call the live
  preview with a real access code without risking production data. This is
  the one open acceptance-criterion item for Phase 3.
- Next: Phase 3's live egress check (needs Phuong or a session with prod
  credentials). Then Phase 7b (conversation UI mocks, gates Phase 8) and
  Phase 4 (session summaries) / Phase 5 (conversation endpoint) are next in
  wave order.
- Need Phuong: (1) carried over — Phase 1's group-vs-per-kid homework default
  question, and the Zalo-notify-on-save question (proceeding with the
  spec's own recommended defaults on both, low-cost to flip later); (2) the
  `design_handoff_speakup_phase_7a/` bundle's copy still needs a closer read
  for assumption clashes beyond the thầy/cô fix already made; (3) **new**:
  the 12 canned Minny phrases in `_minny-phrases.js` need your review before
  they ship — per the spec, this is brand-voice content, not mechanical
  copy, and Claude drafted it without your sign-off; (4) **new**: run or
  authorize the live egress check on the preview once it's live before
  treating Phase 3 as fully verified.
