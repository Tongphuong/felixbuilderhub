# Control — SpeakUp

- Product: SpeakUp
- Current goal: Build all 8 phases of `_ops/specs/SPEC_SPEAKUP_V0.md` on branch `claude/speakup-v0`, QA the full pilot on preview, THEN merge to main. No phase merges to main individually.
- Branch: `claude/speakup-v0` (off `main`)
- Preview URL: `claude-speakup-v0.felixbuilderhub.pages.dev` (Cloudflare Pages auto-deploy per push, per `claude/<topic>` convention in `BRANCH_CONVENTIONS.md`)
- Active workers: 0
- Last updated: 2026-07-05 (Phase 7b approved by Phuong; Phase 8a — Free Talking UI build — done)

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
| 5 | Phase 6 — Guardrail layer + red-team suite | Aider Senior (plumbing) + Sonnet 5 (wordlists/redirects/red-team) | not started | no | no |
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

- Status: complete
- Task ID: speakup-phase8a-free-talking-ui
- Owner: Aider Senior (dispatch packets) + Claude (review/integration)
- Lane: `claude/speakup-v0`, primary checkout (no new worktree needed —
  `hub-claude-speakup-v0-worktree2` remains idle/clean)
- Acceptance criteria:
  1. Screen 1 (main conversation view: hero+bubble, scrolling transcript,
     mm:ss countdown, 12-turn dot indicator, existing record button reused)
  2. Screen 2 ("Minny đang nghĩ..." thinking state: breathing avatar + 3-dot
     bounce, record button disabled)
  3. Screen 3 (tap-to-play fallback chip for autoplay-blocked audio)
  4. Screen 4 (cap-reached wrap-up, distinct 5-min vs 12-turn copy)
  5. Screen 5 (session summary: turns/sentences/minutes + encouragement +
     2 CTAs — XP/rank/streak lines dropped per Phuong's decision, spec's own
     non-goal)
  6. Wired to existing `/api/minny-conversation` start/turn actions;
     `is_test` gate line untouched
  7. Transcript obtained via existing `/api/read2lead-speaking-check`
     (`pack_id: 'general'`) — no new transcription endpoint
  8. Client never invents cap/end state independently — always re-synced
     from the server's last response
  9. `prefers-reduced-motion` variants + ARIA attributes per the Phase 7b
     design README, built alongside the visuals
  10. Existing Phase 2/7a components (mode card, mic-check, record button,
      homework flow) untouched
  11. `node --test` green, `founder_check.py --gate build` PASS
- Files owned: `src/pages/read2lead/speaking.astro`,
  `src/styles/speakup-free-talk.css` (new),
  `functions/api/minny-speaking-context.js`,
  `functions/api/minny-conversation.js` (TTS-embedding lines only — not the
  `is_test` check), `tests/minny-speaking.test.mjs`,
  `tests/minny-conversation.test.mjs`
- Stop condition: any diff touching the `is_test` check,
  `r2l-recorder-script.mjs`, `r2l-mic-check.js`, or an existing homework-mode
  function body — stop and escalate before continuing
- Cost ceiling: USD 15–20 across the 3 dispatch packets (estimate; this is
  code/markup editing, not inference-heavy)
- Started: 2026-07-05
- Cost spent: ~USD 0.06 (3 aider-senior dispatches + 1 aider-junior fix,
  per each call's own reported token cost; not yet cross-checked against
  `aider-cost`, same reconciliation gap noted since Phase 3)

## File ownership

| Path or area | Owner | State |
|---|---|---|
| `src/pages/read2lead/speaking.astro` | Aider Senior (dispatch) + Claude (review) | done |
| `src/styles/speakup-free-talk.css` (new) | Claude (direct — not a guarded extension) | done |
| `functions/api/minny-speaking-context.js` | Aider Senior (dispatch) + Claude (review) | done |
| `functions/api/minny-conversation.js` | Aider Senior (dispatch, TTS lines only) + Claude (review) | done |
| `tests/minny-speaking.test.mjs`, `tests/minny-conversation.test.mjs` | Aider Senior (dispatch) + Aider Junior (1 test-order fix) + Claude (review) | done |

## Acceptance criteria reconciliation

1. Screen 1 (main conversation view) — PASS. Markup/CSS/JS verified in
   reviewed diffs and confirmed present in the actual production bundle
   (`speaking.fskcByB1.css`, `speaking.astro_astro_type_script...js`) via a
   local `wrangler pages dev` + KV run. **Not visually screenshotted** — no
   browser is available in this sandboxed session (no network access to
   install Playwright/Chromium, no `chromium-cli`) — see note below.
2. Screen 2 ("Minny đang nghĩ..." thinking state) — PASS. Breathing-avatar
   CSS + 3-dot bounce + record-button-disabled wiring confirmed in diff and
   present in the bundle. Not visually screenshotted (same gap as #1).
3. Screen 3 (tap-to-play fallback) — PASS on markup/CSS/JS wiring
   (confirmed in diff and bundle). The actual iOS-Safari-autoplay-blocked
   trigger path was not exercised live (no real device/browser available);
   the code path (`audio.play().catch(...)` → show chip) mirrors the
   already-shipped `playMinnyVoice` fallback pattern.
4. Screen 4 (cap-reached wrap-up, 2 copy variants) — PASS. Verified in diff:
   distinct Vietnamese strings for the 5-min vs 12-turn cap, matching the
   approved Phase 7b README's copy table.
5. Screen 5 (session summary) — PASS. XP/rank/streak lines correctly
   dropped per Phuong's decision; turns/sentences/minutes stats verified in
   diff.
6. Wired to existing `/api/minny-conversation` start/turn actions, `is_test`
   gate untouched — PASS. Exercised for real against a local
   `wrangler pages dev` + local KV instance: confirmed `free_talk` mode
   appears only for `is_test:true` codes and is absent for `is_test:false`;
   confirmed `start` and `turn` actions return the exact shape the frontend
   expects. Diff review confirms the `is_test` check's line and body are
   byte-for-byte unchanged.
7. Transcript via existing `/api/read2lead-speaking-check`
   (`pack_id:'general'`) — PASS on code path (verified in diff, matches the
   already-proven `canAccessPackForPractice` general-pack allowance).
   **SKIPPED** for a real end-to-end audio recording: no Workers AI/OpenAI
   credentials available in this sandboxed session to exercise real
   transcription, same class of gap as Phase 3's live-egress item.
8. Client never invents cap/end state independently — PASS. Verified in
   diff: `ftSubmitTurn` always re-syncs `turns_left`/`seconds_left` from the
   server's last response; wrap-up triggers only from a server-confirmed
   `turns_left === 0`, the locally-mirrored countdown reaching 0, or a
   server-returned `ended:true`.
9. `prefers-reduced-motion` + ARIA — PASS on code (confirmed present in the
   built CSS bundle and in the markup diff — `role="timer"`, `role="log"`,
   `aria-label`s, single reduced-motion media block). Not visually verified
   with an actual reduced-motion browser toggle (same sandboxing gap as #1).
10. Existing Phase 2/7a components untouched — PASS. Diffs are additive
    only, plus the single one-line `enterPracticeMode` branch; no existing
    function body, class, or id was altered.
11. `node --test` green, `founder_check.py --gate build` PASS — PASS.
    793/793 tests (`node --test tests/**/*.test.mjs`), `astro build`
    succeeds, `founder_check.py --repo felixbuilderhub --product speakup
    --gate build` returns PASS.

**Known gap, carried forward, needs Phuong or a session with real
credentials/a real browser**: (a) visual/pixel QA of the 5 new screens at
phone/tablet/desktop and with reduced-motion toggled on — this sandboxed
session has no network access to install a browser and no `chromium-cli`;
(b) a real audio recording exercised through Whisper/Workers AI and real
OpenAI TTS end-to-end — this session had no such credentials locally
(same class of gap as Phase 3's still-open live-egress item). Recommend
QA'ing both live on the Cloudflare preview
(`claude-speakup-v0.felixbuilderhub.pages.dev`) once this branch is pushed,
with a real `is_test:true` access code.

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
