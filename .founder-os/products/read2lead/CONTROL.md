# Control — Read2Lead

- Product: Read2Lead
- Current goal: Page-by-page lesson loop (book flow v3) — listen → 4 quick questions → read the page aloud, page by page, replacing the exhausting listen-everything-then-practice flow (e2e 2026-07-11 showed ~18-20 min sessions, 31+ speaking chunks, questions minutes after content). Spec: `_ops/specs/SPEC_R2L_PAGE_LOOP.md` (Phương-approved 2026-07-11).
- Latest staging URL: PRODUCTION (merged to main 2026-07-12, commit 73c4d25)
- Active workers: 0
- Last updated: 2026-07-12 (R2L-PAGE-LOOP shipped)

## Operating team

| Agent | Role | Current authority |
|---|---|---|
| Claude | Lead + Reviewer | Plans, dispatches, reviews, and integrates |
| Aider Senior (DeepSeek V4 Pro) | Senior worker | Features, multi-file changes, complex logic via `aider-senior` |
| Aider Junior (DeepSeek V4 Flash) | Junior worker | Renames, simple edits, tests via `aider-junior` |
| Claude Sonnet (background worker) | Coding worker | General first-choice dispatch option alongside Aider — own isolated worktree/branch (`claude-bg/<topic>`), commits/pushes its own branch only. See `~/.claude/rules/claude-bg-dispatch.md`. |
| Lonewolf | Read-only bridge | Explains progress, decisions, learning, budget, and blockers |

Decision path: `Phuong -> Claude -> Aider/Claude Sonnet -> Claude review -> Phuong approval`.
Codex and Cline are retired org-wide (see `_ops/AGENTS.md`) — this table was
stale until 2026-07-05.

## Current task

- Status: complete
- Started: 2026-07-11
- Completed: 2026-07-12 — merged to main 73c4d25 (Phương GO after preview
  verification), production smoke PASS (fresh pack: v3 client live, 12/12
  text_vi, 11 vocabulary entries in payload, 24/24 questions page-aligned)
- Verified commit: 73c4d25 (origin/main)
- Task ID: R2L-PAGE-LOOP
- Owner: Claude Lead (Elon) — lesson.astro direct (guard-protected, spec-covered);
  Mark (background worker) owns src/lib/read2lead-book-flow.mjs,
  functions/api/submit-read2lead-lesson.js, src/lib/read2lead-book-health.mjs +
  their tests; Buffet reviews the combined diff and runs the real-speech e2e.
  Author≠reviewer preserved: Elon reviews Mark line by line; Buffet reviews
  Elon's lesson.astro changes.
- Lane: product (kid-facing lesson flow restructure per approved spec;
  scoring/reward/gate SEMANTICS unchanged by founder decision — only the
  speaking unit changes from sentence-chunks to page reads)
- Problem: e2e 2026-07-11 (R2L-PILOT-CYJS) — 6.5 min passive listening before
  any interaction, questions batched minutes after content, options reshuffled
  on retry, 31+ shadow chunks, 18-20 min sessions; exhausting for the 6-12 age
  group (PRODUCT_CONTEXT: "attention span short — activities must be snappy").
- Approach: book flow v3 per SPEC_R2L_PAGE_LOOP.md — per-page
  story→questions(4, AJ Hoge style, stable option order)→page read-aloud(1-2
  units, word cap 60, mic unlocked after the page listen)→advance; version-gated
  validateBookFlowSubmission (v2 accepted indefinitely — pending-submit replay
  is the 2026-06-27 P0 shape); server counts page reads under the existing
  summary keys; checkpoint resume self-heals by id re-derivation.
- Acceptance criteria: per-page loop works end-to-end on the deployed preview
  with code R2L-PILOT-CYJS INCLUDING real-speech recording (record → Whisper →
  score ≥50 → submit → real XP/rank movement); 4 questions/page from the
  existing pool with graceful degradation; option order stable across retries;
  mic unlocks without the sample-listen lock; a v2-shaped payload still submits
  successfully; standard-pack path byte-identical (finalizeWithoutReward
  regression pin); old checkpoints resume without loss of required progress;
  node --test green; astro build clean; session-time estimate ≤15 min verified
  in e2e timing.
- Files owned: src/pages/read2lead/lesson.astro (Elon),
  src/lib/read2lead-book-flow.mjs, functions/api/submit-read2lead-lesson.js,
  src/lib/read2lead-book-health.mjs (Mark), tests/read2lead-book-flow.test.mjs,
  tests/read2lead-book-health.test.mjs, tests/read2lead-book-reader-behaviour.test.mjs,
  tests/helpers/book-pack-fixture.mjs, new test files (Mark),
  .founder-os/products/read2lead/CONTROL.md + EVIDENCE.md (this entry).
  No overlap with the concurrent SpeakUp session's active set (verified in
  claude-bg-worker-active.json).
- Non-goals: reward/gate semantics (completed_without_reward, pass ≥50,
  3 attempts, S/A/B/F) — UNCHANGED per founder; XP economy rebalance; Hoge-style
  question regeneration in the Python backend (follow-up); mid-book rest stop;
  recorder pipeline files (untouched).
- Stop condition: acceptance criteria pass on the deployed preview + Buffet
  SHIP + founder build/complete gates PASS, then STOP — merge to main only on
  Phương's explicit approval after she taps through the preview.
- Cost ceiling: Claude team (Max plan, not metered); Whisper/TTS e2e usage on
  existing Cloudflare/OpenAI plumbing, one pilot code's sessions.
- Reuse survey: (1) in-repo versioned-rules in `read2lead-book-flow.mjs`
  (shared client+server via ?raw + server import) — ADOPTED for v2/v3 gating,
  same single-source pattern the health gate already trusts; (2) `xstate` for
  the lesson state machine — REJECTED: the inline ?raw script can't take a
  bundled dependency and the string-stage machine is small; (3) `canvas-confetti`
  for page-complete moments — REJECTED: `fireStreakConfetti`/`__r2lJuice`
  (src/lib/lesson-juice.ts) already ship; (4) AJ Hoge mini-story questioning —
  adopted as a PATTERN (frequent easy questions), served from the existing
  generated pool.
- Design self-verification: DONE 2026-07-12 — live e2e screenshots at 390px on
  the deployed preview (listen/read/summary stages) vs SPEC_R2L_PAGE_LOOP.md §3;
  all components are pattern-copies of existing approved lesson cards; summary
  card + header XP movement verified rendered. Screenshots in session scratchpad
  r2l-e2e/shots/. Flagged for Phương's visual veto before merge.
- Verified commit: 5c56be5 (origin/claude/r2l-page-loop; preview
  claude-r2l-page-loop.felixbuilderhub.pages.dev)
- Founder handoff: preview URL + e2e results reported 2026-07-12; Phương taps
  through one lesson before any merge to main. Acceptance evidence: live
  real-speech e2e (R2L-PILOT-CYJS) — 8 pages, 32 questions, 9/9 page reads
  Whisper-scored 81-95, submit passed grade S +25 coins/+20 XP (header
  200→220 XP verified), mic unlocked without sample re-listen, mic-check
  safety gate still blocks silent mics, est. kid session ~13 min (was 18-20);
  1066/1066 tests; astro build clean; Buffet review: one Medium finding fixed
  + regression-pinned, submit-path/validator/reward semantics verified clean.

## Acceptance criteria reconciliation (R2L-PAGE-LOOP)

- Per-page loop end-to-end on deployed preview with real-speech recording:
  PASS — live e2e (R2L-PILOT-CYJS): 8 pages, 32 questions, 9/9 page reads
  Whisper-scored 81-95, submit 200 passed grade S, +25 coins/+20 XP, header
  XP 200→220 on-screen.
- 4 questions/page from the existing pool with graceful degradation: PASS —
  selection tests (limit-4, top-up, thin pages) + live packs (10/page pools,
  4 selected).
- Option order stable across retries: PASS — deterministic seeded order,
  unit-pinned; verified in e2e retry path.
- Mic unlocks without sample-listen lock: PASS — e2e `micUnlockedWithoutSample`
  flag true on every read; mic-check safety gate still blocks silent mics
  (verified by the harness's own first failed run).
- v2-shaped payload still submits: PASS — version-matrix unit tests +
  submit-endpoint v2 end-to-end test.
- Standard-pack path byte-identical: PASS — `finalizeWithoutReward`
  regression pin + Buffet trace of `isBookFlowV2` fencing.
- Old checkpoints resume without loss of required progress: PASS —
  re-derivation merge tests; e2e relaunch-per-read resumed via checkpoint 10x.
- node --test green: PASS — 1172/1172 on the merged tree (incl. SpeakUp).
- astro build clean: PASS — 25 pages, zero leaked inline exports.
- Session-time ≤15 min: PASS — e2e estimate ~13 min (was 18-20).
- Fix round 2 (founder findings): PASS — Dịch/Từ khó live-verified by Phương
  on preview; 429/430 servable books enriched (text_vi + vocabulary +
  page-answerable questions); next-page-question guard unit-pinned.

## Previous task — R2L-BOOK-HEALTH-GATE

- Status: complete
- Started: 2026-07-09
- Completed: 2026-07-09 — pushed to main 06d18f9 (Phương approved commit+deploy), 765 tests, astro build clean, Buffet review clean
- Verified commit: 06d18f9 (origin/main + origin/claude/r2l-book-health-gate)
- Task ID: R2L-BOOK-HEALTH-GATE
- Owner: Claude Lead (Elon) — direct build (Tier1); `functions/api/generate-read2lead-pack.js`
  and the new `src/lib/read2lead-book-health.mjs` are author-owned. Author≠reviewer
  preserved by a mandatory independent Buffet review (Tier2) before commit; plan
  approved by Felix 2026-07-09
- Lane: product (backend finishability gate on the book-pool assignment path;
  no change to scoring, rewards, or the mic/recorder pipeline)
- Problem: the book pool is picked at random with zero content check, so a book
  with inconsistent internal data can dead-end a child (a page whose audio can
  never complete leaves the next button disabled; a word-order item whose tokens
  can't rebuild the sentence traps a W1 kid) — the founder-reported "some story
  packs are impossible to finish".
- Approach: new `src/lib/read2lead-book-health.mjs` (`assessBookHealth`) mirrors
  the app's own completion logic — reuses the real `selectBookQuestions` /
  `buildBookShadowChunks` and re-derives the runtime `normalizeOrderSentence` —
  to prove a book is finishable before assignment, classifying defects HARD
  (unfinishable → skip) vs SOFT (cosmetic → deprioritize). `assignBookPack` in
  `generate-read2lead-pack.js` becomes a bounded retry loop (skip broken → try
  next) with a per-level KV quarantine (`book_quarantine:<level>`) so known-bad
  books are skipped cheaply and are reportable to ops. Exhaustion is never a
  strand: a cosmetic-only pool still serves the least-bad finishable book
  (`book_pool_degraded`), and only an all-unfinishable pool returns
  `book_pool_needs_repair` (409) without burning a use.
- Acceptance criteria: a book that fails finishability is skipped and a healthy
  one assigned; the failed slug is quarantined and never re-read; a cosmetic-only
  pool still assigns (no strand); an all-unfinishable pool returns
  book_pool_needs_repair without decrementing uses; the gate never throws on
  garbage input; a book served under the wrong key is rejected (slug_mismatch);
  read_aloud-only books with empty sentences remain finishable (no false
  positive); a pack that passes the gate also passes validateBookFlowSubmission;
  `node --test` green; astro build clean.
- Files owned: src/lib/read2lead-book-health.mjs (new),
  functions/api/generate-read2lead-pack.js,
  tests/read2lead-book-health.test.mjs (new), tests/helpers/book-pack-fixture.mjs,
  tests/read2lead-book-assignment.test.mjs,
  tests/read2lead-book-reader-behaviour.test.mjs, tests/index.js,
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Non-goals: does NOT gate the LLM-generated (bespoke per-child) pack path — there
  is no "other book" to pick there (deferred); does NOT repair the books already
  broken in the library (the gate skips them; regenerating them is a follow-up).
- Stop condition: tests green (incl. new gate + integration tests), Buffet review
  clean, founder build gate PASS, astro build clean, then push to main (Phương
  approved commit+deploy 2026-07-09).
- Cost ceiling: USD 0 metered — Claude Lead direct + one Buffet review on the Max
  plan; actual USD 0.
- Reuse survey: (1) the product's OWN runtime flow module
  `src/lib/read2lead-book-flow.mjs` (`selectBookQuestions`/`buildBookShadowChunks`)
  — ADOPTED wholesale: the gate calls the real production functions so "passes the
  gate" provably means "the runtime accepts it", never a re-implementation that
  can drift; (2) a bundled English dictionary / spell-checker (nspell, hunspell,
  an npm wordlist) for typo detection — REJECTED: heavy for a Cloudflare Worker,
  high false-positive rate on character names/kid words, and it misses the actual
  dead-ends (which are structural, not spelling); (3) the existing generation-time
  validators (`read2lead_v0_codex/api/validator_v2.py`) — NO FIT at assignment
  time: they run only at generation and can't be trusted for already-shipped KV
  books, but their reconstruction logic was ported as the reference for the
  listen_and_order check.
- Design self-verification: N/A — backend gate, no UI/design surface; verified by
  the new executing unit + integration tests and the runtime-parity regression.
- Founder handoff: reported in chat with a plain-language summary; Phương approved
  commit + deploy. No decisions pending.

## Acceptance criteria reconciliation (R2L-BOOK-HEALTH-GATE)

- Broken book skipped, healthy one assigned, broken slug quarantined: PASS —
  "a broken book is skipped, a healthy one assigned, and the broken slug
  quarantined" integration test.
- Quarantined book skipped without re-read: PASS — get-spy test asserts
  `book:book_1` is never fetched.
- Cosmetic-only pool still assigns (no strand): PASS — "a pool of only
  cosmetically-flawed books still assigns one" test.
- All-unfinishable pool → needs_repair, no use burned: PASS — two tests (all-hard
  pool and all-quarantined pool) assert 409 `book_pool_needs_repair`,
  `uses_remaining` unchanged.
- Gate never throws on garbage: PASS — null/`{}` return hard-fail, not an
  exception.
- Wrong-key pack rejected: PASS — `slug_mismatch` unit + integration tests.
- Empty-sentence read_aloud books stay finishable: PASS — explicit health test.
- Gate ⇒ runtime-finishable: PASS — a pack passing `assessBookHealth` also passes
  `validateBookFlowSubmission`.
- node --test green: PASS — 765/765 (manifest run 134/134).

## Previous task

- Status: complete
- Started: 2026-07-09
- Completed: 2026-07-09 — merged to main ff48675 (Felix approved), 744/744 tests, astro build clean
- Task ID: R2L-BOOK-TEST-FIXTURE
- Owner: Claude Lead (Elon) — direct; `src/pages/read2lead/lesson.astro` is on
  the dispatch-guard PROTECTED allowlist (spec required; the approved plan is
  that spec), plan approved by Felix 2026-07-09
- Lane: product (test infrastructure + a byte-identical refactor of the
  scroll-reset helper; no change to lesson completion, scoring, rewards, or the
  mic/recorder pipeline)
- Problem: the book-reader is only checkable by hand (live pack + mic), and its
  "tests" are static source-regex assertions that never execute the reader — so
  a behaviour bug like the scroll-to-bottom one cannot be caught automatically.
  This is the ratified EVOLUTION_LOG proposal (2026-07-09) to add the missing
  test seam.
- Approach: (1) new `tests/helpers/book-pack-fixture.mjs` — `makeBookPackLesson`
  builds a valid lesson-pack object (story paragraphs/sentences, guided_listening
  questions, book_images, page audio, attribution) in the exact shape
  `src/lib/read2lead-book-flow.mjs` + the reader consume, plus `makeBookReaderState`
  for a completed run; (2) extract the scroll-reset one-liner from the inline
  `bookShowPage` into `read2lead-book-flow.mjs` as `scrollBookReaderToTop(doc)`
  (byte-identical runtime — same `#w1-book-reader-phase` + `scrollIntoView({block:'start'})`)
  and call it from `bookShowPage`, so the exact fix becomes unit-testable;
  (3) new `tests/read2lead-book-reader-behaviour.test.mjs` — executing tests that
  feed the fixture through the flow module (question selection, shadow chunks,
  submission validation) and spy on `scrollIntoView` to prove the page-turn
  resets to the reader top.
- Acceptance criteria: fixture produces data that `selectBookQuestions` /
  `buildBookShadowChunks` / `validateBookFlowSubmission` accept; a completed
  reader state validates `ok:true`; `scrollBookReaderToTop` targets
  `#w1-book-reader-phase` with `{behavior:'smooth',block:'start'}` and is null-safe;
  `bookShowPage` runtime unchanged; `node --test tests/*.test.mjs` passes;
  astro build clean; no unrelated refactor.
- Files owned: tests/helpers/book-pack-fixture.mjs (new),
  tests/read2lead-book-reader-behaviour.test.mjs (new),
  src/lib/read2lead-book-flow.mjs, src/pages/read2lead/lesson.astro,
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Non-goals: no local KV seed / Playwright harness this packet (deferred — the
  `node --test` coverage is the core ask); no change to reader behaviour beyond
  the byte-identical scroll-helper extraction.
- Stop condition: tests green (incl. the new behaviour tests), founder build
  gate PASS, astro build clean, then Felix + Phương approve merge to main.
- Cost ceiling: USD 0 metered — Claude Lead direct on the Max plan; actual USD 0.
- Reuse survey: (1) the existing `src/lib/read2lead-book-flow.mjs` self-contained
  flow module + its ESM test pattern (`tests/read2lead-book-flow.test.mjs`) —
  ADOPTED wholesale: extend it and its import-and-run test style rather than build
  a parallel harness; (2) jsdom / happy-dom for a DOM in tests — REJECTED: not a
  dependency here, and the repo already has a hand-rolled `globalThis.document`
  mock idiom (`tests/read2lead-w2-juice.test.mjs`) that the scroll test reuses,
  zero new deps; (3) Storybook / component-story harness — REJECTED: heavy tooling
  for an Astro-inline-script page, the fixture + flow module cover the need.
- Design self-verification: N/A — test infrastructure + a byte-identical helper
  extraction, no UI/design change; verified by the new executing tests + astro build.
- Founder handoff: result reported in chat; merged to main ff48675 under Felix's approval. No decisions pending.
- Verified commit: ff48675 (on origin/main and origin/claude/r2l-book-test-fixture)

## Acceptance criteria reconciliation

- Fixture produces data selectBookQuestions / buildBookShadowChunks /
  validateBookFlowSubmission accept: PASS — the new behaviour tests execute all
  three against the fixture output.
- A completed reader state validates ok:true: PASS — "a completed reader state
  built from the fixture validates ok" test (pages_heard 2, questions_answered 4).
- scrollBookReaderToTop targets #w1-book-reader-phase with
  {behavior:'smooth', block:'start'} and is null-safe: PASS — two behaviour
  tests (a scrollIntoView spy + a null-safety case).
- bookShowPage runtime unchanged: PASS — byte-identical extraction; the built
  page confirms scrollBookReaderToTop is inlined and called.
- node --test passes: PASS — 744/744 (5 new).
- astro build clean: PASS — 26 pages.
- No unrelated refactor: PASS — 5 files, +257/-8, all inside the packet.

## Previous task

- Status: complete
- Started: 2026-07-09
- Completed: 2026-07-09 — merged to main 69ac4da (Felix authorized the prod push directly), live-verified on felixbuilderhub.com
- Task ID: R2L-NEXT-PAGE-SCROLL
- Owner: Claude Lead (Elon) — direct edit; `src/pages/read2lead/lesson.astro`
  is on the dispatch-guard PROTECTED allowlist (spec required; the approved
  plan below is that spec), plan approved by Felix 2026-07-09
- Lane: product (UI/UX scroll behavior only — no change to lesson completion,
  scoring, rewards, badges, or the mic/recorder pipeline)
- Problem: when a kid finishes a book-reader page (listen, answer the 2
  questions, record themselves) and taps "Trang tiếp →", the next page
  renders in place but the scroll position is never reset. The kid tapped
  Next from the bottom of the previous page, so the new page opens scrolled
  to the bottom and they must scroll up to see the story image/title and
  start reading.
- Approach: reset scroll to the top of the reader by calling
  `qs('#w1-book-reader-phase')?.scrollIntoView({ behavior: 'smooth', block: 'start' })`
  at the end of `bookShowPage()` — the single choke point every page change
  funnels through (forward "Trang tiếp →", back, progress-trail jump, and
  story-page next). It does NOT fire on within-page steps (listen →
  questions → record), which go through `bookSetStage()`, so the reading
  flow inside a page is undisturbed. Reuses the exact
  `scrollIntoView({ behavior: 'smooth', block: 'start' })` pattern already in
  this file (lesson.astro:4193, :4995).
- Acceptance criteria: after tapping "Trang tiếp →", the new page opens at
  the top (story image + page title in view), not scrolled to the bottom;
  the same holds for back-nav and progress-trail jumps; within-page steps
  are NOT force-scrolled; `node --test tests/*.test.mjs` passes; no unrelated
  refactor.
- Files owned: src/pages/read2lead/lesson.astro,
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Stop condition: tests green, `founder_check.py --gate build` PASS, live
  in-browser verification shows a real page turn landing at the top, then
  Felix + Phuong approve the merge to main (pushing main = live deploy to
  real kids).
- Cost ceiling: USD 0 metered — Claude Lead direct on the Max plan; actual USD 0.
- Reuse survey: (1) native `Element.scrollIntoView` (browser API) — ADOPTED:
  reuses the exact pattern already used in this file (lesson.astro:4193,
  :4995), zero new dependency; (2) `scroll-into-view-if-needed` /
  smooth-scroll npm packages — REJECTED: the native API fully covers a single
  scroll-to-top, a library would add a dependency for no gain; (3) CSS
  `scroll-margin` / scroll-snap — REJECTED: the reset must fire imperatively
  on a JS-driven in-place content swap, not on a native anchor navigation.
- Design self-verification: N/A — no design mock (behavior fix, not a visual
  redesign). Verified on the LIVE production deploy (felixbuilderhub.com,
  commit 69ac4da): the exact scroll-reset line is served in the lesson page
  (`scrollIntoView` count 5→6; marker present via both curl and a Playwright
  DOM read), ZERO console errors/warnings on load, and the exact
  `scrollIntoView({ block: 'start' })` call moves the viewport to the reader
  top when exercised against the live `#w1-book-reader-phase` element. NOT
  driven: a full real book-reader page-turn — reaching the "Trang tiếp →"
  button needs a seeded book pack plus a mic to complete a page, neither
  reproducible in the sandbox. Mechanism otherwise certain: the reset sits in
  `bookShowPage()`, the sole choke point every page change funnels through.
- Founder handoff: pushed to prod under Felix's explicit authorization
  ("push to prod and check there"). Verified live as above and reported in
  chat. Recommended residual (not a blocker): Felix taps through one real
  lesson on a device to confirm the feel of the mic-gated page-turn. No
  decisions pending.
- Verified commit: 69ac4da (live on origin/main and origin/claude/r2l-next-page-scroll)

## Acceptance criteria reconciliation

- After tapping "Trang tiếp →", the new page opens at the top (story image +
  title in view), not scrolled to the bottom: PASS (mechanism + live element
  check) — the reset is `qs('#w1-book-reader-phase')?.scrollIntoView({block:'start'})`
  at the end of `bookShowPage()`, the single choke point for every page
  change; the exact call brings the live reader element to the viewport top
  (Playwright). SKIPPED live full-flow drive (no mic/seeded pack in sandbox),
  reason recorded above.
- Same holds for back-nav and progress-trail jumps: PASS by construction —
  both call the same `bookShowPage()` (lesson.astro back-nav + trail-node
  click handlers); code-verified, not separately driven.
- Within-page steps (listen → questions → record) are NOT force-scrolled:
  PASS — those transitions go through `bookSetStage()`, which does not call
  `bookShowPage()`; all 5 `bookShowPage()` call sites are page-index changes
  (code-verified).
- `node --test tests/*.test.mjs` passes: PASS — 739/739.
- No unrelated refactor: PASS — diff is one line + a comment in lesson.astro,
  plus this CONTROL.md bookkeeping.

## Previous task

- Status: complete
- Started: 2026-07-08
- Task ID: R2L-STRANDED-RESCUE
- Owner: Claude Lead (spec + execute + review; lesson completion logic —
  protected invariant, covered by spec addendum 2 in
  _ops/specs/SPEC_R2L_AUTO_SAVE_COMPLETION.md; Phuong granted full authority
  including merge to main: "Save all lessons for all kids... you have full
  power, no need for my approval", 2026-07-08)
- Lane: product (remediation of the 1502dd6 outage's stranded packs)
- Problem: kids whose standard packs are finished but stuck at
  awaiting_review (blocked by the 27/6–8/7 submit bug or the old click
  funnel) only get rescued when THEY reopen the lesson page. Phuong wants
  every stuck lesson saved proactively so dashboards look right immediately
  and no kid feels bad.
- Approach: server-side reconciliation on read. New
  functions/api/_read2lead-reconcile-stranded.js pre-scores the kid's own
  data (server checkpoint snapshot, else the exact payload of their last
  failed submit attempt) with the fixed rules, and only when the outcome is
  a genuine completion calls the real (now exported) submitV2Lesson —
  identical rewards/gates/idempotency as a real submit. Wired into
  read2lead-progress GET and the generate-read2lead-pack gate. Books and
  genuinely-unfinished/below-50% packs are never touched.
- Acceptance criteria: stranded-by-failed-attempt pack completes with
  rewards on first progress read and is idempotent on the second;
  stranded-by-checkpoint pack completes; genuinely-below-threshold pack is
  left byte-identical (status, attempts, checkpoint); book packs untouched;
  mic-skip source completes without reward; generate gate unblocks after
  reconcile; node --test passes; no unrelated refactor.
- Files owned: functions/api/_read2lead-reconcile-stranded.js (new),
  functions/api/submit-read2lead-lesson.js (exports + no behavior change),
  functions/api/read2lead-progress.js, functions/api/generate-read2lead-pack.js,
  tests/read2lead-stranded-rescue.test.mjs (new),
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Non-goals: no KV enumeration/sweep (no admin credentials by design;
  on-read reconciliation reaches every active kid); no history rewriting
  (XP penalty constant is 0 — nothing to refund); no book flow changes.
- Stop condition: tests green, build clean, local wrangler e2e shows a
  seeded stranded record flip to reviewed_pass_web_v2 on a plain progress
  GET, gates PASS, merged to main (pre-authorized) and production verified.
- Cost ceiling: USD 0 metered — Claude Lead direct on Max plan; actual: USD 0.
- Reuse survey: (1) existing submitV2Lesson pipeline — adopted wholesale via
  export (rewards/gates/idempotency identical to a real submit, no parallel
  implementation); (2) wrangler remote KV sweep / admin API batch — rejected:
  agent holds no CF/admin credentials by design and bulk enumeration of kid
  records is riskier than on-read reconciliation; (3) client-side self-heal
  (shipped in R2L-AUTO-SAVE-COMPLETION) — reused but insufficient alone: it
  requires the kid to open the lesson page, which Phuong explicitly wants to
  avoid.
- Design self-verification: N/A visual (server-side behavior, no UI change,
  no design mock) — behavior self-verified live by the building agent on
  `wrangler pages dev` + seeded KV at commit 7572af4: (1) bug-window victim
  record (real captured failed-submit payload, 95% true score) flipped to
  reviewed_pass_web_v2 with XP 20 / coins 25 on a single plain dashboard
  GET, idempotent across 3 reads; (2) checkpoint-only mic-skip kid completed
  without reward; (3) half-finished kid stayed awaiting_review, zero KV
  writes. 739/739 tests incl. 9 new covering all rescue/no-touch branches.
- Founder handoff: executed under Phuong's explicit full authority ("Save
  all lessons for all kids... you have full power, no need for my
  approval"). Result reported in chat; no decisions pending. Named
  boundary: production effect on real stranded kids is observable only when
  their codes are next read — the reconciliation path is identical to the
  live-verified local run, and production deploy of the same commit was
  confirmed via bundle marker.
- Verified commit: 7572af4 (on origin/claude/r2l-stranded-rescue; merged to
  main immediately after per pre-authorization)

## Acceptance criteria reconciliation (R2L-STRANDED-RESCUE)

- Stranded-by-failed-attempt pack completes with rewards on first progress
  read, idempotent on repeat reads: PASS — unit test + live wrangler e2e
  (3 consecutive GETs, xp/coins/completed_packs stable).
- Stranded-by-checkpoint pack completes: PASS — unit test + live e2e.
- Genuinely-below-threshold pack left byte-identical: PASS — unit test
  asserts deepEqual + zero KV puts.
- Genuinely-unfinished pack untouched: PASS — unit test + live e2e control.
- Book packs untouched: PASS — unit test.
- Mic-skip source completes without reward: PASS — unit test + live e2e
  (xp 0, coins 0, status reviewed_pass_web_v2).
- Generate gate unblocks after reconcile: PASS — reconcile wired before
  the previous_pack_needs_review gate, source-order asserted by test;
  full generate flow not driven live (would invoke the real Render backend
  and spend a lượt) — SKIPPED live-drive with that reason.
- node --test passes: PASS — 739/739 (9 new).
- No unrelated refactor: PASS — submit endpoint changes are export
  keywords only.

## Previous task

- Status: complete
- Started: 2026-07-08
- Completed: 2026-07-08 — merged to main b59f051 (Phuong approved), production verified live
- Task ID: R2L-AUTO-SAVE-COMPLETION
- Owner: Claude Lead (spec + execute + review; `lesson.astro` is PROTECTED —
  Claude edits directly per `~/.claude/hooks/aider-dispatch-protected.json`)
- Lane: product (protected "lesson completion logic" invariant — dedicated
  approved spec: `_ops/specs/SPEC_R2L_AUTO_SAVE_COMPLETION.md`, plan approved
  by Phuong 2026-07-08)
- Problem: ~90% of kids finish all 5 exercises but never save the pack. The
  finish path requires clicking "Hoàn thành nhiệm vụ 🎉" → confirming a modal
  ("Lưu chiến công") → waiting for a network POST. Kids close the tab after
  the last exercise; the pack stays `awaiting_review` forever.
- Approach: auto-submit the moment the last activity completes (mirror the
  existing book-lesson `bookFinishReader()` pattern), delete the confirm
  modal, keep "Gửi lại" retry on failure, and auto-retry the saved pending
  payload on next page load. Client-only; server endpoint already idempotent.
- Acceptance criteria: standard 5-activity lesson auto-submits with zero
  clicks after the last activity (celebration burst not cut off — 1700ms
  delay, 500ms on mic-skip); `#submit-confirm-modal` removed; `#lesson-continue`
  all-done branch calls `submitLesson()` directly as manual fallback;
  `updateGlobalCta()` shows saving/fallback states; pending submit auto-retries
  on load with the saved payload; resumed all-done sessions auto-submit;
  failed-pass and offline paths show toast + "Gửi lại" and re-enable manual
  save; book/W1 flows unchanged, no double-fire (`submitInFlight` +
  `_r2lAutoSubmitArmed`); `tests/lesson-ux-regression.test.mjs` modal test
  rewritten; `node --test` passes; no unrelated refactor.
- Files owned: src/pages/read2lead/lesson.astro,
  tests/lesson-ux-regression.test.mjs,
  functions/api/submit-read2lead-lesson.js (added via P0 addendum, see below),
  tests/read2lead-legacy-client-submit.test.mjs (new),
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Non-goals: no checkpoint-to-finalize server rescue (rejected Option B);
  no reward/scoring semantic changes.
- P0 addendum (2026-07-08, spec addendum in
  _ops/specs/SPEC_R2L_AUTO_SAVE_COMPLETION.md): live e2e exposed that since
  1502dd6 (2026-06-27) the submit endpoint expected a read_aloud result the
  standard-lesson client never sends — every standard-pack submit failed
  ("Chưa đạt 50%") with the score deflated by phantom read_aloud zeros and
  the XP penalty applied. This, not only the click funnel, is the dominant
  cause of "kids finish but never save". Smallest stabilizing fix under the
  AGENTS.md P0 exception: filter read_aloud out of the ensured activities
  for NON-book submit contexts (books keep their dedicated isBookFlowV2
  path). Also: raw network TypeError no longer leaks English "Failed to
  fetch" into kid-facing text.
- Stop condition: tests green, build clean, live e2e on deployed preview
  (zero-click auto-save observed via Playwright), founder_check gates PASS,
  Phuong approves merge to main.
- Cost ceiling: USD 0 metered — Claude Lead direct on Max plan (protected
  file, no Aider dispatch); actual cost: USD 0.
- Reuse survey: (1) in-repo book-lesson auto-submit pattern
  (`bookFinishReader()`, lesson.astro:6192) — adopted as the model for the
  trigger; (2) `navigator.sendBeacon` checkpoint rescue promoted to
  server-side finalization (external pattern: beacon-based analytics
  saves) — rejected: checkpoint payload lacks submit-shape data, server
  double-reward risk; (3) localStorage pending-queue libraries (e.g.
  workbox-background-sync) — rejected: existing hand-rolled
  savePendingSubmit/loadPendingSubmit already shipped and sufficient, a
  service-worker dependency is overkill for one endpoint.
- Design self-verification: no Claude Design mock exists for this task (flow
  change reusing the existing completion card/toast/CTA components). Rendered
  and driven end-to-end by the building agent at 1280px: (a) full flow on
  `wrangler pages dev dist` + seeded KV at the exact pushed commit — zero-click
  auto-save after last activity, offline failure state, reload auto-resend,
  completion card; screenshots `_ops/r2l-autosave-offline-retry-1280.png`
  (CTA fallback "Lưu chiến công 💾" + "Gửi lại") and
  `_ops/r2l-autosave-completion-1280.png` ("Nhiệm vụ xong!" card, CTA gone);
  (b) deployed preview at 94d6602 — new code markers confirmed in served
  bundle (auto-submit scheduler, new hint copy, no submit-confirm-modal),
  standard-lesson fixture rendered via route interception (zero writes to real
  KV), part 1 completed through the deployed UI with quest path updating;
  screenshot `_ops/r2l-autosave-preview-deployed-1280.png`. Verdict: match.
  Named boundary: the deployed W1 story-gate full run needs per-page audio a
  synthetic pack lacks, and all real awaiting_review packs belong to real kids
  (must not be consumed) — W1 shares the same completeActivity → auto-submit
  funnel verified above.
- Founder handoff: plain-language result + 3 screenshots above + this entry.
  Specific asks for Phuong: (1) approve merge of claude/r2l-auto-save to main
  — this both removes the save funnel AND unblocks all kids stuck failing
  standard packs since 27/6; (2) optional 2-line copy refresh on
  read2lead.astro (lines 224/246 still say "bấm lưu chiến công" — protected
  positioning copy, left untouched); (3) after merge, consider telling
  affected kids their old packs will now save when reopened (auto-resume
  submits on lesson load). No QA hunting requested — flow self-verified.
- Verified commit: 94d6602 (tip of origin/claude/r2l-auto-save; preview
  https://claude-r2l-auto-save.felixbuilderhub.pages.dev)

### Acceptance criteria reconciliation (R2L-AUTO-SAVE-COMPLETION)

- Zero-click auto-submit after last activity (1700ms / 500ms mic-skip):
  PASS — live e2e on wrangler+KV; hint "Minny đang tự động lưu chiến công
  của con..." then completion card with no clicks.
- `#submit-confirm-modal` removed: PASS — deleted, regression test asserts
  absence; deployed bundle grep = 0 occurrences.
- `#lesson-continue` all-done branch calls submitLesson directly (manual
  fallback): PASS — code + test regex + observed enabled fallback state.
- `updateGlobalCta()` saving/fallback states: PASS — observed "Minny đang
  lưu chiến công..." (disabled) and "Lưu chiến công 💾" (enabled after
  simulated offline failure).
- Pending submit auto-retries on load with saved payload: PASS — simulated
  offline → reload → auto-resend → completion card; pending key cleared.
- Resumed all-done session auto-submits: PASS — observed three times,
  including localStorage-wiped + server-checkpoint fallback restore.
- Failed-pass / offline show toast + "Gửi lại" + re-enabled manual save:
  PASS — both branches observed live (failed-pass observed pre-server-fix,
  offline via injected fetch failure).
- Book/W1 flows unchanged, no double-fire: PASS for book (isBookLesson
  guards + book tests green; book packs route via isBookFlowV2 — new test);
  W1 SKIPPED for full live drive (deployed W1 story gate needs per-page
  audio the synthetic pack lacks; real packs belong to real kids) — W1 uses
  the same completeActivity funnel the trigger lives in.
- `tests/lesson-ux-regression.test.mjs` modal test rewritten: PASS.
- `node --test` passes: PASS — 730/730 (3 new legacy-client submit tests).
- No unrelated refactor: PASS — P0 server fix added under the AGENTS.md P0
  exception with a dated spec addendum (documented above), not silent scope
  creep.

- Status: complete
- Task ID: R2L-BOT-STATS-MANUAL
- Owner: Claude (spec + execute + review)
- Lane: admin tooling only (internal `/admin/codes` page; no kid/parent-facing
  surface, so the design-first mock rule doesn't apply)
- Problem: Phuong reported "no motivation for kids in the ranking." The
  Pilot/Ong bot-competitor system already exists (shipped commit 2ea625b) and
  is live in production, but both bots sit at Gold tier (39 and 19 completed
  packs) while 7 of 13 real kids have 0 completed packs — the bots are
  unreachable long-term targets, not a near-term rival for most kids. Phuong
  wants bots at "ALL ranks" but wants to set the exact rank/packs/coins
  herself rather than have Claude hardcode more preset numbers.
- Acceptance criteria: a new inline "Set bot stats" control appears in
  `src/pages/admin/codes.astro` for any code row where `is_test` or `is_bot`
  is true (rank_label_vi text input, completed_packs number input, coins
  number input, "Áp dụng" button with a confirm() guard, matching the
  existing `set-level` row-control pattern); it POSTs to the already-existing
  `/api/admin/codes/:code/set-bot-stats` endpoint (no backend changes) and
  refreshes the list on success; `tests/admin-set-bot-stats.test.mjs` covers
  the endpoint's reject/accept paths; `node --test tests/*.test.mjs` passes;
  no changes to `LEADERBOARD_BOT_PRESETS`, `apply-bot-presets.js`, or the
  existing "Sync bot (Pilot + Ong)" button; no unrelated refactor.
- Files owned: src/pages/admin/codes.astro,
  tests/admin-set-bot-stats.test.mjs (new)
- Stop condition: tests green (727/727), founder_check.py --gate build PASS,
  Phuong approved merge to main (2026-07-04) — done. She now creates/tunes
  bot accounts herself via the new control.

- Status: complete
- Task ID: R2L-PACK-BLOCK-CTA
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (UI/copy, touches the protected "block generation until
  previous pack is done" invariant — same class of code as R2L-CLEAR-LESSONS-REFUND)
- Problem: when a kid tried to generate a new pack while an old one was
  unfinished, the block message read negatively (red error box) and the
  only way back to the old pack was a raw text URL to `/ho-so?code=...`,
  which required login + scrolling to the bottom of the profile page to
  find the real resume button.
- Acceptance criteria: `functions/api/generate-read2lead-pack.js` returns a
  positive-voice message (final wording per Phuong: "Bài của con sắp xong
  rồi! Con cần hoàn thành bài cũ trước khi mở bài mới nhé!") plus a new
  `lesson_link` field (`/read2lead/lesson?code=...&pack_id=...`) for the
  `previous_pack_needs_review` case only; both live UI flows (`/read2lead`
  via `read2lead.astro`, `/read2lead/build` via `build.astro` +
  `r2l-builder.client.ts`) swap the red error framing for a friendly/accent
  card with a working "Đọc tiếp bài cũ 📖" button wired to `lesson_link` for
  that case only; genuine errors keep today's red framing unchanged;
  `node --test tests/*.test.mjs` passes; no unrelated refactor. All met.
- Files owned: functions/api/generate-read2lead-pack.js,
  src/pages/read2lead/build.astro, src/scripts/r2l-builder.client.ts,
  src/pages/read2lead.astro, tests/read2lead-generate-gate.test.mjs
- Stop condition: tests green, Claude review clean (caught and fixed 3 bugs
  in the aider-senior diff: a DOM overwrite that would have erased the
  message text, a leaked cosmetic-stage timer, missing anchor-element
  typing), founder_check.py --gate build PASS, Phuong approved merge to
  main (2026-07-04) — done.
- Cost ceiling: none
- Design self-verification: N/A — no Claude Design mock for this task (positive
  block-message copy + a `lesson_link` resume field); wording approved by Phuong
  directly. Task completed + merged 2026-07-04, before this field existed.
- Founder handoff: N/A — completed and merged before this field existed
  (2026-07-06); Phuong approved the final wording and the merge to main in-flow.

## Acceptance criteria reconciliation

- none

## Earlier task history

- Status: complete
- Task ID: R2L-LESSON-CHECKPOINT
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (bug fix, protected "lesson completion logic" invariant)
- Root cause: in-progress lesson state is 100% client-side (localStorage/
  sessionStorage) with no server fallback, so a kid loses all progress if
  browser storage is wiped between visits (private/incognito mode, in-app
  WebView like Zalo's browser, OS storage eviction, device switch) even
  though the existing background/pagehide save logic is correct.
- Acceptance criteria: new lightweight `current_pack.web_session_checkpoint`
  KV field written only via `functions/api/read2lead-checkpoint-save.js` on
  existing pagehide/visibilitychange/freeze flush points (no new listeners,
  no per-keystroke writes); read back for free via
  `functions/api/read2lead-lesson.js`; client falls back to it when local
  storage is empty; checkpoint stripped on pack submit (all 3 write sites
  in submit-read2lead-lesson.js); fully isolated from uses_remaining/rank/
  XP/lượt logic; node --test passes; no unrelated refactor.
- Files owned: functions/api/read2lead-checkpoint-save.js (new),
  functions/api/read2lead-lesson.js, src/pages/read2lead/lesson.astro,
  functions/api/submit-read2lead-lesson.js,
  tests/read2lead-checkpoint-save.test.mjs (new), plus targeted test
  additions to existing submit/lesson-flow test files
- Stop condition: tests green, Claude review clean, founder_check.py
  --gate build passes, Phuong approves merge to main
- See plan: /home/felixbuilderhub/.claude/plans/composed-exploring-galaxy.md

- Status: complete
- Task ID: R2L-CLEAR-LESSONS-REFUND
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (bug fix, protected "lesson completion logic" invariant)
- Root cause: `DEFAULT_CLEAR_STATUSES` in `functions/api/_read2lead-clear-open-lessons.js`
  included `awaiting_review`, so the admin cleanup endpoint wiped freshly
  generated (lượt-already-spent) packs by default, not just stuck locks.
- Acceptance criteria: default clear only touches `generation_in_progress`;
  explicit clear of `awaiting_review` refunds `uses_remaining` (capped at
  `uses_total`); admin response reports refund count; node --test passes
  (existing buggy-behavior test corrected, new cases added); no unrelated
  refactor. All met.
- Files owned: functions/api/_read2lead-clear-open-lessons.js,
  functions/api/admin/codes/clear-open-lessons.js,
  tests/read2lead-clear-open-lessons.test.mjs
- Stop condition: tests green (709/709), Claude review clean,
  founder_check.py --gate build PASS, Phuong approved merge to main (2026-07-04) — done.
- Remediation of already-affected students (3 known codes + wider check):
  Phuong is handling manually herself, not part of this packet.

- Status: complete
- Task ID: R2L-PROGRESS-SAVE
- Owner: Claude
- Lane: product
- Acceptance criteria: visibilitychange and freeze listeners save lesson state on app background; node --test passes; no state shape changes
- Files owned: src/pages/read2lead/lesson.astro
- Stop condition: Three event listeners wired, tests pass, Phuong approves merge to main
