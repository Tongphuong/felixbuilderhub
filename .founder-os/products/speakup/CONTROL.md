# Control — SpeakUp

- Product: SpeakUp
- Current goal: Build all 8 phases of `_ops/specs/SPEC_SPEAKUP_V0.md` on branch `claude/speakup-v0`, QA the full pilot on preview, THEN merge to main. No phase merges to main individually.
- Branch: `claude/speakup-v0` (off `main`)
- Preview URL: `claude-speakup-v0.felixbuilderhub.pages.dev` (Cloudflare Pages auto-deploy per push, per `claude/<topic>` convention in `BRANCH_CONVENTIONS.md`)
- Active workers: 0
- Last updated: 2026-07-05 (Phase 6 — guardrail layer + red-team suite — build done, tests green; awaiting Phuong's live red-team run before Status: complete)

## Phase tracker (source of truth: `_ops/specs/SPEC_SPEAKUP_V0.md`)

Wave grouping respects file-ownership: phases sharing a file (mostly `speaking.astro`)
run sequentially even where the spec's dependency graph would allow parallel work.

| Wave | Phase | Owner | Status | Merged to branch | Phuong QA'd on preview |
|---|---|---|---|---|---|
| 1 | Phase 1 — Homework store + class-board form | Aider Senior (API/schema) + Aider Junior (modal) | done | yes (fb348b8) | no |
| 1 | Phase 7a — Homework-feedback design mocks | Claude Design | approved (Phuong, 2026-07-05) | n/a (design folder: `design_handoff_speakup_phase_7a/`) | n/a |
| 2 | Phase 2 — Homework Practice mode (no TTS) | Aider Senior (backend) + Claude Sonnet 5 (frontend) | done | yes (b35da76) | no |
| 3 | Phase 3 — Minny TTS + audio cache + canned phrases | Aider Senior | done | yes (1aeaba3) | no |
| 4 | Phase 4 — Session summaries → parent profile | Aider Senior | done | yes (5921180) | no |
| 4 | Phase 5 — Conversation turn endpoint (test codes only) | Aider Senior | done | yes (5921180) | no |
| 4 | Phase 7b — Conversation UI design mocks | Claude Design | approved (Phuong, 2026-07-05) | n/a (design folder: `SpeakUp Phase 7b Free Talking/design_handoff_speakup_phase_7b/`) | n/a |
| 5 | Phase 6 — Guardrail layer + red-team suite | Aider Senior (plumbing) + Sonnet 5 (wordlists/redirects/red-team) | active | no | no |
| 6 | Phase 8a — Free Talking UI (build only, `is_test`-gated, no pilot enablement) | Aider Senior (dispatch) + Claude (review) | done | yes (c324b2e, 9566a31, cd8cc28, bd19129) | no |
| 6 | Phase 8b — Gate removal (pilot enablement) | Aider Senior; separate final commit, blocked on Phase 6 | not started | no | no |

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
| Claude Sonnet (background worker) | Coding worker | General first-choice dispatch option alongside Aider — own isolated worktree/branch (`claude-bg/<topic>`), commits/pushes its own branch only. Formalizes the ad hoc usage already recorded for Phase 2 (frontend) and Phase 6 (content authorship) in the phase tracker below. |
| Lonewolf | Read-only bridge | Explains progress, decisions, learning, budget, and blockers |

Decision path: `Phuong -> Fable 5 (roadmap) -> Claude (dispatch + review) -> Aider/Claude Sonnet (execute) -> Claude review -> Phuong approval`.
Workers never own the same file simultaneously. Lonewolf never edits,
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
- Task ID: speakup-phase6-guardrails
- Owner: Aider Senior (plumbing) + Claude (wordlists/redirect copy/red-team
  fixtures, authored directly per the spec's own "safety content is
  review-critical, not mechanical" note — same precedent as Phase 5's system
  prompt)
- Lane: `claude/speakup-v0`, primary checkout (collision-checked clean via
  `check-worktree-collision.sh`; Active workers 0 → 1)
- Acceptance criteria: see numbered list below (verbatim, `SPEC_SPEAKUP_V0.md` Phase 6)
  1. Every red-team fixture yields a canned redirect (never the model's raw
     output) — full-suite assertion
  2. Llama Guard runs on every model reply before TTS; fail-closed on
     error/timeout
  3. 2 flags in one session → early wrap-up + session marked `flagged: true`
     in the practice-log summary; flagged ring visible to Phuong (JSON
     readout link, same pattern as `debug-speaking.js`)
  4. 30-minute live red-team by a human finds no break, recorded in the
     phase report — **Phuong will run this herself on the Cloudflare
     preview once built** (her explicit choice; no browser in this sandbox)
  5. Latency with Llama Guard in the path re-measured, still within Phase 5
     bounds (~200–400ms added, budgeted)
  6. `node --test` green
- Files owned: `functions/api/_minny-guardrails.js` (new, pure functions),
  a new sibling wordlist file (banned-topic content, separate + reviewable
  per spec D0), `functions/api/minny-conversation.js` (guardrail wiring +
  flag counter + KV ring only — not the `is_test` check), a new
  `functions/api/debug-convo-flags.js` (flag-log admin readout),
  `tests/minny-guardrails.test.mjs` (new), a small tightly-scoped change to
  `src/pages/read2lead/speaking.astro` (pass `flagged` through to the
  practice-log summary — `ftReset`/`ftSubmitTurn`/`ftHandleCapReached`/
  `ftShowSummary` only)
- Stop condition: any diff touching the `is_test` check itself (that's
  Phase 8b, separate, blocked further on Phuong's go-ahead + pilot-rollout
  shape) — stop and escalate before continuing
- Cost ceiling: USD 10–15 across Aider Senior dispatch packets (small scoped
  packets, code editing not inference-heavy); Llama Guard calls on Workers
  AI are near-free at this volume per spec
- Started: 2026-07-05
- Known deviation flagged upfront: the spec's D0 called for vendoring the
  public LDNOOBW word list; this sandboxed session has no outbound network
  access (confirmed via a direct connectivity test) to fetch it, so the
  banned-topic wordlist is authored directly instead of vendored — same
  class of environment-constraint gap as prior phases' missing
  browser/credentials, disclosed here rather than silently substituted.

## File ownership

| Path or area | Owner | State |
|---|---|---|
| `functions/api/_minny-guardrails.js` (new) | Aider Senior (dispatch) + Claude (review) | done |
| Wordlist sibling file (new) | Claude (direct-authored content, dispatched verbatim) | done |
| `functions/api/minny-conversation.js` | Aider Senior (dispatch, guardrail-wiring lines only) + Claude (review) | done |
| `functions/api/debug-convo-flags.js` (new) | Aider Senior (dispatch) + Claude (review) | done |
| `tests/minny-guardrails.test.mjs` (new) | Aider Senior (dispatch) + Claude (review) | done |
| `src/pages/read2lead/speaking.astro` | Aider Senior (dispatch, flagged-passthrough lines only) + Claude (review) | done |

## Acceptance criteria reconciliation

1. Every red-team fixture yields a canned redirect, never the model's raw
   output — PASS. 31 new tests in `tests/minny-guardrails.test.mjs`,
   including 9 red-team fixtures (instruction injection, character-break,
   personal-info solicitation, violence in English and Vietnamese,
   over-long reply, URL-bearing reply, Llama-Guard-down, Llama-Guard-safe),
   each asserting the flagged content never appears in `reply_en`.
2. Llama Guard runs on every model reply before TTS; fail-closed on
   error/timeout — PASS. `screenWithLlamaGuard` is called on every
   LLM-parsed reply (after the deterministic shape/character/topic checks
   pass) before `synthesizeOrNull`/TTS. Fail-closed verified for a missing
   `env.AI` binding, a thrown error, and a non-"safe" response via 4 unit
   tests plus 1 end-to-end red-team test.
3. 2 flags in one session → early wrap-up + `flagged: true` in the
   practice-log summary; flagged ring visible to Phuong — PASS. Verified via
   test: 2 flags in a session yield `ended:true, flagged:true,
   turns_left:0, seconds_left:0`, and `debug:convo-flags` holds 2 entries.
   Client pass-through reviewed in the `speaking.astro` diff: the server's
   `flagged` bit sets `ft.flaggedSession`, which flows into
   `/api/minny-practice-log`'s `summary.flagged` field. New
   `functions/api/debug-convo-flags.js` mirrors the existing
   `debug-speaking.js` secret-gated pattern exactly, reusing
   `DEBUG_SPEAKING_KEY` rather than provisioning a second secret.
4. 30-minute live red-team by a human finds no break, recorded in the phase
   report — **SKIPPED**. Phuong will run this herself on the Cloudflare
   preview once this branch is live (her explicit choice this session — no
   browser available in this sandbox). A scripted checklist has been
   prepared for her; result to be recorded here once she reports back.
5. Latency with Llama Guard in the path re-measured, still within Phase 5
   bounds — **SKIPPED**. No live Cloudflare/Workers AI credentials available
   in this sandboxed session to measure real latency (same class of gap as
   Phase 3's live-egress item and Phase 8a's browser gap). The code path
   adds exactly one additional `env.AI.run` call, capped at a 4-second
   timeout, and only when the deterministic checks already pass. Recommend
   measuring this alongside item 4 on the live preview.
6. `node --test` green — PASS. 824/824 tests (793 prior + 31 new), zero
   regressions. `astro build` also completes cleanly.

**Known gaps, carried forward, needs Phuong or a session with real
Cloudflare/Workers AI credentials**: (a) the banned-topic wordlist is
Claude-authored rather than vendored from the public LDNOOBW list per the
spec's original D0 decision — this sandboxed session has no outbound
network access (confirmed via a direct connectivity test) to fetch it; (b)
items 4 and 5 above (live red-team + latency measurement) need the
Cloudflare preview. Status stays `active`, not `complete`, until Phuong has
run the red-team and these are closed out.

## Daily update

- Visible result: Phase 4 (session summaries → parent profile) and Phase 5
  (Free Talking conversation turn endpoint, test-codes-only) built, reviewed,
  tested, and committed to `claude/speakup-v0` (5921180) — not yet on preview
  QA by Phuong. Phases 1–3 and 7a remain as previously recorded; the whole
  pilot still QAs together at the end, per the standing rule.
- Completed: Phase 4 — `minny-practice-log.js` now accepts an optional
  `summary` object per log entry (schema_version 2, tolerant of old v1
  entries with no summary key); caught during review that the spec's file
  list omitted `read2lead-progress.js`, which never exposed
  `progress.minny_practice` to the parent view at all — added it there too,
  otherwise the new "🎤 Luyện nói cùng Minny" card on `/ho-so` would have
  rendered permanently empty. Phase 5 — `_minny-convo.js` (pure helpers:
  level-register table, starter topics, system-prompt builder, reply
  parser, cap/session logic; Sonnet 5 authored the system prompt and
  register text directly per the spec's "prompt content is architecture"
  instruction, Aider wired it verbatim) and `minny-conversation.js` (the
  start/turn endpoint — `is_test` gate checked before any session/KV/LLM
  work on both actions, since guardrail layers 2/3 are still stubs;
  gpt-5.4-mini primary, Workers AI llama-3.3-70b fallback, canned-redirect
  on any parse/provider failure). Caught and fixed a real design bug during
  review: the first cut ended a session after 2 canned-redirect turns,
  conflating a provider-outage signal with Phase 6's real safety-flag
  concept — an LLM outage lasting a whole session would have cut a kid off
  after 2 turns instead of letting them use their full 12-turn/5-min cap on
  canned lines. Fixed so technical failures just consume the normal cap;
  the test that had encoded the old (wrong) behavior was rewritten to match,
  and a second test-only bug (an equality check against `undefined` that
  can never pass) was fixed alongside it. 791/791 tests green (37 new).
  `founder_check.py --gate build`: PASS.
- Also drafted the Phase 7b design brief
  (`_ops/specs/BRIEF_SPEAKUP_PHASE7B_DESIGN.md`) — covers the 5 Free Talking
  screens/states (conversation view, "Minny đang nghĩ…" waiting state,
  tap-to-play autoplay fallback, cap-reached wrap-up, session summary),
  ready for Phuong to paste into Claude Design.
- Tooling note: this session hit Aider's URL auto-scrape feature twice
  (a literal `https://` in a dispatch instruction made Aider try to browse
  it instead of treating it as example text, burning a timeout each time
  trying to install Playwright) and Aider's own reply preamble twice leaked
  into a generated filename (`We'll output only the block.functions/...`,
  `I'll now output the file listing.tests/...`), creating a stray duplicate
  file alongside the correctly-named one. Both were caught in review and
  cleaned up (content was correct in every case, only the path was wrong).
  Worth remembering for future dispatch instructions: avoid literal
  `https://` strings, describe endpoints by reference to an existing file
  instead.
- Cost today: not yet reconciled against `aider-cost` (same tracking gap
  noted in Phase 3's update).
- Problem: none blocking. Two open items carry over unchanged from Phase 3
  (need Phuong, not code): the live egress check for OpenAI calls from the
  deployed preview (now needed for both TTS and the new gpt-5.4-mini call —
  same 403 geo-block risk class as the 2026-06-11 outage), and sign-off on
  the 12 canned Minny phrases as brand-voice content.
- Next: Phase 7b design approval (needs Phuong to run the drafted brief
  through Claude Design), then Phase 6 (guardrail layer + red-team suite —
  the gate before any real kid can reach Free Talking) and Phase 8 (Free
  Talking UI, gated on both Phase 6 and the Phase 7b mocks).
- Need Phuong: (1) carried over — Phase 1's group-vs-per-kid homework default
  question, and the Zalo-notify-on-save question (proceeding with the
  spec's own recommended defaults on both, low-cost to flip later); (2) the
  `design_handoff_speakup_phase_7a/` bundle's copy still needs a closer read
  for assumption clashes beyond the thầy/cô fix already made; (3) the 12
  canned Minny phrases in `_minny-phrases.js` need your review before they
  ship; (4) run or authorize the live egress check (TTS + LLM) on the
  preview.

---

- 2026-07-05: **Phase 8a done — Free Talking UI built** (commits `c324b2e`,
  `9566a31`, `cd8cc28`, `bd19129`). Phase 7b's design handoff
  (`SpeakUp Phase 7b Free Talking/design_handoff_speakup_phase_7b/`) was
  found already on disk from an earlier session, confirmed approved by
  Phuong directly this session, and implemented in 3 aider-senior dispatch
  packets (markup+CSS scaffold; JS state machine+turn-wiring; TTS
  embedding+tap-to-play) plus one aider-junior test fix. Two content
  decisions confirmed with Phuong before building: 🗣️ (not 💬, already used
  by "questions") for the mode-card emoji, and dropping the design mock's
  XP/rank/streak lines from the summary screen (matches the spec's own
  no-XP-hooks non-goal). Closed a real gap in Phase 5's own spec along the
  way: `minny-conversation.js` now actually returns `audio_b64` as its spec
  always said it should — added as its own dispatch packet, `is_test`
  gate line untouched. The `is_test`-gated Free Talking mode card only
  appears in the picker for test codes, so no real pilot student can reach
  a half-built feature. **Not done yet**: the actual `is_test` gate
  *removal* (pilot enablement) — that is Phase 8b, explicitly blocked on
  Phase 6 (guardrails) per the roadmap, and was not touched in this
  session. 793/793 tests, `astro build` clean, `founder_check.py --gate
  build` PASS. See the Acceptance criteria reconciliation section above for
  the full per-bullet check and the known visual-QA/live-credentials gap
  carried to the next session with browser/API access.
