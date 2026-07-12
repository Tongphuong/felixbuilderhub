# Control — SpeakUp

- Product: SpeakUp
- Current goal: Build all 8 phases of `_ops/specs/SPEC_SPEAKUP_V0.md` on branch `claude/speakup-v0`, QA the full pilot on preview, THEN merge to main. No phase merges to main individually.
- Branch: `claude/speakup-v0` (off `main`)
- Preview URL: `claude-speakup-v0.felixbuilderhub.pages.dev` (Cloudflare Pages auto-deploy per push, per `claude/<topic>` convention in `BRANCH_CONVENTIONS.md`)
- Active workers: 0
- Last updated: 2026-07-11 (**V0 MERGED TO MAIN + PRODUCTION LIVE** —
  72e589b, prod smoke-verified; Wave 0 CLOSED, V1 code unblocked. Session
  reconciliation: Phương opened a new-modes brainstorm pointing at the
  07-07 research spec; resolved with him that SPEC_SPEAKUP_V1.md remains
  the roadmap of record — decisions: follow the ratified roadmap, V1.2
  chips packet first, merge now; picture-describe upgrade for HOMEWORK
  mode logged in IDEAS (exam-style anchors + Minny follow-ups; many
  students target Cambridge Starters/Movers/Flyers); video mode REJECTED.)

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
| 6 | Phase 8b — Gate removal (pilot enablement) | Claude Lead (folded into `speakup-separation-and-freetalk-enable`; Phương explicitly unblocked it from Phase 6 red-team, 2026-07-06) | done | yes (bbb6761) | no |

Waves 1 and 4 have two parallelizable items each (no shared files); everything
else is strictly sequential because it touches `speaking.astro`. **No phase
merges to `main`.** All 8 land on `claude/speakup-v0`, get QA'd together on
the preview URL, and only then does the whole branch merge to `main` —
per Phuong's explicit instruction (2026-07-04): build full V0 before push to
prod.

**QA note (2026-07-06):** Phương spot-QA'd the post-separation preview build
and called it "ok for now" — this is not the full all-phases QA-together
pass; the per-phase QA column stays "no" until that final joint run before
the merge.

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
   `founder_check.py --repo . --product speakup --gate build` (from inside
   this repo's root) before committing. See `.claude/rules/speakup.md`.
2. **Reuse before building.** Before writing any new capability from scratch
   (conversation guardrails, TTS client, audio session handling, admin
   homework-entry form, etc.), search for an existing open-source library,
   package, or forkable project. Only hand-roll it if nothing suitable
   exists, and note that search briefly in the spec for that phase.

## V1 phase tracker (source of truth: `_ops/specs/SPEC_SPEAKUP_V1.md`, approved 2026-07-10)

| Wave/Phase | What | Owner | Status | Gate |
|---|---|---|---|---|
| Wave 0 | V0 close-out: **DONE 2026-07-11** — all founder items done; Phương gave explicit merge GO in-session; `claude/speakup-v0` merged to `main` (72e589b, conflict-free, 950/950 tests) and production verified live (`/speak-up/` + context endpoint answering on felixbuilderhub.com). Pilot can start. | **Phương** + Elon | **DONE** | V1 code UNBLOCKED |
| Wave D | Design mocks batch 1: choice-chip conversation view (L1–L2) + homework feedback panel v2 + fix-it round | Steve (delivered f141620) | **APPROVED (Phương, 2026-07-10)** — as-drawn; README open questions resolved to the mocks' defaults; Vietnamese copy tone pass rides the build phases | done |
| Wave D2 | Design mocks batch 2: L3–L5 free talk — topic picker (R2L HUB_TOPICS/TopicTile reuse), 💡 hint-on-demand states, L4–L5 game cards (build-a-story / debate / would-you-rather) | Steve (delivered e903682) | **APPROVED (Phương, 2026-07-10)** — as-drawn, same terms; V1-D6 teacher-panel mock exemption stands (not vetoed) | done |
| V1.1 | Free-talk brain (backend): L1–L2 chips protocol + expected-answer matching + repair ladder; L3–L5 topic-seeded prompt + hint field; L4–L5 game protocols (former V1.P, folded) | Elon (prompt) + Mark (glue) + Buffet (review) | not started | Wave 0 |
| V1.2 | Free-talk UI, 2 sequential packets: (1) L1–L2 chips + hands-free toggle; (2) L3–L5 topic picker + hint button + game cards | Steve + Buffet | not started | packet 1: Wave D approval + V1.1; packet 2: Wave D2 approval + packet 1 |
| V1.3 | Homework feedback sandwich (relaxes zero-LLM per V1-D1; consumes homework brief) | Elon (prompt) + Mark + Buffet (red-team) | not started | Wave 0 + **explicit Phương ack of zero-LLM relaxation** |
| V1.3b | Homework brief "Minny hiểu bài như này" (V1-D6): assign-time generation + teacher confirm in HomeworkModal (photo-extract draft pattern; design-mock exempt as internal pattern-copy — Phương may veto) | Elon (prompt) + Mark + Buffet | not started | Wave 0; lands with/just before V1.3 |
| V1.4 | Fix-it round + listen-and-compare | Steve + Mark + Buffet | not started | Wave D approval + V1.2 packet 1 + V1.3 |
| ~~V1.P~~ | **FOLDED 2026-07-10 evening** into V1.1/V1.2 as the L4–L5 free-talk game protocols/UI (Phương's clean mode separation: production lives in Free Talk as activities, homework not involved) | — | folded | — |
| V1.5–V1.7 | Error profile / teacher digest / tenant-readiness config | — | HELD | pilot-evidence review (~2 weeks of pilot) |
| S2S spike | Speech-to-speech cost comparison (already approved) | own session | queued | own gate; recommended after V1.1 |

## Current task

- Status: complete
- Task ID: speakup-v1-2-packet2-games-ui
- Owner: Steve (bg worker, packet scratchpad/games-steve-packet.md, sole
  owner of speak-up.astro + speakup-app.css + new UI tests); Elon review
  + rule-20 on deployed prod; Buffet scoped review (level gating + no new
  network patterns + Elon's context-level micro-diff). Phương approved
  the plan 2026-07-12 (plan-mode).
- Lane: `claude/speakup-v1-1` → `main` per phase cadence.
- Problem: L3–L5 kids see plain conversation — the approved Wave D2
  screens (topic picker + Minny chọn 🎲, L4–L5 game cards, 💡 hint
  states, game framing) are the last approved-but-unbuilt piece; the
  V1.1 backend contract they consume is already live.
- Pre-step (Elon micro-diff, done): minny-speaking-context.js response
  gains `level` (same lookup as minny-conversation) + test — the picker
  gates on level BEFORE start.
- Reuse survey: N/A external — approved internal mock + HUB_TOPICS
  values + live V1.1 API; no new capability class.
- Cost ceiling: Claude team (Max plan, not metered); runtime $0.
- Acceptance criteria: spec §V1.2 packet 2 + the approved Wave D2 mock —
  picker only at L3+ (context-level keyed, tested); game cards only
  L4–L5; start carries topic/game; hint renders only from the server
  hint field, one word EN+VN card, re-hides next turn, proactive offer
  on stall; game framing over unchanged ft-* chrome; Minny red-robot
  assets (mock koalas are placeholders — standing rule); styles in
  speakup-app.css ONLY (orphan-stylesheet trap); 44px; reduced-motion;
  baseline 1114 tests none dropped; rule-20 screenshots on deployed prod
  vs the rendered mock with SHA recorded.
- Files owned (Steve): src/pages/speak-up.astro, src/styles/
  speakup-app.css, tests/speakup-games-ui.test.mjs.
- Stop condition: ANY functions/ diff beyond Elon's pre-step — stop; new
  kid-facing copy not in the mock — TODO(elon).
- Acceptance criteria reconciliation:
  1. PASS — picker only at L3+ (context `level` keyed, tested); game
     cards L4–L5 only; L0–L2 flow byte-identical.
  2. PASS — start carries topic/game; minny_choice tile; debate banner
     text ONLY from the server-echoed debate_topic (Elon micro-diff +
     allowlist test), escaped (Buffet-traced).
  3. PASS — hint idle/offered-on-stall/revealed states; renders only from
     the server hint field (never client level inference); re-hides per
     turn; reuses the existing VAD stall signal (no new timer).
  4. PASS — chips/fix-it/two-phase audio untouched (Buffet structural
     grep); no new network patterns; styles in speakup-app.css only;
     robot assets; 44px; reduced-motion.
  5. PASS — 1149/1149 node --test; astro build clean; founder gates;
     Buffet SHIP no findings (incl. both Elon micro-diffs, author ≠
     reviewer).
  6. PASS (rule 20) — verified on DEPLOYED PRODUCTION a1240f2 via the
     routed harness: picker A2 state (12 tiles + 🎲 + 3 game cards +
     start CTA), debate banner live ("MINNY NGHĨ — Cats are better than
     dogs" from the server field), hint reveal ("MINNY GỢI Ý — whiskers",
     dismissable). Screenshots _ops/speakup-v12p2-final-picker-390.png,
     -debate-hint-390.png vs the approved Wave D2 mock: MATCH for A1/A2/
     B1–B3/C1/C2.
  7. MOCK DEVIATIONS recorded for Phương (approved-as-drawn mock, so his
     eye is owed): C3 would-you-rather option cards DEFERRED (the game
     works conversationally; structured turn field needed — backlog);
     hint card EN-only (server hint is EN by V1.1 design; VN gloss
     deferred); picker desktop single-column simplification; new
     .minny-game-card.is-selected state (mock drew none).
- Design self-verification: rule-20 evidence above.
- Founder handoff: final report incl. the four mock deviations for his
  ack/veto.
- Verified commit: a1240f2 (origin/main, production-verified live)
- Actual cost: USD 0 runtime.
- Review trail: Steve (2 rounds), Elon micro-diffs + review, Buffet SHIP.
- Started: 2026-07-12
- Completed: 2026-07-12

## Prior task (complete): speakup-v1-4-fixit-round

- Status: complete
- Task ID: speakup-v1-4-fixit-round
- Owner: Steve (bg worker, packet scratchpad/fixit-steve-packet.md, sole
  owner of speak-up.astro + speakup-app.css + UI tests); Elon review +
  integration + rule-20 deployed-preview screenshots vs the approved
  Set 2 mock; Buffet review. Step 3 of the founder-approved plan
  (2026-07-11); V1.4 pulled ahead of V1.3 per that plan's sequencing
  note (deterministic, no LLM gate).
- Lane: `claude/speakup-v1-1` → `main` after review + rule-20.
- Problem: kids now SEE weak words and can HEAR them — the loop needs the
  third step: guided re-try with hear-Minny / hear-yourself compare and a
  fresh score (the approved Wave D Set 2 mock's fix-it states).
- Reuse survey: N/A external — UI-only phase over shipped machinery
  (flagged words, minny-voice word branch, existing recorder, existing
  read-mode single-word Azure scoring via practice_mode). Zero backend
  change is an explicit constraint.
- Cost ceiling: Claude team (Max plan, not metered); runtime = ≤3 short
  scored reps per homework attempt through the existing metered Azure
  path — the 3-rep hard cap is the fence (test-asserted), per V1.4's
  spec acceptance.
- Acceptance criteria: per spec §V1.4 + the approved mock — skippable
  always, never blocks homework completion; ≤3 reps hard cap; hear-Minny
  (word branch) + hear-yourself (client-side last-recording playback,
  nothing uploaded); re-record scores via existing read-mode one-word
  check; celebrate/encourage states per mock, never negative; rule-20
  deployed-preview screenshots vs mock with SHA recorded; node --test
  green (baseline 1083); astro build clean; founder gates.
- Files owned (Steve): src/pages/speak-up.astro, src/styles/
  speakup-app.css, tests/speakup-fixit-ui.test.mjs (+chips-ui if needed).
- Stop condition: ANY functions/ diff — stop and report; any new
  kid-facing copy not in the mock — TODO(elon).
- Acceptance criteria reconciliation:
  1. PASS — skippable invitation, never blocks the step flow (test line
     211 + Buffet structural trace: fix-it card never touches
     #speaking-result/#speaking-actions visibility).
  2. PASS — 3-rep hard cap unbypassable; failed submissions count toward
     it (Buffet-traced: repsUsed increments before outcome evaluation;
     catch path still calls fixitAfterRep).
  3. PASS — reps score through the existing read-mode one-word Azure path
     (check_mode read / expected_text word / practice_mode 1 / WAV); zero
     functions/ diff (git-verified). Hear-yourself = local blob only.
  4. PASS — mock states 3/4/5 implemented with verbatim copy; sandwich
     screens 1-2 correctly deferred to V1.3; celebrate cutoff reuses the
     shipped ≥70 convention.
  5. PASS — 1113/1113 node --test; astro build clean; founder gates.
  6. PASS (rule 20) — verified on DEPLOYED PRODUCTION d2a10a1 via the
     routed-harness flow (stubbed context/check responses through the
     real page code, fake mic): invitation state (3 words, Bắt đầu luyện
     🎯 / Bỏ qua) and rep state (TỪ 1/3, big word, Nghe Minny, small
     re-record) match the approved Set 2 mock; screenshots
     _ops/speakup-v14-final-invite-390.png / -rep-390.png. CAUGHT by this
     check: the mock's 🐨 koala placeholder had been copied verbatim —
     replaced with the Minny red-robot assets per the standing founder
     rule (d2a10a1), tests updated N/A (none asserted the emoji).
  7. Post-mortem note: a false "Cloudflare stopped deploying" alarm was
     raised (founder pulled the build log — build had succeeded). Root
     cause: the deploy probe grepped a JS function name, which minification
     renames; string-literal/class-name probes are the correct method
     (used successfully all prior deploys). Logged for the reflection.
- Design self-verification: rule-20 screenshots above vs the approved
  mock; verdict MATCH (with the koala→robot correction applied).
- Founder handoff: full plain-language report incl. the false-alarm
  correction; nit backlog: 1400ms re-tap debounce (Buffet, cosmetic).
- Verified commit: d2a10a1 (origin/main, production-verified live)
- Actual cost: USD 0 runtime.
- Review trail: Steve built (resumed across a rate-limit cut); Elon
  review + koala fix; Buffet scoped SHIP.
- Started: 2026-07-12
- Completed: 2026-07-12

## Prior task (complete): speakup-word-level-feedback

- Status: complete
- Task ID: speakup-word-level-feedback
- Owner: Mark (bg worker, packet scratchpad/word-feedback-packet.md);
  Elon review + integration; Buffet ADVERSARIAL review mandatory on the
  minny-voice allowlist extension (new kid-adjacent TTS surface). Phương
  approved the 3-step plan 2026-07-11 ("see the words → hear them → fix
  them"); this task = steps 1–2, V1.4 fix-it round follows as its own
  gated phase (pulled ahead of V1.3 per the approved plan's sequencing
  note — deterministic, no LLM gate needed).
- Lane: `claude/speakup-v1-1` → `main` after review.
- Problem: kids see only a percentage — reading shows per-word chips but
  presentations discard Azure's per-word data, and no chip is tappable to
  hear the model. Big-app loop (ELSA/Speak): show words → hear model →
  retry. Phoneme-level tips deliberately parked (not child-calibrated).
- Reuse survey: N/A external — surfaces data already present in the paid
  Azure responses + reuses the existing wordChips renderer, SKIP_WORDS
  stopword set, Aura-2 TTS chain/KV cache, and the convo-audio ownership
  pattern for the voice allowlist. No new capability class.
- Cost ceiling: Claude team (Max plan, not metered); runtime $0 (word
  data already in responses; tap-to-hear rides the cached TTS chain).
- Acceptance criteria:
  1. Presentations: pronunciation block gains words[] — lowest-accuracy
     first, accuracy<70 only, stopwords excluded via SKIP_WORDS passed as
     an argument (no circular import), max 3, {word, accuracy_percent}.
  2. UI: "Từ cần luyện:" chips under the pronunciation row reusing the
     read step's exact wordChips(…,'miss') renderer; absent → nothing.
  3. Speaking-check endpoint writes an owner-stamped, short-TTL (1h) KV
     record flagged-words:<code> after any result carrying practice
     words (read words_missed/words_close + frame pronunciation words);
     best-effort, never blocks the response; single write site in
     onRequestPost (minimal PROTECTED diff).
  4. minny-voice gains a `word` branch: single alpha token ≤30 chars,
     lowercased, must be in the caller's own flagged-words record →
     synthesize; anything else 403. Existing phrase/sentence branches
     byte-identical. Adversarial fixtures: arbitrary word 403, other
     code's flagged word 403, expired record 403, injection strings 403.
  5. Tap-to-hear on BOTH read chips and new frame chips (one handler);
     ≥44px targets; audio plays via the existing play path.
  6. node --test green (baseline 1047 + new); astro build clean; founder
     gates; live prod verify: frame check returns words[]; voice returns
     audio for a flagged word and 403 for a non-flagged word.
- Files owned (Mark): functions/api/_azure-pronunciation.js,
  functions/api/read2lead-speaking-check.js (PROTECTED, minimal),
  functions/api/minny-voice.js, src/pages/speak-up.astro,
  tests/azure-pronunciation.test.mjs, tests/minny-speech-frame.test.mjs,
  tests/minny-tts.test.mjs (voice endpoint tests live where they live —
  Mark finds the right suite and reports).
- Stop condition: any relaxation of minny-voice beyond the single-word
  flagged-record branch (it must never become an open TTS proxy); any
  change to scoring semantics — stop.
- Acceptance criteria reconciliation:
  1. PASS — pronunciation block gains words[] (accuracy<70, SKIP_WORDS as
     argument — no circular import, Insertion excluded, len≥3, ascending,
     max 3, omitted when empty).
  2. PASS — "Từ cần luyện:" chips reuse wordChips(…,'miss'); absent →
     panel unchanged.
  3. PASS — flagged-words:<code> KV record (TTL 1h) written best-effort at
     the single response site for read AND frame words; punctuation-
     normalized identically server & client (Elon ruling, "banana." round
     trip fixture); Buffet forced a throwing KV — response unaffected.
  4. PASS — minny-voice word branch: string-type guard (Buffet nit) +
     strict regex + own-key flagged-record membership; Buffet adversarial
     verdict verbatim: could NOT construct an input that makes Minny speak
     arbitrary text (12 vectors: multi-word, unicode, homoglyph, branch
     combos, cross-code, expired record, empty-normalize, length caps,
     case, apostrophe abuse, coercion payloads, rate-limit-before-KV).
     Phrase/text branches byte-identical.
  5. PASS — one delegated tap handler for read + frame chips (matched-word
     taps intentionally silent-403 by design); 44px buttons; reduced-
     motion; 403/error = silent no-op (no popup, no browser-TTS leak).
  6. PASS — 1083/1083 node --test; astro build clean; founder gates PASS.
     LIVE on production (76d1ec7): real-speech frame check returned
     words[] {together 48%, mini 66%}; voice returned real audio (7104
     b64) for flagged "together" and 403 for non-flagged "bureaucracy".
- Design self-verification: behavioral = the live production loop above;
  visual = chips reuse the shipped wordChips look 1:1 (internal pattern-
  copy, design-mock exempt, flagged for Phương's veto as before).
- Founder handoff: plain-language report with the live numbers; Step 3
  (V1.4 fix-it round, approved Set 2 mock) queued next per the approved
  plan.
- Verified commit: 76d1ec7 (origin/main, production-verified live)
- Actual cost: USD 0 runtime (~7s Azure F0 for the verify; word audio
  rides the cached TTS chain).
- Review trail: Mark (2 rounds incl. punctuation ruling), Elon line-by-
  line, Buffet adversarial SHIP (his hygiene guard applied).
- Started: 2026-07-12
- Completed: 2026-07-12

## Prior task (complete): speakup-azure-frame-grading

- Status: complete
- Task ID: speakup-azure-frame-grading
- Owner: Mark (bg worker, packet scratchpad/azure-frame-packet.md) builds;
  Elon line-by-line review + integration; Buffet review (PROTECTED-file
  diff must be traced). Phương decision 2026-07-11 (AskUserQuestion):
  Azure grading for presentations FIRST, before V1.2 packet 2.
- Lane: `claude/speakup-v1-1` → `main` after review (founder-directed).
- Problem: presentations (frame steps — the founder's "45%" test) get only
  deterministic anchor/rubric scoring; Azure Pronunciation Assessment
  grades read steps (scripted) and photo_talk (unscripted) but never
  frames, because frames record compressed audio (no WAV) and no frame
  branch exists.
- Fix shape: client records WAV for frame steps (one condition); server
  samples the first 30s (pure WAV trim helper — Azure short-audio REST
  cap) and runs the EXISTING unscripted Azure path additively; result
  gains an optional pronunciation block; deterministic scoreSpeechFrame
  untouched and still renders first; any Azure failure → byte-identical
  to today. One warm pronunciation row in the shipped rubric panel
  (design-mock exempt as internal pattern-copy — flagged for Phương's
  veto). Free Talking stays ungraded (founder-aligned non-goal).
- Reuse survey: N/A external — extends the already-adopted Azure PA
  integration (vendor chosen in the 2026-07-06 reuse overhaul; Speechace
  researched 2026-07-10 as the paid fallback) to one more exercise type;
  no new capability class. Internal reuse: photo_talk unscripted branch +
  mapAzureOpenResult + meter, reused not re-rolled.
- Cost ceiling: Claude team (Max plan, not metered); runtime $0 by
  construction (F0 free tier, KV-metered at 30s/attempt, silent fallback
  when exhausted). Budget note for pilot review: at full usage frames
  alone ≈ 10 audio-h/month vs the 5h free tier — paid rate ≈ $1/audio-h
  (≈$5–15/mo) is Phương's later call with real meter data.
- Acceptance criteria:
  1. Frame steps upload WAV; read/photo behavior unchanged.
  2. trimWavToSeconds pure + byte-exact tests; junk input → skip Azure.
  3. Frame result gains optional pronunciation block only when Azure
     succeeds under tier; ANY failure → result identical to today
     (deep-equal test); meter bumped by sampled seconds.
  4. PROTECTED file diff is the additive frame branch only (Buffet trace).
  5. Rubric panel shows the warm pronunciation row only when data present
     (Lead-authored copy verbatim; <50% shows encouragement, never a low
     number).
  6. node --test green (baseline 1030 + new); astro build clean; founder
     gates PASS; live verify on prod with a test code frame homework.
- Files owned (Mark): functions/api/_azure-pronunciation.js,
  functions/api/read2lead-speaking-check.js (PROTECTED, minimal),
  src/pages/speak-up.astro (recorder condition + results row),
  tests/azure-pronunciation.test.mjs, tests/minny-speech-frame.test.mjs.
- Stop condition: any change to scoreSpeechFrame semantics, read/photo
  Azure paths, Free Talk grading, or files beyond the list — stop.
- Acceptance criteria reconciliation:
  1. PASS — frame steps record WAV (recorder condition + comment); read/
     photo recording unchanged; frame uploads confirmed on the 10MB LONG
     cap (max_seconds 75 ≥ 60 → LONG, pre-existing, no change needed).
  2. PASS — trimWavToSeconds pure, byte-exact tests; Buffet probed
     blockAlign 0 / lying sizes / extra chunks / boundary cases — all
     null-skip, no bad slice can reach Azure; Elon polish: header-only
     WAV short-circuits locally.
  3. PASS — pronunciation block only on Azure success under tier; ANY
     failure → deep-equal identical result; meter untouched on failure
     (Buffet probe + new explicit assertion); meter charged with measured
     sampled seconds (20s→20, 75s→30 tests).
  4. PASS — PROTECTED diff traced by Buffet: two imports + the additive
     try/catch frame branch only; scoreSpeechFrame byte-identical.
  5. PASS — warm row renders only with a finite accuracy (Elon NaN-guard:
     a kid can never see "NaN%"); <50% shows the encouragement line
     verbatim; always green mark; absent block → panel byte-identical.
  6. PASS — 1047/1047 node --test; astro build clean; founder gates PASS;
     LIVE on production (45ad174): real speech (Minny's own greeting via
     minny-voice, transcoded to canonical WAV) through check_mode=frame
     with practice_mode returned BOTH the deterministic rubric (75%
     coverage, 3 rubric rows) AND pronunciation { accuracy 78, fluency
     96, sampled_seconds 3.288 — measured, not the 30s cap }. Control
     probe: read-mode on prod scorer=azure_pronunciation 96% (new Azure
     key healthy post-rotation). Test-artifact note: an ffmpeg WAV with a
     LIST chunk was correctly null-skipped by the validator (working as
     designed); the app's own recorder (public/scripts/r2l-recorder.js
     line 335+) writes exactly the canonical 44-byte header, verified,
     so real kid recordings pass.
- Design self-verification: behavioral = the live production frame check
  above. Visual: the pronunciation row is one pattern-copy rubric row in
  the shipped Phase 7a panel (design-mock exempt as internal row
  addition, flagged for Phương's veto per V1-D6 precedent); its render
  logic is pure-function tested (absent/≥50/<50/NaN) in the page's own
  extracted-function test style.
- Founder handoff: plain-language report with the live result numbers +
  the budget watch note (F0 5h/month vs ~10h at full-class usage; paid
  ≈$1/audio-h is Phương's later call with meter data).
- Verified commit: 45ad174 (origin/main, production-verified live)
- Actual cost: USD 0 runtime (~33s of Azure F0 free tier consumed by the
  live verification).
- Review trail: Mark built (packet), Elon line-by-line (NaN-guard) +
  Buffet adversarial SHIP (probed trim + failure isolation; 2 nits
  folded: meter assertion, empty-WAV short-circuit).
- Started: 2026-07-11
- Completed: 2026-07-11

## Prior task (complete): speakup-v1-ladder-real-speech-wins

- Status: complete
- Task ID: speakup-v1-ladder-real-speech-wins
- Owner: Elon (Claude Lead), Tier-1 direct (one-condition change on the
  live kid path, founder-directed same-turn; dispatch-guard justification:
  founder ruling on live pilot behavior, hot path, smaller than a packet)
  + mandatory Buffet bg review (author ≠ reviewer). Phương decision
  2026-07-11 via AskUserQuestion: "Real speech always wins".
- Lane: `claude/speakup-v1-1` → `main` (founder's direction to fix live
  behavior = deploy ack).
- Problem: live E2E (R2L-HENRY-TJRH, L0) showed a fluent off-list answer
  gets the repair ladder ("let me ask again") instead of a real reply —
  founder: "kids do not speak at all if this is the case." Reading the
  trigger exposed a second case: a short but CORRECT answer ("dog",
  matches expected, <6 chars) also laddered.
- Fix: stall trigger becomes low-content AND unmatched (was OR) — the
  ladder rescues only genuinely unusable input; fluent off-list and
  short-correct answers go to the LLM. Vietnamese nudge, ladder state
  machine, guardrails, caps: untouched.
- Reuse survey: N/A — one boolean-condition change, no new capability.
- Cost ceiling: Claude team (Max plan, not metered); runtime USD 0.
- Acceptance criteria:
  1. Trigger = isLowContent AND !matchesExpected; comment states the
     founder rule.
  2. NEW tests: fluent off-list answer → LLM (no repair); short matched
     "dog" → LLM. Existing "um" stall tests unchanged and green.
  3. Full node --test green; astro build clean; founder gates PASS.
  4. Buffet review SHIP; live production re-test with R2L-HENRY-TJRH
     reproducing the exact failing sequence, now warm-replied.
- Files owned: functions/api/minny-conversation.js (trigger condition),
  tests/minny-conversation.test.mjs.
- Stop condition: any diff beyond those two files — stop.
- Acceptance criteria reconciliation:
  1. PASS — trigger is isLowContent AND !matchesExpected with the founder
     rule stated in the comment; Buffet confirmed the operator change is
     the entire source diff.
  2. PASS — both new endpoint tests pin the founder cases (fluent
     off-list → LLM, short-correct "dog" → LLM); existing "um" stall
     tests unchanged and green.
  3. PASS — 1030/1030 node --test; astro build clean; founder build gate
     PASS pre-push.
  4. PASS — Buffet SHIP (safety-additive: more kid speech rides the fully
     guardrail-screened LLM path; ladder never had safety duties). LIVE
     production re-test (R2L-HENRY-TJRH, L0, 2nd daily session, efb76a6):
     T2 "yes i love it so much thank you" after a chips turn → warm real
     reply ("You're welcome! I love dogs and cats too!"), NO repair;
     T4 short-correct "yes" → real reply, NO repair; OpenRouter answering
     at 357–2258ms. The "um"-rescue path wasn't reproduced live in this
     sequence (T2's reply carried no options, so no expected set was
     pending — the ladder correctly stayed out and the LLM handled "um"
     gracefully); the rescue-after-chips case is pinned by the unit suite
     and was observed live pre-fix.
- Design self-verification: N/A visual — behavioral evidence is the live
  production transcript above plus the two new endpoint tests.
- Founder handoff: before/after transcript in plain language, in-session.
- Verified commit: efb76a6 (origin/main, production-verified live by the
  re-test itself)
- Actual cost: USD 0 runtime (1 daily session of the founder-designated
  test student).
- Started: 2026-07-11
- Completed: 2026-07-11

## Prior task (complete): speakup-v1-merge-to-main

- Status: complete
- Task ID: speakup-v1-merge-to-main
- Owner: Elon (Claude Lead). Phương explicit merge ack 2026-07-11 ("merge
  V1.1, then text end to end with this code R2L-PILOT-CYJS") — ack covers
  the handoff that named the desktop-placement deviation.
- Lane: `main` (fast-forward of `claude/speakup-v1-1`: V1.1 brain 8b6995d +
  V1.2p1 chips UI fdb6fe5 + CSS fix 9073aa7 + governance ae71e00).
- Reuse survey: N/A — release/merge task, builds no new capability.
- Cost ceiling: Claude team (Max plan, not metered); runtime USD 0.
- Acceptance criteria:
  1. Fast-forward merge to main; 1028/1028 `node --test` + `astro build`
     clean on the merged tree; founder build gate PASS pre-push.
  2. Production serves the V1 build (chips CSS in hashed stylesheet,
     ft-handsfree-toggle markup on /speak-up/).
  3. Live E2E on PRODUCTION with pilot code R2L-PILOT-CYJS (text path, one
     session): real LLM reply with level-appropriate optional fields;
     repair ladder on a stall (if beginner level); Vietnamese nudge;
     caps decrement sane; two-phase audio proven if pending; zero
     guardrail flags on benign turns.
  4. AGENT_LOG START/DONE; reconciliation + complete gate; founder report.
- Files owned: merge only — no source edits under this task.
- Stop condition: any source diff beyond CONTROL/AGENT_LOG — stop. If the
  E2E shows a kid-facing defect: report to Phương with the revert option
  (git revert -m on the merge), do not hot-fix unbidden.
- Acceptance criteria reconciliation:
  1. PASS — fast-forward f11f005..009912f; 1028/1028 node --test + astro
     build clean on the exact pushed tree; founder build gate PASS.
  2. PASS — production serves V1 (minny-option-chip in hashed CSS,
     ft-handsfree-toggle markup on /speak-up/).
  3. PASS (with one config finding) — live E2E on production,
     R2L-PILOT-CYJS (level L4, so the correct surface is hints, not chips),
     5 text turns, 1 daily session used: real warm LLM replies with a hint
     on every turn and zero hint-leaks into reply_en; stall turn handled
     warmly by the LLM (no ladder at L4 without expected — by design);
     Vietnamese turn → vn_nudge canned line, repair_step field, model
     filled from the last hint ("play"), subtitle_vi, no LLM spend;
     two-phase audio proven (pending → fetched 29KB) + one inline cached
     hit; caps decremented 12→7 sanely; zero guardrail flags. FINDING:
     every LLM turn answered via llama_fallback (Workers AI) — OpenRouter
     never responded; llm_ms 2.0–17.2s (worst turn = double 4s OpenRouter
     timeout + fallback). Root-cause hypothesis: the 2026-07-11 key
     rotation replaced OPENROUTER_API_KEY but Cloudflare env vars
     (Production, likely Preview too) still hold the revoked key. Reply
     QUALITY unaffected (fallback is the same Llama-3.3-70B family, by
     design); latency is the casualty. Bounded founder ask: paste the new
     OpenRouter key into Cloudflare Pages env (Production + Preview) and
     redeploy. Chips protocol (L0–L2) not exercised on prod by this L4
     code — covered by the rule-20 preview verification + unit/eval suite.
  4. PASS — AGENT_LOG START/DONE; this reconciliation; founder report sent.
- Design self-verification: N/A visual (release task); behavioral evidence
  = the production E2E transcript above (5 live turns on the deployed
  main build).
- Founder handoff: turn-by-turn plain-language report + the one bounded
  ask (update OPENROUTER_API_KEY in Cloudflare, then any next Free Talk
  session should drop from ~4–17s brain time to ~1s).
- Verified commit: 009912f (origin/main, production-verified live)
- Actual cost: USD 0 runtime (1 pilot-code daily session used, ~5 LLM
  fallback turns ≈ free on Workers AI).
- Started: 2026-07-11
- Completed: 2026-07-11

## Prior task (complete): speakup-v1-2-packet1-chips-ui

- Status: complete
- Task ID: speakup-v1-2-packet1-chips-ui
- Owner: Steve (bg worker, sole owner of speak-up.astro + speakup css +
  UI tests, worktree `hub-main-speakup-merge`, no commits) to the approved
  Wave D Set 1 mock; Elon line-by-line review + integration; Buffet review;
  rule-20 deployed-preview screenshot vs mock by Elon. Packet:
  scratchpad/v12-steve-packet.md.
- Lane: branch `claude/speakup-v1-1` (stacks on V1.1 8b6995d; single
  combined branch for the V1.1+V1.2p1 preview + Phương ack).
- Gate: Wave D approved (Phương 2026-07-10, as-drawn) + V1.1 landed —
  both satisfied.
- Reuse survey: N/A — implements an approved internal design mock over the
  shipped ft-* chrome and the V1.1 API; no new external capability. (Mock
  itself reused Buddy.ai PPP chip pattern per its README, surveyed at
  design time.)
- Cost ceiling: Claude team (Max plan, not metered); runtime USD 0.
- Acceptance criteria (spec §V1.2 packet 1): per approved mock; whole-screen
  visual verification on the deployed preview (rule 20, SHA recorded);
  chips never render without server-sent options (level-gating test); tap
  reveals frame + arms mic, never submits (except mock's repair step-b
  two-choice state); hint fade states; hands-free toggle + listening
  indicator visible in-app; 44px targets; reduced-motion; iPad tap-to-play
  preserved; node --test green (baseline 1004).
- Stop condition: any functions/ diff — stop; backend is frozen
  post-review. (One authorized exception, Buffet-reviewed: the additive
  `repair_step` response field the approved mock's states require.)
  No merge to main without Phương's ack.
- Acceptance criteria reconciliation (spec §V1.2 packet 1):
  1. PASS — per approved Wave D Set 1 mock: chips (45px measured live),
     dashed starter hint, sentence frame + gold blank + green mic-armed
     line, repair-step tags with approved mock copy, oversized 56px
     repair-choice buttons, visible hands-free toggle with track/thumb +
     "Minny đang nghe…" indicator. Verified state-by-state on the
     DEPLOYED preview at 390 (chips / frame / repair-rephrase /
     repair-choices) + 1280.
  2. PASS — chips render only from server-sent options (level-gating
     asserted in tests AND behaviorally: a no-options turn cleared the
     scaffold live).
  3. PASS — tap reveals frame + arms mic, never submits (Buffet trace:
     ftOnChipTap has no fetch); the one exception, repair_step==='choices',
     tap-resolves via the guarded JSON turn path (verified live: tap →
     request fired → reply rendered → scaffold cleared).
  4. PASS — 44px targets (45/56px measured); reduced-motion per-selector
     rules; iPad tap-to-play + two-phase audio poll untouched (Buffet).
  5. PASS — 1028/1028 node --test; astro build clean; founder build gate
     PASS on both commits.
  6. DEVIATION (bounded, for Phương's ack) — at ≥1024px the scaffold sits
     in the left Minny rail (usable, coherent) rather than the mock's
     wider center-column demo frame; phone/tablet is the kids' primary
     surface. Phương decides: keep, or a follow-up packet anchors it into
     the transcript column.
- Design self-verification: rule-20 render check on the DEPLOYED preview
  (claude-speakup-v1-1.felixbuilderhub.pages.dev) via playwright with a
  routed test harness (synthetic API responses through the page's real
  code paths, fake mic; no real codes or sessions consumed). Screenshots
  in _ops: speakup-v12-final-chips-390.png, -frame-390,
  -repair-rephrase-390, -repair-choices-390, -repair-choices-1280, vs the
  approved mock (rendered reference: speakup-v12-mock-reference.png).
  Verdict: MATCH at 390 across all four states; desktop placement
  deviation recorded above. **This check caught a real ship-blocker**:
  Steve's CSS had been added to src/styles/speakup-free-talk.css — an
  ORPHANED stylesheet imported nowhere (only speakup-app.css loads via
  SpeakUpAppLayout) — so the first deploy rendered all new UI unstyled
  while 1028 tests passed and two reviews approved. Fixed by moving both
  hunks into speakup-app.css (9073aa7) and retargeting the CSS tests to
  the live file.
- Founder handoff: session report to Phương with the preview URL, the
  screenshot set, and three bounded asks (V1 branch merge ack; tick
  is_test on the test code; desktop-placement decision).
- Verified commit: 9073aa7 (origin/claude/speakup-v1-1, deployed preview
  re-verified serving the new CSS before the final screenshot set)
- Actual cost: USD 0 runtime.
- Review trail: Steve built (2 rounds), Elon line-by-line + integration +
  CSS-orphan fix, Buffet adversarial review incl. XSS probes (SHIP).
- Started: 2026-07-11
- Completed: 2026-07-11 (pending Phương's merge ack + desktop-placement
  decision)

## Prior task (complete): speakup-v1-1-freetalk-brain

- Status: complete
- Task ID: speakup-v1-1-freetalk-brain
- Owner: Elon (Claude Lead) authors all prompt/copy text verbatim
  (safety-adjacent precedent); Mark (bg worker) builds endpoint glue +
  tests in the `hub-main-speakup-merge` worktree on branch
  `claude/speakup-v1-1`; Buffet (bg, read-only) reviews — author ≠
  reviewer. Spec section: `_ops/specs/SPEC_SPEAKUP_V1.md` §V1.1
  (acceptance criteria adopted verbatim). Gate: Wave 0 DONE 2026-07-11.
- Lane: branch `claude/speakup-v1-1` (off main @ f11f005). Backend only —
  no UI (V1.2), no homework/brief data in this endpoint.
- Problem: every Free Talk turn must work for the kid's level — L1–L2
  answerable (chips protocol: options[]+expected[], fuzzy match, repair
  ladder) and L3–L5 topic-seeded production (hint field, L4–L5 game
  protocols: build-a-story / debate-from-allowlist / would-you-rather).
- Reuse survey: (1) existing `wordSimilarity`/`normalizeWord` utilities
  (read2lead-speaking-check.js) — ADOPT for expected-answer fuzzy matching
  (do not re-roll); (2) R2L `HUB_TOPICS` topic values (ho-so-topics.ts) —
  ADOPT as the topic vocabulary (UI tiles come in V1.2); (3) TPRS/PPP
  circling + expected-answer patterns (Buddy.ai/Amira, researched
  2026-07-10) — ADOPT as prompt technique; external structured-output
  libraries — REJECT (repo convention: raw fetch, no npm runtime deps).
- Cost ceiling: Claude team (Max plan, not metered); runtime ≈ $0 (same
  models, same call count; slightly longer prompts within 150-token replies).
- Acceptance criteria: spec §V1.1 checklist verbatim (reply JSON extension
  + level gating; start accepts topic/game with validation; L1–L2 fuzzy
  match fixtures; deterministic repair ladder max 2, no guardrail strikes,
  pre-written lines; debate allowlist test; VN heuristic before LLM spend;
  offline eval ≥80% answerable + hints only in hint field + question-rate
  40–60%; safety regression untouched; node --test green; founder gates).
- Files owned (Mark): functions/api/_minny-convo.js,
  functions/api/minny-conversation.js, functions/api/_minny-phrases.js,
  functions/api/read2lead-speaking-check.js (PROTECTED — minimal optional
  `prompt` param threading only, Buffet must trace),
  tests/minny-conversation.test.mjs, tests/minny-guardrails.test.mjs (only
  if assertions shift), scripts/eval-minny-freetalk-v11.mjs (new).
- Stop condition: any diff touching caps semantics, guardrail order,
  TTS chain internals, or homework scoring paths beyond the optional
  STT prompt param — stop and escalate. No merge to main without
  Phương's ack (per-phase merge cadence).
- Acceptance criteria reconciliation (spec §V1.1 checklist):
  1. PASS — reply JSON extends to {reply_en, mood, options?, expected?,
     hint?}; invalid optional fields dropped independently (parser tests);
     guardrails screen the WHOLE kid-visible surface incl. expected[]
     (adversarial banned-word-in-expected fixture); gateReplyForLevel is
     the single gating source (options/expected ≤L2 only, hint L3+ only;
     L0 maps to beginner — L0 is R2L's START_LEVEL, caught in review).
  2. PASS — start accepts topic (TOPIC_SEEDS key or minny_choice) and, at
     L4–L5, game; invalid → 400; L0–L2 silently ignore; session records
     topic/game/debate_topic; debate topic ALWAYS server-picked from
     DEBATE_TOPICS (30-draw test).
  3. PASS — garbled-but-near L1–L2 transcripts fuzzy-match via
     wordSimilarity (word-boundary-safe after the catapult fix); L3+
     passes open with topic-seeded Whisper initial_prompt bias.
  4. PASS — repair ladder deterministic, max 2 repair turns then move_on,
     never calls the LLM, never touches flags/strikes, canned Lead-authored
     lines; L3+ skips the two-choice step; ALL abandonment paths (move_on,
     guardrail flag, parse-failure redirect) clear chips bookkeeping —
     the last two found by Buffet's execution probe + Elon's review and
     regression-tested.
  5. PASS — debate allowlist constant; no protocol lets the kid set it.
  6. PASS — Vietnamese-diacritics heuristic fires before any LLM spend.
  7. PASS (with one WARN) — offline eval (real OpenRouter calls,
     scripts/eval-minny-freetalk-v11.mjs): L1–L2 chip coverage 100%
     (target ≥80%); L3+ hint coverage 100%, hint-in-reply leaks 0;
     debate drift 0; question-rate 61% vs 40–60% target on an 18-turn
     sample — one point high, small sample, watch in pilot logs rather
     than re-tune the prompt now.
  8. PASS — safety regression: guardrail order/caps/is_test/two-phase TTS
     untouched (Buffet traced + probed); 1004/1004 node --test (950
     baseline + 54 new); astro build clean; founder build gate PASS.
- Design self-verification: N/A visual (backend-only phase; UI is V1.2).
  Behavioral evidence = the offline eval transcript above (real LLM) +
  Buffet's direct execution probes of the flagged-turn and stall flows +
  the 1004-test suite. Live preview probe of the deployed branch recorded
  in AGENT_LOG (start-validation + text turn) — preview URL
  claude-speakup-v1-1.felixbuilderhub.pages.dev.
- Founder handoff: plain-language session report to Phương (chips brain
  built + triple-reviewed; V1.2 chips UI next so kids can actually see
  it; nothing merges to main without his ack).
- Verified commit: 8b6995d (origin/claude/speakup-v1-1)
- Actual cost: USD 0 runtime beyond ~US$0.01 of OpenRouter eval calls.
- Review trail: Mark built (2 fix rounds), Elon line-by-line (must-fix
  1–4), Buffet adversarial (must-fix 5, execution-probed, final SHIP).
- Started: 2026-07-11
- Completed: 2026-07-11 (pending Phương's merge ack per phase cadence)

## Prior task (complete): speakup-wave0-merge-to-main

- Status: complete
- Task ID: speakup-wave0-merge-to-main
- Owner: Elon (Claude Lead). Phương gave the explicit merge GO in-session
  2026-07-11 (AskUserQuestion answer: "Yes — merge V0 now"), after Wave 0
  founder items were reported ALL DONE incl. key rotation (deeab01). This
  closes Wave 0 — the hard blocker for all V1 code.
- Lane: `main` (merge of `origin/claude/speakup-v0`, 119 commits, all 8 V0
  phases + the Wave 0 fix round). Merge worktree `hub-main-speakup-merge`.
- Reuse survey: N/A — release/merge task, builds no new capability.
- Cost ceiling: Claude team (Max plan, not metered); runtime USD 0.
- Acceptance criteria reconciliation:
  1. PASS — merge conflict-free (main had 21 R2L commits, branch 119 SpeakUp
     commits, zero overlapping hunks); merge commit ff5b1a3.
  2. PASS — 950/950 `node --test` on the merged tree (V0's 903 + main's R2L
     suites); `astro build` clean, 25 pages.
  3. PASS — founder build gate PASS after opening this task (pre-push).
  4. PASS — pushed f6d0cfa..72e589b to origin/main; Cloudflare production
     verified live: `/speak-up/` serves the app (title "SpeakUp — Luyện nói
     cùng Minny"), `/api/minny-speaking-context` answers correctly
     (code_not_found for an invalid code), `deploy-marker.txt` 200 (file
     exists only in the merged build — proves prod rebuilt from the merge).
  5. PASS — Wave 0 tracker row DONE; AGENT_LOG START + DONE logged.
- Design self-verification: N/A visual (release task, no UI change) —
  behavioral verification is the production smoke test in criterion 4,
  run against the live https://felixbuilderhub.com after the deploy.
- Founder handoff: in-session plain-language report to Phương (V0 live,
  pilot can start; V1.1 dispatch next per his three in-session decisions).
- Verified commit: 72e589b (origin/main, production-verified live)
- Actual cost: USD 0 runtime.
- Started: 2026-07-11
- Completed: 2026-07-11

## Prior task (complete): speakup-v0-test-code-cap-bypass

- Status: complete
- Task ID: speakup-v0-test-code-cap-bypass
- Owner: Elon (Claude Lead), Tier1 direct (~10-line single-endpoint change;
  dispatch-guard justification stated; mandatory Buffet review — author ≠
  reviewer). Phương GO 2026-07-11 on the presented plan.
- Lane: `claude/speakup-v0` (pre-merge V0 branch).
- Problem: Phương needs to test Free Talk repeatedly; the 3-sessions/day cap
  blocks him (and diagnosis burns real session budget — it consumed all 3 of
  the test code's sessions on 2026-07-10).
- Fix shape (approved): codes with the existing `is_test: true` KV field skip
  the daily-3 cap AND don't increment the daily/global counters (test runs
  never burn the kids' global 60/day kill-switch budget). Guardrails, session
  caps (12 turns/5 min), rate limiting, ownership checks: unchanged — never
  bypassed. Flag is server-side only (admin-set via the existing codes
  endpoints), not client-settable.
- Reuse survey: N/A — no new capability built; this flips the semantics of
  the existing `is_test` record field (already created/edited by
  admin/codes.js + admin/codes/[code].js, already consumed by
  read2lead-progress.js) inside one existing endpoint. Nothing external to
  adopt for a 10-line cap exemption.
- Cost ceiling: Claude team (Max plan, not metered); runtime USD 0.
- Acceptance criteria reconciliation:
  1. PASS — dedicated test: 5 consecutive starts succeed for an is_test
     code; no `convo-daily:`/`convo-global:` key ever written.
  2. PASS — dedicated test: normal code blocks at 3 (429 daily_cap,
     byte-identical response) and increments both counters; plus the
     pre-existing daily-cap test (fixture corrected to a normal code —
     Buffet verified empirically the old fixture would now hard-fail, so
     the flip preserves intent and coverage strictly increased).
  3. PASS — Buffet traced every excluded surface: guardrails, session caps,
     rate limiting, ownership all structurally independent of is_test;
     client cannot forge the flag (KV record only; writes behind
     ADMIN_PASSWORD middleware).
  4. PASS — 903/903 `node --test`; astro build clean; founder build gate
     PASS; Buffet verdict SHIP, zero findings.
  5. PASS (deploy) / HANDOFF (live bypass) — 4e6916e deployed to preview
     (serving, ~90s); live sanity: normal code still returns 429 daily_cap
     (DangNemo, capped from diagnosis sessions — proves it is NOT yet
     is_test). Phương's step: tick `is_test` on the test code in the admin
     codes screen (or create a fresh code with the box checked), then run
     >3 sessions. Note: the daily counter tracks UTC days — it resets 7:00
     sáng giờ VN (pre-existing behavior, unchanged).
- Verified commit: 4e6916e (origin/claude/speakup-v0), deployed to preview.
- Actual cost: USD 0 runtime.
- Started: 2026-07-11
- Completed: 2026-07-11

## Prior task (complete): speakup-v0-freetalk-perceived-latency

- Status: complete
- Task ID: speakup-v0-freetalk-perceived-latency
- Owner: Elon (Claude Lead), Tier1 direct build (tightly-coupled client+server
  protocol change with live-debug iteration; dispatch-guard justification
  stated per rule; mandatory Buffet review — author ≠ reviewer). Plan file:
  `~/.claude/plans/golden-tinkering-prism.md` (Phương-approved 2026-07-10
  after his Wave 0 test report "free talking still way too slow").
- Lane: `claude/speakup-v0` (V0 fix round, pre-merge; part of the Wave 0
  fix-round slot the session-close note anticipated). No V1 features.
- Problem: live measurement 2026-07-10 (test code R2L-DANGNEMO-2UNF, 3 real
  turns on the deployed preview): 5.5–6.3s per turn on the TEXT path alone
  (kid path adds STT + capture ≈ 7–9s perceived). Per-stage timing shows TTS
  (Aura-2) 3.2–3.5s on cache misses is the dominant cost; LLM 1–3s; ~1.4s
  edge/network overhead. Yesterday's "4s" is not holding.
- Fix shape (approved): two-phase turn — the reply TEXT returns as soon as
  LLM + guard finish (guard still gates any display; safety order unchanged);
  TTS completes in the background (`context.waitUntil`) and lands in KV; the
  client shows the text immediately and fetches/plays audio when ready
  (existing browser speechSynthesis stays the last-resort fallback). Plus a
  TTS-latency investigation (first-byte vs full-body; MeloTTS comparison)
  recorded in this task, not guessed.
- Reuse survey: (1) SSE/streaming TTS via Workers AI streaming API — REJECT
  for this round (Aura-2 on the `env.AI` binding returns a complete audio
  blob; a streaming rework is the deferred Step-D item in IDEAS.md, not a
  pre-merge fix); (2) Cloudflare `context.waitUntil` + KV handoff (platform
  primitive, documented Pages Functions API) — ADOPT for background TTS;
  (3) client Web Audio streaming libs (howler.js etc.) — REJECT (repo
  convention: no npm runtime deps; plain Audio element already plays b64
  WAV/MP3 fine).
- Cost ceiling: Claude team (Max plan, not metered); runtime USD 0 (same
  models, same call count — one extra KV read/write per turn, free tier).
- Acceptance criteria reconciliation:
  1. PASS — turn returns after LLM+guard; audio inline only when the synth
     already settled (cache hits), else `audio_pending` + owner-stamped KV
     record via waitUntil, fetched by `action:'audio'`; guard order/flag
     semantics unchanged (tests + Buffet trace, both rounds).
  2. PASS — guard-flag test proves no `convo-audio:` record is ever stored
     for a flagged reply (`waits.length === 0` + post-settle KV scan).
  3. PASS — text renders immediately; poll plays audio on arrival; failed/
     timeout → old no-audio fallback; `stale()` (token + session + ended)
     kills the poll on new turn / record start / End button / cap wrap-up
     (Buffet must-fix, applied + re-verified by him in f6caa87).
  4. PASS — 900/900 `node --test`; astro build clean (25 pages); founder
     build gate PASS.
  5. PARTIAL (honest record, measurement conditions attached) — live probe
     on the deployed preview (3 fresh-text turns, cold TTS cache, JSON text
     path, 2026-07-10 ~23:45 VN): two-phase mechanism verified live
     (turn 1: text returned, deferred audio fetched +3.1s later; turn 2:
     3.5s with inline audio). BUT the run caught degraded providers: one
     16s turn (OpenRouter timed out twice → slow Workers-AI fallback) and
     one 8.9s turn (Llama Guard ran to its full 6s timeout — fixed same
     session: timeout now 3.5s, commit 63e371b, Buffet SHIP). Healthy-
     provider turns meet the ≤ ~3.5s time-to-text target; the compound-
     failure tail does not, and could not be re-measured tonight (test
     code's 3/day free-talk sessions consumed by diagnosis).
- Residuals (open, logged):
  1. OpenRouter worst case: 2 × 4s timeouts before the Workers-AI fallback
     → up to ~8s LLM stage on a double blip. Candidate fix for its own
     pass: retry only on fast failures, never after a full timeout.
  2. Watch `guard_degraded` rate in debug:convo-flags after the 3.5s guard
     timeout ships (Buffet should-watch): confirm fail-open isn't
     materially more frequent than at 6s.
  3. One live turn served a canned redirect despite a fast OpenRouter
     answer (parse failure on a valid-looking reply) — single occurrence,
     watch the ring.
  4. Fresh cold-cache live re-measure with a real VOICE turn (STT included)
     — tomorrow, Phương's test or a spare test code.
- Verified commits: f6caa87 (two-phase turn + Buffet fixes), 63e371b (guard
  timeout 3.5s) — both on origin/claude/speakup-v0; preview deploy of
  f6caa87 confirmed live (new action:'audio' answered 200) and probe-tested.
- Actual cost: USD 0 runtime (same models/call count; +1 KV read/write per
  deferred turn).
- Started: 2026-07-10 (late evening)
- Completed: 2026-07-10 (late evening)

## Prior task (complete): speakup-v1-freetalk-content-model

- Status: complete
- Task ID: speakup-v1-freetalk-content-model
- Owner: Elon (Claude Lead). Plan file:
  `~/.claude/plans/inherited-jingling-babbage.md` (Phương-approved evening
  revision 2026-07-10, after his mode-separation decisions).
- Lane: `claude/speakup-v0` (IDEAS/CONTROL/design handoff) + `_ops` main
  (spec revision). No product code — docs + Wave D2 design dispatch only.
- Problem: Phương clarified the product model (evening 2026-07-10): the two
  modes are cleanly separated — Free Talk must NOT involve homework and has
  NO photos; L1–L2 stay guided (chips), L3–L5 get topic-spark + hints on
  demand + L4–L5 production games (former V1.P); homework understanding
  (brief) exists only for feedback, generated at assign time with his
  confirm. The morning spec needed revision before any build phase runs on
  a superseded design.
- Reuse survey: external per rule 21 — (1) OpenRouter JSON-schema mode for
  brief generation: ADOPT (existing key + the shipped JSON-mode pattern in
  minny-conversation.js); (2) Vercel AI SDK / Instructor-style structured-
  output libraries: REJECT (repo convention: raw fetch, no npm runtime deps
  in functions/ — same verdict as V0 D0); internal pattern-reuse noted
  separately (not claimed as the external survey): HUB_TOPICS +
  TopicTile.astro + r2l/start.astro grid (topic picker),
  homework-photo-extract.js draft→confirm flow (brief preview),
  TOPIC_LABELS prompt pattern from backend/api/prompt_v2.py (replicated
  edge-side).
- Approach: (A) IDEAS.md 3 evening decision rows; (B) full revision of
  `_ops/specs/SPEC_SPEAKUP_V1.md` (V1-D3 rewritten, V1-D2 level-split,
  NEW V1-D6 homework brief, V1.1/V1.2/V1.3 rescoped, NEW V1.3b, V1.P
  folded, Wave D2 section); (C) this CONTROL update (tracker + task);
  (D) dispatch Wave D2 mock set to Steve (allowlisted folder
  `design_handoff_speakup_v1_d2/`), Lead renders + reviews, present to
  Phương as ONE combined approval pass with the pending Wave D.
- Acceptance criteria:
  1. Spec/IDEAS/CONTROL consistent with Phương's three recorded evening
     decisions (mode separation + no photos; topic-spark/hints/games with
     R2L topic-pick reuse; brief with teacher confirm). No product code
     touched.
  2. founder build gate PASS on product-repo commits.
  3. Wave D2 handoff produced, Lead-rendered, committed with SHA, and
     presented to Phương together with Wave D (single approval pass).
- Files: `.founder-os/products/speakup/IDEAS.md`, this file,
  `_ops/specs/SPEC_SPEAKUP_V1.md`, `_ops/AGENT_LOG.md`,
  `design_handoff_speakup_v1_d2/` (new, design artifacts only).
- Stop condition: any product-code diff — stop; build phases remain gated
  on Wave 0 + approved mocks per the spec. No merge to main.
- Cost ceiling: Claude team (Max plan, not metered); runtime USD 0.
- Acceptance criteria reconciliation:
  1. Consistency with Phương's three evening decisions — PASS (IDEAS rows +
     revised spec d683b06 on _ops [push held for ack] + this tracker; no
     product code touched, verified via git diff scope).
  2. founder build gate — PASS (1b8d4d0, e903682).
  3. Wave D2 handoff — PASS (Steve bg-worker authored
     `design_handoff_speakup_v1_d2/` [1 mock file, 8 states × 2 breakpoints,
     + README with 5 open questions]; Lead rendered + reviewed; committed
     e903682; presented to Phương as the combined Wave D + D2 approval pass).
- Design self-verification: mock rendered by Lead via playwright + local
  http server → full-page screenshot `_ops/speakup-v1-d2-1280.jpeg`.
  Verdict: MATCH vs spec Wave D2 scope — 12 HUB_TOPICS tiles + "Minny chọn
  🎲" in the r2l 3-col grid pattern; L4–L5 variant adds 3 distinct game
  cards; hint states idle/offered/revealed (one word EN+VN card that
  re-hides); story-strip / debate-banner / would-you-rather framings on
  unchanged ft-* conversation chrome; NO chips, NO sentence frames, NO
  photos in any L3+ screen (founder constraint checked board-by-board).
  Steve's own render attempt failed in his sandbox (honestly flagged); his
  static checks (html.parser balanced, 0 orphan classes) + Lead's rendered
  screenshot together cover it. Review surface = committed handoff e903682
  on origin (rule-20 pattern for design phases, per Wave D precedent).
- Founder handoff: in-session combined approval package — Wave D (f141620)
  + Wave D2 (e903682) + the V1-D6 teacher-panel design-mock exemption
  (vetoable) + 9 bounded questions (4 from Wave D README, 5 from Wave D2
  README). _ops spec push awaiting Phương's ack.
- Verified commit: e903682 (on origin/claude/speakup-v0)
- Actual cost: USD 0 runtime.
- Started: 2026-07-10 (evening)
- Completed: 2026-07-10 (evening)
- Addendum 2026-07-10: **Phương APPROVED Wave D + Wave D2** (as-drawn; README
  open questions resolve to the mocks' defaults; Vietnamese copy tone pass
  rides the build phases; V1-D6 teacher-panel exemption not vetoed) and
  acked the _ops push (0c7e311..dc9675e). Design side of V1.2/V1.4 is now
  unblocked; build remains gated on Wave 0.

## Prior task (complete): speakup-v1-spec-and-design

- Status: complete
- Task ID: speakup-v1-spec-and-design
- Owner: Elon (Claude Lead) — niche strategy + V1 roadmap ratified by Phương
  in-session 2026-07-10 ("GO AHEAD"); this task executes the docs/spec/design
  leg only. Plan file: `~/.claude/plans/inherited-jingling-babbage.md`
  (Phương-approved 2026-07-10).
- Lane: `claude/speakup-v0` (IDEAS.md/CONTROL.md) + `_ops` main (spec). No
  product code lane — V1 build phases are each their own future task.
- Problem: V0 measures performance but doesn't cause improvement (founder's
  2026-07-09 "45% only" test), and free talking fails low-level kids (don't
  know what to say; mistranscribed speech → bad replies). Strategy session
  ratified the "Coach's Gym" niche (own coaching only, architected to keep the
  white-label path open) and a 2-pillar V1.
- Reuse survey: N/A — governance/spec/design-mock task, builds no new product
  capability. (Per-phase reuse surveys are mandated inside
  `SPEC_SPEAKUP_V1.md` for each build phase; market research 2026-07-10
  already surveyed external options: Azure PA retained, Speechace fallback,
  Whisper prompt-bias, Buddy.ai/Amira/TPRS interaction patterns as prompt/UI
  technique, no new vendors.)
- Approach: (1) five new V1 idea rows appended to IDEAS.md (24h clock started;
  rows dated 2026-07-10); (2) `_ops/specs/SPEC_SPEAKUP_V1.md` written —
  V1-D1..D5 decisions + Wave 0/D + phases V1.1–V1.4 committed, V1.5–V1.7 HELD
  for pilot evidence; (3) this CONTROL.md update + AGENT_LOG START; (4) Wave D
  dispatched to Claude Design → `design_handoff_speakup_v1/` for Phương's
  approval.
- Acceptance criteria:
  1. IDEAS.md rows + spec + CONTROL.md consistent with the ratified plan; no
     product code touched.
  2. founder build gate PASS on the product-repo commit.
  3. Wave D handoff folder produced (both mock sets) and presented to Phương.
- Files: `.founder-os/products/speakup/IDEAS.md`, this file,
  `_ops/specs/SPEC_SPEAKUP_V1.md`, `_ops/AGENT_LOG.md`,
  `design_handoff_speakup_v1/` (new, design artifacts only).
- Stop condition: any product-code diff under this task — stop; V1 code starts
  only after Wave 0 (V0 merge) under per-phase tasks. No merge to main.
- Cost ceiling: Claude team (Max plan, not metered); runtime USD 0 (docs +
  local HTML mocks; no paid APIs).
- Acceptance criteria reconciliation:
  1. IDEAS/spec/CONTROL consistency — PASS (5 IDEAS rows bc5339a + production
     row 5123ab4; spec 20d1072 + V1.P amendment 449b985 on _ops main; V1
     tracker above; mid-task founder corrections folded in same-turn:
     red-team DONE d48e315, production ladder 5123ab4).
  2. founder build gate — PASS (each product-repo commit).
  3. Wave D handoff produced + presented — PASS (Steve bg-worker authored
     `design_handoff_speakup_v1/` [2 mock sets + README], Lead review below,
     committed 0705206; presented to Phương in-session with 5 open questions:
     Steve's 4 README questions + V1.P task-order confirmation).
- Design self-verification: both mocks rendered by Lead via playwright +
  local http server (Steve's chrome-extension attempt honestly failed;
  Lead re-ran the visual check) — full-page screenshots
  `_ops/speakup-v1-set1-1280.jpeg` (choice chips: 6 states × phone/desktop;
  chips → frame reveal → L3 no-hint → repair ladder a/b/c; hands-free toggle
  + listening indicator) and `_ops/speakup-v1-set2-1280.jpeg` (feedback
  sandwich celebrate 82% / encourage 48% under the UNCHANGED shipped
  score/rubric card; skippable fix-it invitation → compare/re-record →
  celebrate). Verdict: MATCH vs spec Wave D scope, existing navy/gold/cream
  system + shipped class values, nothing extra/missing. Caveat recorded:
  mocks are not deployed pages — review surface is the committed handoff
  files themselves (0705206 on origin), consistent with prior 7a/7b design
  phases. Level-gating section added to README by Lead post-Steve (his run
  finished before the founder's production-ladder correction reached him).
- Founder handoff: in-session report to Phương with both rendered
  screenshots + the 5 bounded questions (4 Steve README items: repair-step-b
  tap exception, focus-word cardinality, provisional copy pass, koala
  placeholder; + confirm V1.P order presentation → story → debate). Approval
  = Wave D acceptance; copy tone pass can ride the approval.
- Verified commit: 0705206 (on origin/claude/speakup-v0; design handoff —
  review surface is the handoff itself + rendered screenshots in _ops, no
  deployed page exists for mocks)
- Actual cost: USD 0 runtime (docs + mocks; screenshots local).
- Started: 2026-07-10
- Completed: 2026-07-10 (Wave D approval itself remains OPEN with Phương —
  tracked in the V1 phase tracker above, not by this task)

## Prior task (complete): speakup-freetalk-latency-quality-phase1

- Status: complete (24s → 4s live-verified; Steps A/B/C + VAD shipped, Step D
  deferred — see the full record below)
- Task ID: speakup-freetalk-latency-quality-phase1
- Owner: Elon (Claude Lead) — plan-mode investigation + Phase-1 build; Buffet
  (Sonnet, read-only) independent review. Plan file:
  `~/.claude/plans/you-are-elon-this-snappy-owl.md` (Phương-approved 2026-07-10).
- Lane: `claude/speakup-v0` (worktree `~/work/repos/speakup-minny-react`).
- Problem: founder reports the Free Talking record→AI-reply flow is too slow and
  answers feel weak. Investigation (3 parallel Explore agents) found the latency
  is structural: every kid utterance makes TWO sequential browser→edge trips
  (STT endpoint, then LLM+TTS endpoint), and within the 2nd the Llama Guard (6s)
  runs sequentially BEFORE TTS, plus a 7s×2 LLM timeout tail; answer quality is
  floored by the cheapest brain tier (deepseek-v4-flash).
- Reuse survey: N/A — tuning/parallelizing the existing Phase 6 pipeline and a
  model-tier bump; builds no new external capability.
- Approach (APPROVED — 2 phases, quick-wins first): **Phase 1 (this task,
  low-risk, one file `functions/api/minny-conversation.js`):** (a) LLM hot-path
  timeout 7s→5s + `temperature:0.8`, retry loop unchanged; (b) brain
  `deepseek-v4-flash`→`deepseek-v4-pro` (founder-picked mid step); (c) run
  `screenWithLlamaGuard` CONCURRENTLY with `synthesizeOrNull` via `Promise.all`
  (deterministic gate still short-circuits first; on ML flag the synthesized
  audio is discarded and a canned redirect returned). **Phase 2 (next task):**
  merge the two round-trips into one voice-turn endpoint (reuse existing STT
  helper). Not started.
- Acceptance criteria (Phase 1):
  1. Timeout 5s + temperature 0.8 on the OpenRouter call; brain is
     `deepseek/deepseek-v4-pro`; fallback to Workers AI Llama unchanged.
  2. Guard + TTS run concurrently; safety unchanged — no reply audio ever
     returned without passing the deterministic gate AND (ML guard OR degrade).
  3. `node --test` green + founder build gate PASS.
  4. Live re-verify on the deployed preview: real varied Minny replies at human
     pace, measurably lower per-turn latency (client `ft.turnTimings`).
- Files: `functions/api/minny-conversation.js`,
  `tests/minny-conversation.test.mjs`.
- Stop condition: no change to deterministic wordlists, caps, the kid transcript
  screen, or the protected recorder pipeline. No merge to main.
- Cost ceiling: Claude team (Max plan, not metered); runtime = small per-turn
  bump from flash→pro (still cheap at ≤20-student pilot), TTS/guard call count
  unchanged (parallelized, not added).
- Design self-verification: Phase-1 code 895/895 tests green (added an e2e test
  forcing an ML-guard flag on the new concurrent path → asserts canned redirect,
  no leaked model reply). Buffet review: APPROVE (safety unchanged, no dead code,
  Promise.all cannot reject → fallback intact). LIVE preview re-verify PENDING.
- Verified commit: 80f6a5a pushed to origin/claude/speakup-v0 (Phase 1).
- REVISED 2026-07-10 (live test = **~24s/turn**, unacceptable): Phase-1 tuning
  insufficient — serial slow-provider stack across two round-trips; the
  flash→pro bump likely worsened brain latency (Pro > 5s timeout → retry →
  fallback). Founder-approved new direction: (A) **instrument** per-stage
  latency then (B) **fast brain via existing OpenRouter key** (route to
  Groq/Cerebras Llama-3.3-70B, sub-1s), (C) merge round-trips, (D) stream voice.
  Speed chosen over the Pro quality bump. Step A (instrumentation: llm/guard/tts
  timing ring + response `timing` field + debug endpoint) built, Buffet APPROVE,
  pushed a741ac3.
- Step B DONE (founder chose "just fix it now" — measuring was blocked: debug key
  not set + must not spray student codes at the live endpoint): primary brain
  deepseek-v4-pro → meta-llama/llama-3.3-70b-instruct via OpenRouter with
  provider {sort:throughput, require_parameters:true} (routes to
  Groq/Cerebras/SambaNova, ~0.5-1s), timeout 5s→4s. Workers-AI Llama-3.3-70B
  fallback is now the SAME model family. OpenRouter slug + provider params
  docs-verified. 895 tests green, Buffet review in flight. The deployed timing
  ring will confirm the speedup on the founder's next real session (expect llm_ms
  ~15-20s → ~1s, llm_source openrouter).
- Reuse survey (Step B): OpenRouter provider routing to Groq/Cerebras (ADOPTED —
  free fast inference on the existing key, no new account) vs Gemini 2.0 Flash
  (rejected — needs a new API key/account) vs staying on DeepSeek (rejected — the
  measured bottleneck). Reuses external fast-inference infra via the existing key.
- Founder tested Step B: **24s → ~7s** (brain confirmed as the bottleneck).
  Founder asked to push further + research trending apps (Airlearn/Speak).
  Research 2026-07-10: they use streaming cascaded (fast) or speech-to-speech
  (Realtime API — fastest but removes the text step our guardrails need; logged
  to IDEAS.md as explore-later). Next latency work (founder-approved): VAD trim +
  Step C merge + Step D streaming voice; target ~2-3s to first sound.
- VAD trim DONE: FT_VAD_PAUSE_MS 1500→900ms in speak-up.astro (~0.6s free; the
  trailing-silence window sat entirely in the child's wait). Tunable up if kids
  get clipped mid-thought.
- Step C DONE (merge two round-trips): client uploads audio once to
  /api/minny-conversation (multipart); server transcribes via the reused
  read2lead `transcribeAudio` Whisper orchestrator, then runs the existing
  brain/guardrail/TTS pipeline; all turn responses now carry `transcript` +
  `timing.stt_ms`. Removes a browser↔edge round-trip + a 2nd function cold-start
  per turn. read2lead-speaking-check.js unchanged (still used for homework;
  imported, not modified). 896 tests green (+merged-path test), Buffet review in
  flight.
- Reuse survey (Step C): reuse existing `transcribeAudio` STT orchestrator
  (ADOPTED — do not re-roll Whisper). N/A external — this merges our own
  round-trips, no new capability.
- OUTCOME (2026-07-10): founder re-tested after Step C+VAD → **~4s/turn**
  (24s → 7s → 4s across Steps B/C/VAD). Latency goal for this session met.
- Hands-free finding (NOT a code bug): founder had to tap record/end every turn.
  Diagnosed to a stale `localStorage['r2l_ft_handsfree']='0'` in his browser
  (the manual escape-hatch flag; nothing in code sets it). Cleared it
  (`localStorage.removeItem` + reload) → hands-free auto-arm + VAD auto-send work.
  Follow-up idea logged: a visible in-app hands-free toggle + "listening…"
  indicator so the state can never be silently stuck (see IDEAS.md).
- Step D (stream voice) DEFERRED — own design needed (guard-before-stream safety
  tradeoff); at ~4s the founder chose to stop here. Streaming STT is the other
  candidate if more speed is wanted later.
- NEXT (founder-approved 2026-07-10): **speech-to-speech cost-comparison spike** —
  a throwaway S2S test (OpenAI Realtime / Gemini Live), decide build/no-build on
  cost ($/5-min-session vs today's near-free cascaded), a kid-safe moderation
  design without the text step, and whether the naturalness beats the current ~4s.
  Its own session + Founder-OS gate + cost ceiling. Detail in IDEAS.md.
- Status: this latency task's shipped scope (Steps A/B/C + VAD) is COMPLETE and
  live-verified on preview; main still untouched (awaits founder merge decision).
- Started: 2026-07-10

## Prior task (complete): speakup-freetalk-guardrail-degrade-gracefully

- Status: complete
- Task ID: speakup-freetalk-guardrail-degrade-gracefully
- Owner: Elon (Claude Lead) — plan-mode investigation + fix; Buffet (Sonnet,
  read-only) independent review. Plan file:
  `~/.claude/plans/kind-doodling-teapot.md` (Phương-approved 2026-07-09).
- Lane: `claude/speakup-v0` (worktree `~/work/repos/speakup-minny-react`).
- Problem: first-ever real live Free Talk test on the deployed preview (code
  R2L-KHANHVY-B7YR) returned only canned redirects + early wrap — benign kid
  turns were guardrail-SAFETY-FLAGGED. Root cause: `screenWithLlamaGuard`
  (`@cf/meta/llama-guard-3-8b`) fail-closed on EVERY reply (it ran on every
  turn), so any guard infra hiccup (timeout/empty/unparsed/binding) blocked all
  conversation → 2 flags → early wrap. Deterministic checks were proven sound
  (word-boundary matched) — not the cause.
- Reuse survey: N/A — bugfix/hardening of the existing Phase 6 guard; builds no
  new capability. (Cloudflare Workers AI llama-guard-3-8b docs consulted for the
  correct messages[] request + {response} output shape.)
- Approach (APPROVED — "degrade gracefully"): deterministic word-list checks
  stay the hard always-on kid-safety gate; the ML guard becomes resilient —
  flags ONLY a genuine parseable "unsafe" verdict, and on infra failure
  (unavailable/error/timeout/empty/unparsed) returns `degraded:true` → caller
  delivers the reply (deterministic gate already passed) and records the
  degradation to the debug ring (NOT a safety flag, no early-wrap). Also fixed
  the call to pass the kid+assistant exchange (Llama Guard classifies a
  conversation, not a lone assistant message) and read the Workers AI
  `{response}` shape; timeout 4s→6s.
- Acceptance criteria:
  1. `screenWithLlamaGuard` returns `{flagged,degraded,category,raw}`; infra
     failures degrade (flagged:false), genuine unsafe still flags.
  2. Caller passes transcript to the guard + records `guard_degraded` without
     counting a safety flag. Caps/redirects/early-wrap for genuine flags
     unchanged.
  3. Deterministic gate still blocks bad content even when the guard is down
     (unit + e2e test).
  4. `node --test` green + founder build gate PASS.
  5. Live re-verify on the deployed preview: real varied Minny replies, no early
     wrap, ~40% question-rate; `debug:convo-flags` shows no infra flags on
     benign turns.
- Files: `functions/api/_minny-guardrails.js`,
  `functions/api/minny-conversation.js` (guard call site + degraded record),
  `tests/minny-guardrails.test.mjs`, `docs/ENV.md` (documented
  OPENROUTER_API_KEY + DEBUG_SPEAKING_KEY).
- Stop condition: no change to deterministic wordlists, caps, TTS, or the kid
  transcript screen. No merge to main.
- Cost ceiling: Claude team (Max plan, not metered); runtime unchanged (same
  guard model, 1 call/turn).
- Design self-verification: LIVE re-verify on the deployed preview @ dd678f4
  (code R2L-KHANHVY-B7YR, 5-turn benign conversation): **guardrail fix
  CONFIRMED** — no early wrap-up (ran all 5 turns, 11→10→9→8→7; was dying at
  turn 3 before), and a real react-first Minny reply now gets through ("A white
  and black cat sounds so pretty! I bet they love to play.", turn 2), proving
  the guard no longer false-flags and the degrade path delivers. Unit/e2e:
  887/887 (added an e2e test for a genuine unsafe verdict → redirect + model
  flag, per Buffet). Buffet review: APPROVE. HOWEVER a SEPARATE issue is now
  visible: 4/5 turns are still canned redirects via the LLM-parse-failure path
  (redirect_1/3/4/5 counter, NOT guard flags) — the DeepSeek brain isn't
  answering on most preview turns, so they ride the llama fallback which returns
  non-JSON → redirect. Most likely OPENROUTER_API_KEY is not active on the
  PREVIEW env specifically (per-environment), or DeepSeek is timing out (8s).
  This is a brain-reliability issue, NOT the guardrail — tracked as the next
  step (verify Preview key + harden the fallback to emit parseable JSON).
- Follow-on (brain-reliability, aef1f40): 2nd live check (after Phương added
  the Preview key + redeployed) confirmed DeepSeek now answers (turn 1 real
  react-first reply) and no early wrap — but turns 2–5 still fell to canned
  redirects via the LLM-parse-failure path, because a per-turn OpenRouter blip
  drops to the llama fallback whose free-form output never parsed as strict
  JSON. Hardened the brain block: DeepSeek retry-once on transient failure;
  llama fallback now requests JSON (with a plain-call retry); new `coerceReply`
  salvage recovers prose/fence-wrapped or plain-text replies. Salvaged replies
  still pass every guardrail. 893/893, founder build gate PASS, Buffet review
  in progress. LIVE re-verify of the hardening DEFERRED — all 3 daily sessions
  on R2L-KHANHVY-B7YR are spent today; needs a spaced real conversation (Phương
  on device, or next session after the daily reset). This is exactly the case
  the EVOLUTION_LOG proposal (dedicated QA code with relaxed caps) would unblock.
- Verified commit: on origin/claude/speakup-v0 — dd678f4 (guardrail fix,
  verified LIVE) + aef1f40 (fallback hardening) + d8255fa (Buffet finding:
  bound coerceReply + llama max_tokens) + f29dcce (Buffet REQUEST CHANGES:
  d8255fa's input-slice hid JSON after a long preamble → replaced with
  brace-index locate; his repro encoded as a passing regression test). Final:
  894/894, founder build gate PASS, Buffet APPROVE.
- FALLBACK HARDENING LIVE RE-VERIFY: **PASS (2026-07-09, two fresh codes at
  human pace)**. Ran the paced (~6s/turn) live check against the deployed
  preview with R2L-TUANH-X45M and R2L-RYAN-5KGW: **all 5 turns REAL react-first
  Minny replies on BOTH codes, zero canned redirects, no early wrap**
  (turns_left 11→10→9→8→7), question-rate 60% and 40%. Confirms (a) the
  guardrail fix (no false flags), (b) DeepSeek answers every turn on the Preview
  env at human pace, and (c) the react-not-interrogate prompt. Root cause of
  yesterday's turns-2–5 redirects CONFIRMED as a test artifact: firing turns
  back-to-back tripped OpenRouter rate-limiting; at real pace every turn gets a
  real reply. The whole Free Talking feature is now verified working end-to-end.
  Ready for Phương's QA-together pass + merge decision (main still untouched).
- Started: 2026-07-09

## Prior task (built + pushed, live-blocked then unblocked): speakup-freetalk-react-not-interrogate

- Status: built + pushed to origin/claude/speakup-v0; live verification was
  blocked by the guardrail bug above, now being fixed under
  speakup-freetalk-guardrail-degrade-gracefully.
- Task ID: speakup-freetalk-react-not-interrogate
- Owner: Elon (Claude Lead) direct edit — verbatim-authored prompt content
  (kid-facing, safety-adjacent conversational behavior; judgment-heavy
  authorship kept at Lead per `~/.claude/rules/claude-bg-dispatch.md`, same
  precedent as the speakup-brain-deepseek-swap 2-hunk verbatim edit).
  Independent review by Buffet (Sonnet, read-only, fresh context) — author ≠
  final reviewer. Cost note (Phương 2026-07-09): cheaper-teammate slot placed
  on the review, not on pasting Lead-authored safety-adjacent prompt text.
- Lane: `claude/speakup-v0` (dedicated worktree
  `~/work/repos/speakup-minny-react`; stacks on 56cedfa, itself push-held).
- Problem: Free Talking feels like an interview — Minny ends almost every turn
  with a follow-up question instead of reacting to what the child said. Root
  cause is a single prompt rule ("Ask a simple follow-up question in most
  replies ... to keep the conversation going") reinforced by every
  LEVEL_REGISTER being framed as "Ask ... questions". The model obeys literally
  and interrogates. Bad experience for a 6–12 y/o.
- Reuse survey: proven conversation-design patterns from leading AI speaking
  apps, reused as prompt technique (builds no new code/dependency):
  (1) "React first, ask second" active-listening / backchanneling — ADOPTED as
  the mandatory first move each turn (Speak, TalkPal; NVIDIA PersonaPlex
  backchannel research);
  (2) explicit "one question / not every turn" cap — ADOPTED, the documented
  cure for LLM "interview mode" (XDA clarifying-question-limit writeup);
  (3) keep-AI-leading-for-kids topic guidance — KEPT (retain starter-topic
  fallback + off-topic steer; kid-safety research says the AI should still
  lead, just not interrogate). N/A on an external library/fork — this re-specs
  an existing prompt, no new capability to build.
- Acceptance criteria:
  1. `_minny-convo.js` buildSystemPrompt: the question mandate is removed; new
     rules = react-first every turn + at most ONE question in ~half of replies
     + starter-topic question only when the child gives little; plus a 3-line
     few-shot showing react / comment / one-question. LEVEL_REGISTER describes
     the language level only ("if you do ask, ..."), no per-level question
     mandate.
  2. Persona, safety rules (PII, character-break, injection resistance), strict
     JSON output shape, mood logic, caps, guardrails, and the TTS chain — all
     UNTOUCHED.
  3. `node --test` green + `astro build` clean + `founder_check --gate build`
     PASS.
  4. Offline eval `scripts/eval-minny-question-rate.mjs` reports the
     question-rate over sample turns (target ~40–60%, was ~100%); calls the
     live model only when OPENROUTER_API_KEY is set, else prints a skip note.
  5. Live verification DEFERRED to the deployed preview once push is unheld
     (needs a real DeepSeek-answered turn) — bundled with the deepseek-swap
     preview pass Phương already owes.
- Files owned: `functions/api/_minny-convo.js`,
  `scripts/eval-minny-question-rate.mjs` (new),
  `tests/minny-conversation.test.mjs` (only if an assertion needs updating).
- Stop condition: any diff touching guardrails, caps, the TTS chain, the
  conversation endpoint control flow, or the prompt's safety rules — stop and
  escalate. No merge to main. PUSH HELD (bundle with the pending deepseek-swap
  preview pass).
- Cost ceiling: Claude team (Max plan, not metered) — Elon edit + Buffet
  (Sonnet) review; runtime cost unchanged (same model, same ~150-token
  replies).
- Design self-verification: N/A visual (no UI change; behavior lives in the
  reply text the existing Minny bubble already renders). Behavioral evidence =
  LIVE eval against the real DeepSeek v4 Flash brain (OpenRouter key from
  ~/.config/aider/.env), 3 scripted answer-and-keep-sharing conversations (12
  Minny replies): first pass QUESTION-RATE **25% (3/12)**, down from ~100%
  under the old prompt. Per Phương (2026-07-09) the target was raised to ~40%;
  the rule was reworded from a ceiling ("at most one, only in about half") to a
  target ("about half the time DO ask") plus a "never two turns in a row"
  guard. Re-verified LIVE across two runs: **33% (4/12) and 50% (6/12), ≈41%
  average**; questions land at distributed, non-consecutive turns (e.g. 3/6/8/11
  in one run) — the guard holds and the "always-ask-last-turn" few-shot-anchor
  risk stays empirically ruled out. Sample replies warm and natural (e.g. "Two
  cats? Wow, you are so lucky — I love cats!", "One goal — that's fantastic! I
  bet all your friends cheered for you."). LIVE PREVIEW CHECK 2026-07-09 (pushed
  e4963bc..c5be058; code R2L-KHANHVY-B7YR, level L0): **BLOCKED — could NOT
  validate the fix live because Free Talking on the deployed preview is not
  producing real conversation at all.** All 3 turns returned verbatim canned
  phrases (redirect_1, redirect_2, then wrap_up_1 with turns_left->0) — every
  turn replaced by a guardrail/fallback redirect, session early-wrapped. Code
  analysis: wrap_up_1+celebrate+turns_left:0 at turn 3 can only be
  handleGuardrailFlag at flags>=2 (minny-conversation.js:69); redirect_N at
  turns 1-2 fits both the !parsed LLM-failure path (:347) and the flag path
  (:54). Conclusion: >=2 benign kid turns SAFETY-FLAGGED + >=1 LLM parse
  failure. This is the Phase 6 guardrail chain + DeepSeek/llama brain (both
  PRE-EXISTING, untouched by this task) — NOT the prompt. Likely causes (Phương
  to check in Cloudflare; I lack DEBUG_SPEAKING_KEY + env visibility): (1)
  OPENROUTER_API_KEY on Production but not PREVIEW -> DeepSeek skipped ->
  llama-3.3 non-JSON -> parse fail -> redirect; (2) Llama Guard fail-closing on
  env.AI error -> flags benign replies -> redirect + early wrap. History shows a
  real end-to-end Free Talk turn was never live-verified before (SKIPPED on cap
  grounds) — this is the first true live test and it exposed the chain. NEEDS
  ESCALATION as its own task (touches guardrails/brain = stop condition). Prompt
  fix remains proven offline; 2 sessions left on R2L-KHANHVY-B7YR today. Tests:
  full suite **881/881 green** (deps installed in the worktree); founder build
  gate PASS. Independent review: Buffet (Sonnet, read-only, fresh context) —
  **APPROVE** (safety rules intact, scope contained).
- Founder handoff: plain-language before/after in chat; bundled bounded ask —
  when Phương runs the held preview pass (after adding OPENROUTER_API_KEY),
  listen for Minny reacting/commenting instead of interrogating.
- Verified commit: (pending — push held; local commit records the fix, bundled
  with 56cedfa for the same preview pass)
- Branch health note (RESOLVED 2026-07-09 — was a FALSE ALARM): the 5
  "failing" tests (gen-monster-parts, monster-horn-position, read2lead-w2-ui,
  shop-ux, w6-tier-aura) were not broken/outdated/unrelated — they were
  ERR_MODULE_NOT_FOUND because the fresh dedicated worktree had no node_modules
  (gitignored; `pngjs` is a declared devDependency, `vite` comes in via Astro).
  `npm install` in the worktree → full suite 881/881 green. Nothing to delete
  or fix in the tests. Minor latent nit flagged separately: `vite` is imported
  by 3 tests but is not declared in package.json (works only transitively via
  Astro) — worth adding to devDependencies someday, tangential to SpeakUp, not
  touched here.
- Started: 2026-07-09

## Prior task (built, PUSH HELD — pending Phương preview pass): speakup-brain-deepseek-swap

- Status: built, push held
- Task ID: speakup-brain-deepseek-swap
- Owner: Claude Lead direct edit (small tightly-coupled 2-hunk swap, verbatim-prepared;
  Aider tiers retired 2026-07-08 per ~/.claude/rules/worker-dispatch.md; independent
  fresh-context Claude review agent ran on the diff — APPROVE, author ≠ final reviewer).
- Lane: `claude/speakup-v0`, primary checkout.
- Problem: Phương's OpenAI API credit ran out, so Free Talking's primary brain
  (gpt-5.4-mini) fails every turn and kids silently ride the llama fallback plus a
  wasted dead API call per turn. Phương chose (AskUserQuestion, 2026-07-08):
  switch the primary to DeepSeek on his existing OpenRouter worker billing.
- Reuse survey: OpenRouter DeepSeek V4 Flash (ADOPTED — existing billing,
  OpenAI-compatible request shape; live-verified pre-change with the real key:
  strict-JSON reply parses, 130 tokens ≈ $0.00002/turn); OpenAI top-up (REJECTED —
  Phương declined); Workers AI llama-3.3 as primary (REJECTED — remains the free
  fallback tier; DeepSeek chosen for reply quality); direct DeepSeek platform API
  (REJECTED — second vendor account for the same model).
- Acceptance criteria:
  1. Primary conversation call goes to openrouter.ai with the pinned
     `deepseek/deepseek-v4-flash`, JSON mode, 150 max_tokens, 8s timeout, gated on
     `OPENROUTER_API_KEY`; missing key or any failure → existing llama fallback →
     canned redirect (unchanged order). Unit-tested with a captured request.
  2. Guardrails, caps, TTS chain (incl. OpenAI last-resort via `apiKey`) untouched.
  3. Full suite green + `astro build` clean + independent diff review.
  4. Live verification on the DEPLOYED preview once Phương adds
     `OPENROUTER_API_KEY` to both Cloudflare environments — a real Free Talk turn
     answered by DeepSeek (non-canned reply while llama fallback path also proven).
- Files owned: `functions/api/minny-conversation.js` (primary-LLM block + model
  constant), `tests/minny-conversation.test.mjs`, `tests/minny-guardrails.test.mjs`.
- Stop condition: any diff touching guardrail screening, caps, canned phrases,
  TTS chain internals, or scoring endpoints — stop and escalate. No merge to main.
  HOLD PUSH while Phương runs his own preview test pass (2026-07-08 note) — deploy
  only on his word or after he finishes.
- Cost ceiling: Claude (Max plan, not metered); runtime ≈ $0.02–0.10/month at pilot
  volume (150-token replies via OpenRouter).
- Design self-verification: N/A visual (no UI change); behavioral evidence = new
  captured-request unit test + pre-change live curl of the exact request shape with
  the real key (reply parsed, model `deepseek/deepseek-v4-flash-20260423`).
- Founder handoff: (pending — bounded ask: add OPENROUTER_API_KEY to Cloudflare
  Preview + Production, then say the word for deploy + live re-verify)
- Verified commit: (pending)
- Started: 2026-07-08

## Prior task (complete): speakup-stage-a-live-feel

- Status: complete (full narrative in `_ops/AGENT_LOG.md` DONE entry 2026-07-08;
  CONTROL.md slot was owned by the concurrent photo-to-homework session at the
  time — ft-recorder-fix precedent — so this is the fold-in record).
- Task ID: speakup-stage-a-live-feel
- Owner: Claude Lead (speak-up.astro free-talk section direct edit, logged
  precedent) + Aider Junior (persona line, filler phrases — final Aider dispatches
  before the tier retired).
- Summary: hands-free turn-taking (VAD on monitor voicedMs(), 1.5s pause auto-send,
  auto re-arm after Minny speaks, r2l_ft_handsfree=0 escape hatch), thinking filler
  phrases thinking_1/2 (sign-off list now 15), per-turn latency capture with p50 in
  the session summary (first live numbers: p50 4469ms on the preview llama path),
  koala→red-robot persona fix. 880/880 tests, build clean.
- Design self-verification: live e2e on the DEPLOYED preview @ 4d98bbe (code
  R2L-ONG-U5M6, stubbed mic fed real Minny TTS speech): 2 turns zero stop-taps,
  auto re-arm zero clicks, filler prefetch observed, `[ft-latency]` lines + session
  p50 logged; whole-screen screenshots `_ops/ft-handsfree-live-1280.png`,
  `_ops/ft-handsfree-summary-1280.png` — 7b layout unchanged.
- Verified commit: 4d98bbe (on origin/claude/speakup-v0)
- Cost: Aider $0.0011 (2 dispatches); runtime ≈ $0 (2 cached TTS phrases).
- Started/completed: 2026-07-08

## Prior task (complete): speakup-photo-to-homework
- Status: complete
- Task ID: speakup-photo-to-homework
- Owner: Claude Lead (plan + review + integration); packets to Aider Junior
  with verbatim code; big-`.astro` packets direct-edit if Aider times out
  (rule-3 precedent ×2 on 2026-07-07, logged).
- Lane: `claude/speakup-v0`, primary checkout.
- Problem: the photo IS Phương's homework (e.g. the Stage-4 slide); he
  must re-type its content, and photo-only saves were rejected. Approved
  plan (Phương, 2026-07-07, "go with what you recommend"): (A) vision
  model reads the photo at assign time and drafts the two boxes for the
  teacher to confirm — stored homework stays text, downstream unchanged;
  (C) deliberate photo-only saves become a look-and-speak step graded
  pronunciation-only via Azure unscripted assessment (≤30s REST cap),
  open-scorer fallback. Plan file is the rule-16 spec addendum
  (`~/.claude/plans/while-i-m-testing-i-streamed-falcon.md`).
- Reuse survey: Workers AI `@cf/meta/llama-3.2-11b-vision-instruct`
  (ADOPTED — existing env.AI binding, no keys, free-tier Neurons at pilot
  volume); OpenAI gpt-4o-mini vision (REJECTED — per-env key fragility,
  the robot-voice failure class); dedicated OCR e.g. Google Vision/Azure
  OCR (REJECTED — new vendor/keys; we need stems-vs-sentences intent, not
  raw OCR); Azure PA unscripted mode (ADOPTED — same configured resource,
  ReferenceText omitted per Microsoft docs, REST ≤30s); existing
  `scoreOpenTranscript` (REUSED as the >30s/Azure-down fallback).
- Acceptance criteria:
  1. Extract endpoint: class-scoped r2_key → vision draft
     `{frame_text, sentences_text}` sanity-passed through the existing
     parsers; malformed model output → `draft: null`, never a teacher
     error. Unit-tested with mocked env.AI.
  2. Modal: photo uploads on pick; extraction fills ONLY empty boxes;
     status line narrates progress; teacher text never overwritten; save
     uses the saved descriptor (pending-upload branch removed).
  3. Photo-only saves validate (photo present), store
     `photo_talk: {duration_s}`, and yield one `hw_photo_talk` open step;
     v1/v2 regression clean.
  4. hw_photo_talk records as WAV; ≤30s clips graded
     `azure_pronunciation_unscripted` (PA header WITHOUT ReferenceText —
     asserted in tests); >30s or Azure failure → existing open scorer;
     scripted read path byte-identical.
  5. Suite green + build clean per packet; live e2e on the deployed
     preview: real Stage-4 slide extraction quality, photo-only
     round-trip, whole-screen screenshots vs approved layouts.
- Files owned: `functions/api/admin/classes/[id]/homework-photo-extract.js`
  (new), `functions/api/_homework.js`,
  `functions/api/minny-speaking-context.js`,
  `functions/api/read2lead-speaking-check.js` (open-branch additive; this
  plan is its dedicated spec), `functions/api/_azure-pronunciation.js`,
  `src/components/admin/HomeworkModal.astro`,
  `src/pages/admin/classes.astro`, `src/pages/speak-up.astro`
  (recorder-options line + listen phrase), `tests/homework-photo.test.mjs`,
  `tests/admin-homework.test.mjs`, `tests/minny-speaking.test.mjs`,
  `tests/azure-pronunciation.test.mjs`.
- Stop condition: any diff touching recorder/mic protected files,
  guardrails, caps, or the scripted read scoring path — stop and escalate.
  No merge to main.
- Cost ceiling: Aider ≤ USD 0.10; runtime ≈ USD 0 (free Neurons + Azure F0
  + KV meter).
- Design self-verification: live-verified on the DEPLOYED preview via real
  browser (playwright-core + system Chrome, real APIs, no stubbing):
  (1) admin modal — picked the Stage-4 slide replica, status narrated
  upload→"🔎 Minny đang đọc ảnh…"→"Minny đã đọc ảnh — thầy kiểm tra rồi
  sửa giúp nhé ✏️", frame box auto-filled with all 6 stems, sentences box
  left untouched, no save performed (`_ops/p2h-modal-draft-1280.png`);
  (2) kid photo-only screen — R2L-PHUC-7TZV's real homework: prompt "Con
  xem ảnh bài tập rồi thuyết trình theo ảnh nhé", slide legible in the
  story card, recorder below, at 1280 + 390
  (`_ops/p2h-kid-phototalk-1280.png`, `-390.png`); composition reuses the
  already-approved practice layout, nothing extra/missing.
- Founder handoff: plain-language report in chat with screenshots; PHUC's
  code intentionally left holding a photo-only demo homework (the Stage-4
  slide replica) so Phương can try both flows immediately; bounded asks:
  try one real photo assignment on his phone (his dry-run step), rotate
  ADMIN_PASSWORD + Azure KEY 1 before merge.
- Verified commit: 3f8a607 (on origin/claude/speakup-v0; review surface =
  deployed preview — rule 20)
- Actual cost: Aider ≈ USD 0.004 (3 packets); vision + unscripted-PA live
  testing within free tiers (Workers AI Neurons, Azure F0).
- Live-debug trail (2026-07-08, all admin-authed via `detail` field):
  Workers AI 5016 → one-time Meta license 'agree' submitted (per-account;
  a new CF account would need it again); 3030 → messages+image rejected on
  this build, prompt+byte-array pinned; `response` arrives as a pre-parsed
  object (handled both shapes).
- Started: 2026-07-07

## Prior task (complete): speakup-ft-instant-mic

- Status: complete (status flag corrected 2026-07-07 by the photo-session:
  the task's own record and `_ops` DONE log show it fully verified at
  9765ad4 with founder handoff delivered; Phương's real-device checklist
  remains listed in the handoff as his confirm step)
- Task ID: speakup-ft-instant-mic
- Owner: Claude Lead (direct edit — async/state-machine change woven through
  speak-up.astro's free-talk recorder + protected r2l-recorder.js; same
  reliability rationale as speakup-ft-recorder-fix).
- Lane: `claude/speakup-v0`, primary checkout.
- Problem: free-talk turns feel slow — every tap pays a fresh getUserMedia
  plus a fixed 3s warmup countdown plus monitor setup (~4s before the child
  can speak). Phương asked to examine deleting the 3s wait; investigation
  (2026-07-07) showed it is a pure sleep whose proven anti-silence role is
  actually carried by the open analyser (R2LRecorder.startMonitor — the
  mic-test pipeline records with zero warmup on every machine). Plan
  approved by Phương 2026-07-07 (plan file:
  `~/.claude/plans/work-on-project-speakup-enchanted-umbrella.md`).
- Approach: persistent conversation-scoped mic (Zoom/Meet/ChatGPT-voice
  pattern) — acquire stream at greeting (post mic-gate), monitor created on
  first tap (iOS gesture rule), per-turn recorder start/stop only; free
  talking only, homework keeps its 3s warmup; localStorage escape hatch
  `r2l_ft_warmup=1` restores the countdown.
- Reuse survey: persistent-stream tap-to-talk pattern via existing repo
  primitives getStream/startMonitor/watchTrack/device-prefs (ADOPTED — no
  new dependency); @ricky0123/vad-web Silero VAD hands-free turn detection
  (DEFERRED to V1 research — ONNX/WASM runtime + always-listening privacy +
  barge-in complexity for kids); OpenAI Realtime / LiveKit Agents / Pipecat
  full realtime stacks (REJECTED — replaces the record→POST→TTS
  architecture, overkill for the 20-student pilot).
- Files owned: `src/pages/speak-up.astro` (free-talk section),
  `public/scripts/r2l-recorder.js` (additive monitor.reset()),
  `tests/r2l-recorder-engine.test.mjs`.
- Stop condition: any diff touching homework recording flow,
  runMicWarmupCountdown itself, mic-check panel internals, scoring
  endpoints, or guardrails — stop and escalate. No merge to main.
- Cost ceiling: Claude Lead on Max plan (not metered); runtime cost ≈ USD 0.
- Design self-verification: live-verified on the deployed preview @ 9765ad4
  (code R2L-ONG-U5M6, counting getUserMedia stub): exactly 1 mic acquire
  across a 3-turn conversation with real Minny replies; tap→recording 11ms
  on every turn (was ~4s); no "chờ 3 giây" text in free talk; rapid tap-tap
  keeps the stream warm; End click leaves 0 live tracks (mic indicator
  off); homework mode still shows the full 3s countdown sequence
  (R2L-PHUC-7TZV); 0 console errors from the new paths.
- Founder handoff: reported to Phương in-session 2026-07-07 with the
  real-device checklist (iPhone/Safari + Windows/Realtek: tap and
  immediately say "Hello Minny" — first word must appear in the transcript;
  5+ turn conversation; mic indicator off at summary). Note for Phương: the
  mic indicator staying ON during the whole conversation is the new
  expected behavior (same as Zoom). Escape hatch on a problem machine:
  localStorage r2l_ft_warmup=1.
- Verified commit: 9765ad4 (on origin/claude/speakup-v0)
- Started: 2026-07-07

## Prior task (complete): speakup-homework-photo-v2

- Status: complete
- Task ID: speakup-homework-photo-v2
- Owner: Claude Lead (plan + review + integration); packets dispatched to
  Aider Junior/Senior per fit; kid-page UI packet gated on a design mock
  Phương approves first.
- Lane: `claude/speakup-v0`, primary checkout.
- Problem: homework is text-only (sentences + frame boxes), but Phương
  usually sends kids a photo (textbook page / picture / exercise — varies);
  kids must see that photo in the app while practicing. Plan approved by
  Phương 2026-07-07 (plan file: `~/.claude/plans/while-i-m-testing-i-streamed-falcon.md`).
  Locked decisions: 1 photo per homework; keep the two-box form; no new
  task types; grading untouched; photo-only homework is a non-goal.
- Reuse survey: Cloudflare R2 via existing `R2L_MEDIA` binding + the
  portfolio upload/serve pattern (ADOPTED — `admin/portfolio/upload.js`
  formData→validate→R2.put; `parent/video.js` code-authorized streaming;
  `authorizeParentCode` reused for the kid endpoint); Cloudflare Images
  (REJECTED — paid add-on, overkill for 20-student pilot); external image
  CDN e.g. Cloudinary (REJECTED — new vendor for kids' data, R2 already
  bound); base64-in-KV like the TTS cache (REJECTED — photos are MBs,
  binary belongs in R2 per the repo's own portfolio precedent).
- Acceptance criteria (per approved plan):
  1. Schema v2: `homework.photo` descriptor (single), v1 records normalized
     on read everywhere, no KV migration, history untouched.
  2. Admin upload endpoint (Basic-Auth, class-scoped R2 key, jpeg/png/webp
     ≤8MB, HEIC rejected with Vietnamese message) + admin preview GET.
  3. Kid endpoint serves the current homework photo only with a valid
     student code (reuses authorizeParentCode; 4xx JSON otherwise).
  4. Homework POST accepts/validates the photo descriptor; same descriptor
     written to every roster code (one R2 object, N references).
  5. Modal: single photo picker + thumbnail + remove, client downscale
     1600px/q0.85, clean abort on upload failure.
  6. Kid page: photo thumb in the story card on every homework step +
     tap-to-fullscreen lightbox (≥44px targets), design mock approved by
     Phương BEFORE build; 📎 hint on the mode card.
  7. Suite green + `astro build` clean per packet; live verification on the
     deployed preview incl. v1-compat, security (wrong code 4xx), and
     Azure grading unchanged.
- Files owned: `functions/api/_homework.js`,
  `functions/api/minny-speaking-context.js`,
  `functions/api/admin/classes/[id]/homework.js`,
  `functions/api/admin/classes/[id]/homework-photo.js` (new),
  `functions/api/speakup-homework-photo.js` (new),
  `src/components/admin/HomeworkModal.astro`,
  `src/pages/admin/classes.astro`, `src/pages/speak-up.astro`,
  `src/styles/speakup-app.css`, `tests/admin-homework.test.mjs`,
  `tests/homework-photo.test.mjs` (new), `tests/minny-speaking.test.mjs`,
  `docs/ENV.md` (R2L_MEDIA drift note).
- Stop condition: any diff touching the scoring endpoint, recorder/mic
  files, guardrails, or caps — stop and escalate. No merge to main.
- Cost ceiling: Aider dispatches ≤ USD 0.50 total; Claude Lead on Max plan
  (not metered); runtime cost ≈ USD 0 (R2 free tier, 10GB).
- Design self-verification: Kid page verified on the DEPLOYED preview
  (playwright-core + system Chrome driving the real deployed bundle with
  route-injected homework modes, photo id + placeholder image — real R2
  photo blocked on the Preview binding, see below). Screenshots vs the
  Phương-approved mock (artifact 3e1d3a20, approved 2026-07-07):
  `_ops/hw-photo-modes-390.png` (📎 badge on mode card),
  `_ops/hw-photo-read-390.png` (photo card in story card above the
  sentence), `_ops/hw-photo-lightbox-390.png` (backdrop + caption + ✕ Đóng
  101×45px ≥44px), `_ops/hw-photo-frame-1280.png` (whole-screen 3-col
  rail/story/recorder intact, photo above numbered stems),
  `_ops/hw-photo-none-1280.png` (no-photo homework: no thumb, no badge —
  regression for the entry-104 class-order bug the concurrent session
  caught live at dd38587, fixed in 4a2c771). Verdict: MATCH, nothing
  extra, nothing missing. Admin modal (packet 6) is teacher-facing
  internal tooling with no design mock — behavior to be exercised in the
  live end-to-end once the R2 binding lands.
- Founder handoff: progress reports in chat per packet; mock approved
  before kid-UI build; remaining asks are bounded: (1) add the R2L_MEDIA
  R2 binding for the Preview environment (screenshot walked through in
  chat — bucket `felixbuilderhub-read2lead`, name `R2L_MEDIA`), then say
  the word for the live end-to-end photo test; (2) Azure KEY 1 rotation
  still pending from the earlier task.
- Verified commit: 5be9632 (on origin/claude/speakup-v0; review surface =
  deployed preview — rule 20; earlier visual round verified at 4a2c771)
- Actual cost: USD ~0.005 total Aider (packets 1–6 + validation packet A);
  runtime USD 0 (R2 free tier).
- Started: 2026-07-07
- Addendum 2026-07-07 (validation fix, Phương-approved plan): Phương's real
  Stage-4 assignment failed with a bare `validation_failed` alert. Two
  defects: (a) classes.astro throws `result.message||result.error`,
  swallowing the endpoint's `error_vi`; (b) the sentences-box charset
  rejects real teacher input (colon titles, curly apostrophes, pasted
  `___` stems) and frame blanks under 3 underscores fail. Fix inside this
  task (same files already owned): normalizeTeacherLine (curly→straight,
  dash/ellipsis/NBSP), `_{2,}`→`___` in frames, charset += `:;()`,
  actionable error_vi (underscore→"put it in the frame box" hint, else
  name the character), client shows error_vi. Reuse survey: N/A — bugfix,
  builds nothing new. Cost: ≤$0.05 Aider Junior.

## Prior task (complete): speakup-azure-pa-utf8-fix

- Status: complete
- Task ID: speakup-azure-pa-utf8-fix
- Owner: Aider Junior (dispatch) + Claude (review) — one bounded concern,
  verbatim code provided in the instruction per the reliability rule.
- Lane: `claude/speakup-v0`, primary checkout.
- Problem: `btoa(JSON.stringify(...))` in `_azure-pronunciation.js` throws
  on any non-Latin1 character in the reference text (curly apostrophe `’`,
  curly quotes, Vietnamese diacritics) → Azure PA silently skipped, local
  scorer answers. Live-proven 2026-07-07 under speakup-azure-pa-live-verify:
  same audio scored `azure_pronunciation` with `'` and local with `’`.
  Phương approved the fix ("go ahead").
- Reuse survey: N/A — one-line bugfix to already-shipped code (UTF-8-safe
  base64 via the platform's own TextEncoder + btoa; no new capability).
- Acceptance criteria:
  1. PA header built UTF-8-safely; curly-apostrophe/Vietnamese reference
     text no longer throws.
  2. New unit test: curly-apostrophe ReferenceText round-trips through the
     header (UTF-8 base64 decode) and Azure path is taken (azureCalls = 1).
  3. Full suite green, `astro build` clean.
  4. Live re-verification on the DEPLOYED preview: the exact curly-apostrophe
     sentence that fell back yesterday now returns
     `scorer: azure_pronunciation`.
- Files owned: `functions/api/_azure-pronunciation.js` (encoding line),
  `tests/azure-pronunciation.test.mjs` (one new test).
- Stop condition: any change beyond the header-encoding line and one test —
  stop and escalate. No merge to main.
- Cost ceiling: USD 0.05 (Aider Junior, DeepSeek V4 Flash, single small
  dispatch); runtime cost unchanged (Azure F0 free tier).
- Design self-verification: N/A — non-visual (encoding line + unit test; no
  design reference). Live behavioral evidence on the DEPLOYED preview: the
  exact curly-apostrophe sentence that fell back pre-fix ("Hello! I am
  Minny. Let’s practice speaking together!") now returns
  `scorer: azure_pronunciation` — 96/95/96/100, 2.7s, code R2L-ONG-U5M6.
- Founder handoff: plain-language before/after in chat (old scorer 75 with
  wrong word chips vs Azure 96 with per-word pronunciation analysis, same
  audio). Bounded ask: regenerate Azure KEY 1 in the portal and paste the
  new key into both Cloudflare environments (the old key was exposed in
  chat during debugging), then say "key rotated" for a final spot check.
- Verified commit: 5cacfc7 (on origin/claude/speakup-v0; review surface =
  deployed preview claude-speakup-v0.felixbuilderhub.pages.dev — rule 20)
- Actual cost: USD 0.0012 (Aider Junior, single dispatch, under the 0.05
  ceiling).
- Started: 2026-07-07

## Prior task (complete): speakup-azure-pa-live-verify

- Status: complete
- Task ID: speakup-azure-pa-live-verify
- Owner: Claude Lead — direct execution (verification-only leg of
  `speakup-voice-and-grading-reuse-overhaul`; no product code changes).
- Lane: `claude/speakup-v0`, primary checkout.
- Problem: Phương completed `_ops/AZURE_SPEECH_SETUP.md` (2026-07-07,
  "azure is done"). The Azure Pronunciation Assessment path shipped in
  `4369c5f` is unit-tested but was SKIPPED live (no key existed). Per the
  setup doc's Part C: trigger a preview redeploy (env vars only apply to
  new deployments) and verify one real graded recording end-to-end.
- Reuse survey: N/A — verification of already-shipped code; builds nothing
  new (only a `public/deploy-marker.txt` to detect the rebuild).
- Acceptance criteria:
  1. Preview redeployed after the env vars were added (marker file serves).
  2. One real WAV recording POSTed to `/api/read2lead-speaking-check`
     (check_mode 'read') on the DEPLOYED preview returns
     `scorer: 'azure_pronunciation'` with per-word accuracy — proving key,
     region, meter, and mapping all work live.
  3. Any failure falls back to the local scorer (kids never blocked) —
     report honestly which scorer answered.
- Files owned: `public/deploy-marker.txt` (new, inert static file),
  `.founder-os/products/speakup/CONTROL.md` (this record).
- Stop condition: no product code changes; if Azure fails live, diagnose
  and report — do not patch code under this task.
- Cost ceiling: $0 (Azure F0 free tier, one ~10s call against a
  5-audio-hour/month meter; Claude Lead on Max plan, not metered).
- Design self-verification: N/A — non-visual API verification (playback/
  scoring pipeline only; no design reference, no layout change). Live
  evidence: `scorer: azure_pronunciation` returned by the DEPLOYED preview
  (score 96, accuracy 95, fluency 96, completeness 100, per-word chips all
  exact) for a real 3.3s WAV of Minny's Aura-2 greeting, code R2L-ONG-U5M6.
- Founder handoff: plain-language report in chat — Azure works, his
  Cloudflare setup was correct all along; the earlier fallbacks were a
  found-and-isolated bug in OUR code (`btoa()` in
  `_azure-pronunciation.js` throws on non-Latin1 chars like curly
  apostrophes in the reference text → silent local-scorer fallback,
  proven live: same audio scored `azure_pronunciation` with `'` and
  local with `’`). Bounded asks: (1) approve the one-line UTF-8-safe
  encoding fix (separate task, spec'd in chat), (2) regenerate Azure
  KEY 1 after the fix lands (key was pasted into chat during debugging).
- Verified commit: 0d881cb (on origin/claude/speakup-v0; review surface =
  deployed preview claude-speakup-v0.felixbuilderhub.pages.dev — rule 20)
- Started: 2026-07-07
- Progress 2026-07-07: preview redeployed (`f07f1b2`, marker live) and one
  real WAV (Minny's own Aura-2 greeting, 3.3s, PCM 16k mono) scored on the
  deployed preview with code R2L-ONG-U5M6 — but the response is the LOCAL
  scorer's shape (no `scorer: azure_pronunciation` field; score 75, "Minnie"
  vs "Minny" word chips). Response time 1.6s total = no 15s Azure timeout in
  the path, so the branch bailed instantly: either the two env vars are not
  visible to the **Preview** environment, or the key/region value is wrong
  (an instant 401/URL error also falls back silently). Fallback behavior
  itself verified working as designed — kids are never blocked. BLOCKED on
  Phương double-checking the Cloudflare variables (both names exact, Preview
  enabled, region `southeastasia`); then redeploy + re-verify.

## Prior task (complete): speakup-voice-and-grading-reuse-overhaul

- Status: complete
- Task ID: speakup-voice-and-grading-reuse-overhaul
- Owner: Claude Lead — direct execution (single tightly-coupled TTS helper +
  its call sites + ear-test handoff; justified guard override, precedent
  entries 104/108).
- Lane: `claude/speakup-v0`, primary checkout.
- Problem: Minny's voice was hand-rolled OpenAI tts-1-hd behind a
  per-environment API key; the preview env never had the key, so kids (and
  Phương) heard the browser robot fallback 100% of the time. Phương:
  research 2026 options, stop building from scratch, <$20/mo.
- Reuse survey: Workers AI `@cf/deepgram/aura-2-en` (ADOPTED — natural
  context-aware TTS, $0.030/1k chars ≈ $2–5/mo cached, runs on the existing
  `env.AI` binding: no API key, works on preview automatically);
  Workers AI `@cf/myshell-ai/melotts` (ADOPTED as free fallback tier,
  $0.0002/audio-min, replaces the browser robot voice); OpenAI
  gpt-4o-mini-tts (REJECTED — same quality tier but keeps the fragile
  per-env API-key dependency that caused this bug); ElevenLabs (REJECTED —
  ~$103/1M chars, over budget; escalation path if Phương's ear demands it);
  Kokoro-82M / Chatterbox OSS (REJECTED — no GPU host; hosted resellers =
  new vendor for savings we don't need at pilot scale); MiniMax/Inworld on
  Workers AI (DEFERRED — pricing unpublished on the CF pricing page).
  GRADING: Azure AI Speech Pronunciation Assessment (ADOPTED — purpose-built
  per-word/phoneme scoring for learners, free F0 tier 5 audio-h/mo,
  REST-callable from Pages Functions, usage hard-capped in KV so default
  budget is USD 0, full local-scorer fallback); SpeechAce/SpeechSuper/ELSA
  (REJECTED — enterprise quote-priced); Kaldi GOP OSS goparrot/gop-pykaldi
  (REJECTED — needs a self-hosted server); Workers AI
  whisper-large-v3-turbo (KEPT — already the primary transcriber, also
  reused for the new unpinned Vietnamese-detection pass).
- Acceptance criteria:
  1. `_minny-tts.js` synthesis chain: Aura-2 via `env.AI` primary → MeloTTS
     fallback → OpenAI only if the binding is absent; voice/engine in one
     exported constant; KV cache key includes engine+voice (stale nova audio
     never served).
  2. `/api/minny-voice` returns real audio on the DEPLOYED preview with no
     OpenAI key present.
  3. Free Talk greeting/replies and homework "Nghe Minny" play the new voice;
     browser speechSynthesis is last resort only; frame step gets a spoken
     intro via the canned-phrase whitelist (new phrase → Phương sign-off
     list).
  4. Tests updated (mock `env.AI`), suite green, build clean.
  5. Handoff = Phương ear test + one-line voice-switch instruction.
  6. GRADING: homework `read` steps scored by Azure Pronunciation Assessment
     when configured (WAV recording, ≤30s, free-tier KV meter) — same client
     response shape; any Azure failure/missing key → the local scorer,
     never a dead end.
  7. GRADING: Vietnamese speech on a scored attempt (<20%) returns the warm
     "thử lại bằng tiếng Anh" redirect instead of a garbage score
     (unpinned Whisper second pass, diacritics test; free-talk exempt).
  8. Click-by-click Azure free-tier setup doc for Phương
     (`_ops/AZURE_SPEECH_SETUP.md`); Azure path verified live once he adds
     `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION`.
- Files owned: `functions/api/_minny-tts.js`, `functions/api/minny-voice.js`,
  `functions/api/minny-conversation.js` (TTS call sites only),
  `functions/api/_minny-phrases.js`, `functions/api/_azure-pronunciation.js`
  (new), `functions/api/read2lead-speaking-check.js` (additive Azure/VN
  branches — protected file; the Phương-approved 2026-07-06 reuse plan is
  the dedicated spec), `src/pages/speak-up.astro` (playback chain + WAV
  flag), related tests.
- Stop condition: any diff touching guardrail screening, caps, the `is_test`
  remnants, or protected recorder/mic files — stop and escalate. No merge to
  main.
- Cost ceiling: Claude Lead direct — Max plan, not metered; runtime TTS cost
  ceiling USD 5/month (Aura-2 at pilot volume, KV-cached).
- Design self-verification: **Voice verified on the DEPLOYED preview with no
  OpenAI key present** (the exact condition that previously produced the
  robot voice): `/api/minny-voice` returns real Aura-2 audio — greeting
  19.7KB, new `frame_intro` 33KB, both valid MPEG layer-III 24kHz mono
  (checked with `file` on the decoded bytes); second call answers in 105ms =
  KV cache hit under the new `tts:aura2:luna:` key. Audio quality is
  Phương's ear test (I cannot listen) — voice switch is the one-line
  `TTS_VOICE` constant in `_minny-tts.js`. GRADING: Azure PA + Vietnamese
  redirect covered by 9 new unit tests (Azure path incl. client-contract
  mapping, meter, WAV-only routing, local fallback on Azure failure, VN
  redirect + free-talk exemption); live Azure verification SKIPPED until
  Phương creates the free Speech resource (`_ops/AZURE_SPEECH_SETUP.md`);
  live VN-speech test needs a real microphone — flagged in the handoff for
  his next test run. No visual/layout changes in this task (no screenshot
  round needed; playback + scoring only).
- Verified commit: 4369c5f (with 551c99b; both on origin/claude/speakup-v0
  — rule 20)
- Founder handoff: Plain-language report: why the voice was robotic (missing
  preview key), why it can't recur (voice now runs on Cloudflare's built-in
  binding, no keys), what to do next — (1) listen to Minny on the preview
  and judge the Aura-2 'luna' voice, (2) run `_ops/AZURE_SPEECH_SETUP.md`
  (~10 min, $0) to switch on real pronunciation grading, (3) the 13th canned
  phrase `frame_intro` joins the brand-voice sign-off list. Bounded asks
  only.
- Started: 2026-07-06
- Prior tasks `speakup-standalone-app-page` (verified `328cea9`) and
  `speakup-separation-and-freetalk-enable` (verified `b6ed0d8`, Phương
  spot-QA'd "ok for now"): full narratives in git history of this file and
  `_ops/AGENT_LOG.md` entries 110–114.

**Phase 6 (guardrails) — parked, not lost:** build is done and committed
(`e387eea`, `e71f770`); it stays `active` in the tracker only because it awaits
Phuong's live 30-min red-team + latency re-measure on the preview (see the
`## Acceptance criteria reconciliation` section below, items 4–5, still SKIPPED).
This UI-fidelity task does not touch any Phase 6 file.

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

### speakup-photo-to-homework (2026-07-08)

1. Extract endpoint (vision draft, sanity-passed, failure-tolerant) —
   **PASS** (unit: 880/880 incl. mocked-AI happy/garbage/thrown/foreign-key
   cases; live: the Stage-4 slide replica returned all 6 frame stems with
   `___` blanks on the deployed preview).
2. Modal upload-on-pick + draft-fills-empty-boxes + status narration —
   **PASS (live browser)**: real file pick → statuses in sequence → frame
   box auto-filled 6 lines, sentences box untouched, cancel clean
   (`_ops/p2h-modal-draft-1280.png`).
3. Photo-only validation + `photo_talk` record + `hw_photo_talk` step —
   **PASS** (unit + live: photo-only assignment to R2L-PHUC-7TZV → context
   returns exactly one open step, max_seconds 75, photo id).
4. Unscripted grading — **PASS** (unit: PA header WITHOUT ReferenceText
   asserted, >30s skip; live: real WAV → `azure_pronunciation_unscripted`,
   score 85 / accuracy 78 / fluency 96, 3.0s; scripted read path
   regression-clean in suite).
5. Live e2e + screenshots vs approved layouts — **PASS** (kid photo-only
   screen at 1280+390, composition reuses the approved practice layout;
   `_ops/p2h-kid-phototalk-*.png`).

Live-debug detour (recorded in the task block): Meta license 5016 one-time
'agree', 3030 input-shape pinning, object-shaped `response` handling — all
resolved same-session; temp probe/debug code removed before completion
(final endpoint is clean, `git show 3f8a607`).

### speakup-homework-photo-v2 (2026-07-07 — closed same day; item 7 PASS, see task narrative)

1. Schema v2 + normalize, no migration, history untouched — **PASS**
   (packet 1; 843/843 then; v1-compat unit tests).
2. Admin upload endpoint + preview GET (type/size/HEIC, class-scoped key)
   — **PASS in unit tests** (packet 3, 7 tests); live upload needs the
   Preview R2 binding + admin credentials (Phương's dry run covers it).
3. Kid endpoint code-authorized, current-photo-only — **PASS in unit
   tests + live security checks** (wrong code → 4xx JSON on the deployed
   preview; admin routes 401 without password).
4. Homework POST photo wiring, one object N references — **PASS**
   (packet 5 endpoint tests).
5. Modal picker + downscale + clean abort — **PASS (code + build)**;
   live exercise pending the R2 binding (part of item 7).
6. Kid page vs approved mock at 390/1280 incl. no-photo regression —
   **PASS (screenshot-verified on the DEPLOYED preview)** — see Design
   self-verification; includes the fix for the hidden-thumb bug the
   concurrent session caught (4a2c771).
7. Live end-to-end on the deployed preview (real upload → real R2 photo →
   kid sees it) — **PASS** (2026-07-07 late, after Phương added the
   Preview R2L_MEDIA binding and shared the admin password in chat):
   real JPEG uploaded via the deployed admin endpoint
   (`hp_5e1e84u1v8yj`, R2 key under `homework/class-mqzmxitv-fqbapn/`),
   Stage-4 homework (curly-quote stems + Vietnamese note + photo)
   assigned to R2L-PHUC-7TZV → `ok:true`; kid endpoint returned the real
   JPEG bytes (image/jpeg, ETag, private cache); context API carries
   `photo:{id}` only (r2_key leak re-checked live: none); real browser on
   the kid page loaded the photo (naturalWidth 800×450) in the story card
   + lightbox — screenshots `_ops/hw-e2e-kid-1280.png`,
   `_ops/hw-e2e-lightbox-1280.png`, `_ops/hw-e2e-modes-1280.png`.

8. Addendum (validation fix, same day): Phương's real Stage-4 assignment
   had failed with a bare `validation_failed`. Fixed + live-verified:
   (a) client alert now shows `error_vi` — browser test captured the
   real dialog: "Lỗi giao bài tập: Dòng 1 có chỗ trống ___ — câu có chỗ
   trống thì nhập vào ô \"Khung thuyết trình\" nhé."
   (`_ops/hw-e2e-admin-alert-1280.png`); (b) teacher input normalized
   (curly quotes/dashes/ellipsis/NBSP → plain; `_{2,}` → `___`), charset
   accepts `:;()`, underscore-in-sentences errors redirect to the frame
   box, unsupported characters are named. Unit-tested (864/864) and the
   exact curly-quote Stage-4 stems verified live (stored as
   `"Last summer, I went to ___ ."`, anchor words intact).

Suite at close of packet 7: 860/860, `astro build` clean.

### speakup-azure-pa-utf8-fix (2026-07-07)

1. PA header built UTF-8-safely, no throw on curly/Vietnamese chars —
   **PASS** (TextEncoder bytes → btoa; diff reviewed line by line, exactly
   the instructed change and nothing else).
2. New unit test: curly-apostrophe ReferenceText round-trips the header,
   Azure path taken — **PASS** (azureCalls=1, ReferenceText equality via
   UTF-8 base64 decode, score 88 from the fixture).
3. Suite green + build clean — **PASS** (836/836, one new; `astro build`
   25 pages clean).
4. Live re-verification on the DEPLOYED preview with the pre-fix failing
   sentence — **PASS** (`scorer: azure_pronunciation`, 96/95/96/100, 2.7s,
   deployment marker run3, commit 5cacfc7 on origin).

### speakup-azure-pa-live-verify (2026-07-07)

1. Preview redeployed after env vars added — **PASS** (marker
   `azure-pa-verify-2026-07-07-run2` served by the deployed preview;
   commits `f07f1b2`, `0d881cb` on origin).
2. Real WAV scored on the DEPLOYED preview returns
   `scorer: azure_pronunciation` — **PASS** (score 96 / accuracy 95 /
   fluency 96 / completeness 100 for Minny's own greeting audio; response
   time ~2s). Along the way this uncovered and live-proved a real bug:
   reference text containing any non-Latin1 character (curly apostrophe
   `’`, curly quotes, Vietnamese diacritics) makes `btoa()` in
   `assessPronunciationWithAzure` throw, silently dropping to the local
   scorer — same audio, `'` → Azure, `’` → local. Fix is a separate
   approved-scope task (UTF-8-safe base64), NOT patched under this task
   per its own stop condition.
3. Failure falls back to local scorer, kids never blocked — **PASS**
   (observed live three times during diagnosis: local-scorer shape, 1.6–2s,
   HTTP 200, valid word chips).

Carried context: this closes prior task item 6/8's "live Azure verification
SKIPPED"; item 7's live Vietnamese-redirect mic test still needs a real
microphone (unchanged).

### speakup-voice-and-grading-reuse-overhaul (2026-07-06)

1. TTS chain Aura-2 → MeloTTS → OpenAI-only-without-binding, one-line voice
   constant, engine-scoped cache key — **PASS** (unit tests for all three
   paths + fallback-not-cached; live: greeting + frame_intro synthesized on
   the deployed preview with no OpenAI key, cache hit 105ms).
2. `/api/minny-voice` returns real audio on the deployed preview with no
   OpenAI key — **PASS** (valid MPEG III 24kHz mono, verified with `file`).
3. New voice on FT greeting/replies + homework Listen; speechSynthesis last
   resort; frame step spoken intro — **PASS** (same `getOrSynthesize` path;
   `frame_intro` whitelisted phrase live; page routes frame steps to it).
4. Tests + build — **PASS** (835/835, 12 new across TTS + grading; `astro
   build` clean).
5. Phương ear test — **PENDING HIS RUN** (handoff includes the one-line
   voice-switch instruction; not a QA-hunt, a single listen).
6. Azure PA for read steps with full local fallback — **PASS in unit tests /
   SKIPPED live** (needs Phương's free Azure resource; until then the
   fallback path IS production behavior and is live-verified by definition).
7. Vietnamese redirect — **PASS in unit tests; live SKIPPED** (needs a real
   microphone speaking Vietnamese; flagged for Phương's next test run).
8. Azure setup doc — **PASS** (`_ops/AZURE_SPEECH_SETUP.md`, click-by-click,
   $0 tier, meter explained).

### speakup-separation-and-freetalk-enable (2026-07-06)

1. Menu = homework (when assigned) + free_talk, nothing else, no story
   lookup — **PASS** (live deployed API: `modes: ['free_talk']` for ONG, no
   story in greeting; unit tests for both menu shapes; `pickPracticePack`/
   retell/questions builders deleted outright).
2. `is_test` gate removed, all caps/guardrails untouched — **PASS** (diff
   touches only the gate block + two comments; caps verified live: capped
   code still gets the designed wrap-up; guardrail tests all green).
3. No-homework note + tidy-ups — **PASS** (live screenshots 1280/390; lone
   card centered via `:only-child` after first render showed it half-width
   left).
4. Old page deleted, no route in build — **PASS** (25 pages, no
   `/read2lead/speaking`; cache-busted request → 404. Caveat: stale
   Cloudflare edge copy still answers the bare URL until it ages out).
5. Tests updated, suite green, build clean — **PASS** (823/823; four test
   files retargeted to `speak-up.astro`, two gate tests rewritten to the
   new behavior, three obsolete story-mode tests removed, two separation
   tests added).
6. Verified on the DEPLOYED preview — **PASS** (rule 20; commits `bbb6761`,
   `b6ed0d8` both on origin, marker-polled before verifying).
7. Live real-code Free Talk session — **SKIPPED** (ONG's 3/day cap spent;
   endpoint test covers non-test start → 200 + session; not burning a real
   student's cap slot for testing. Re-runnable live after the daily reset.)

### speakup-freetalk-ui-fidelity (2026-07-06)

1. All 5 Free Talking states match the Phase 7b design at phone/tablet/desktop
   — **PASS (screenshot-verified)**. Rendered each state via headless Chrome
   (system `google-chrome-stable` + `playwright-core`) at 390/820/1280 and
   diffed against the design boards `design-s1/s2/s4/s5`: conversation,
   thinking, tap-to-play, wrap-up, summary all match. Before/after/design
   screenshots kept for Phuong's review.
2. Desktop 3-col (rail/transcript/recorder), tablet 2-col, phone single-col —
   **PASS**. `#free-talk-screen` breaks out of the homework flow's `max-w-lg`
   reading column on tablet+ so the columns have room; `grid-template-areas`
   reflow verified at all three widths.
3. `prefers-reduced-motion` variant — **PASS (code-verified)**. The
   reduced-motion `@media` block (freeze breathe/thinking-dots/pulse-ring/
   glow/waveform, instant timer color) carried over intact; a static
   screenshot can't capture animation state, so verified by code.
4. Homework (7a) screen still matches its design — **PASS (screenshot-verified)**.
   Rendered the practice screen; numbered gold stem circles, dashed-gold
   blanks, red circular record button inside the gold progress ring (the
   `.is-frame` state the JS sets for frame steps), score card, rubric card,
   and smile chip all match `design_handoff_speakup_phase_7a`. No fix needed.
5. `node --test` green + `astro build` clean — **PASS**. 824/824 tests, zero
   regressions; `astro build` clean; `founder_check.py --gate build` PASS.

**Known minor gaps (carried, not blocking):** the design's wrap-up screen shows
a settled `0:00` timer and faint decorative `★` around the avatar; both were
left out as decorative extras (the wrap-up reads clearly without them). Flagged
for Phuong to decide whether to add. Robot avatar kept (design's koala was a
stand-in); summary XP/rank/streak intentionally omitted (Phuong's call).

### speakup-phase6-guardrails

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
   report — **SKIPPED**. Phuong will run this himself on the Cloudflare
   preview once this branch is live (his explicit choice this session — no
   browser available in this sandbox). A scripted checklist has been
   prepared for him; result to be recorded here once he reports back.
5. Latency with Llama Guard in the path re-measured, still within Phase 5
   bounds — **SKIPPED**. No live Cloudflare/Workers AI credentials available
   in this sandboxed session to measure real latency (same class of gap as
   Phase 3's live-egress item and Phase 8a's browser gap). The code path
   adds exactly one additional `env.AI.run` call, capped at a 4-second
   timeout, and only when the deterministic checks already pass. Recommend
   measuring this alongside item 4 on the live preview.
6. `node --test` green — PASS. 824/824 tests (793 prior + 31 new), zero
   regressions. `astro build` also completes cleanly.

**Known gap, carried forward, needs Phuong and the Cloudflare preview**:
items 4 and 5 above (live red-team + latency measurement). The wordlist
provenance item is resolved (see the correction note above) — it is not a
carried-forward gap. Status stays `active`, not `complete`, until Phuong has
run the red-team and these are closed out.

## Daily update

- 2026-07-08: **Photo-to-homework shipped and live-verified.** Phương's
  real workflow is photo-first, so now: (1) picking a photo in the
  homework form uploads it immediately and a vision model (Workers AI
  Llama 3.2 11B Vision, existing binding, no keys) reads it and drafts
  the sentence/frame boxes — teacher reviews and saves; live test on a
  Stage-4 slide replica extracted all 6 stems. (2) Photo-only saves are
  now valid: kid sees the photo big and speaks about it, graded
  pronunciation-only via Azure unscripted assessment (live: 85/78/96 in
  3s; >30s clips fall back to the friendly open scorer). One-time Meta
  license accepted for the vision model (account-level). Earlier the same
  day: homework validation made teacher-friendly (curly quotes/blank runs
  normalized, real error messages surfaced — Phương's Stage-4 assignment
  had failed on this), homework photo feature completed end-to-end, Azure
  per-word grading verified live, and two concurrent-session recorder
  fixes (stuck button; instant mic) landed. 880/880 tests. **Awaiting
  Phương:** try one real photo assignment on his phone; the standing
  go-live list (red-team → ear test → phrases → dry run → rotate Azure
  key + admin password → merge).
- 2026-07-07: **Azure pronunciation grading is LIVE and verified end-to-end
  on the deployed preview.** Phương created the free Azure Speech resource
  and set both Cloudflare variables (his setup was correct on the first
  try). Verification with a real recording initially kept falling back to
  the old scorer — root-caused to a real bug in OUR code, not his setup:
  `btoa()` crashed on curly apostrophes/Vietnamese characters in the
  reference text and silently skipped Azure. Proven live (same audio: `'` →
  Azure 96, `’` → local 75), fixed via a one-line UTF-8-safe encoding
  (Aider Junior, $0.0012, diff reviewed line by line, one new unit test),
  and re-verified live: the previously-failing sentence now scores
  `azure_pronunciation` 96/95/96/100 in 2.7s. 836/836 tests, build clean,
  all gates PASS, deploy-parity PASS (`5cacfc7` on origin). Tasks
  `speakup-azure-pa-live-verify` and `speakup-azure-pa-utf8-fix` both
  complete. **New awaiting-Phương item:** rotate Azure KEY 1 (the key was
  pasted into chat during debugging) and update it in both Cloudflare
  environments. The prior task's item 6 (live Azure verification) is now
  closed; item 7 (live Vietnamese-speech redirect) still needs a real
  microphone.
- 2026-07-06 (late session): **Reuse-first overhaul shipped** (Phương's
  mandate: "stop building from scratch, hard-code it into a gate").
  (1) **Rule 21 gate live**: `founder_check.py --gate build` hard-blocks any
  task without a `- Reuse survey:` (≥2 external candidates with verdicts);
  27/27 founder-os tests. (2) **Minny's real voice is live on the preview**:
  Deepgram Aura-2 (voice `luna`) on the Workers AI binding — zero API keys,
  so the robot-voice failure class is dead; MeloTTS free fallback; verified
  live with no OpenAI key (valid MP3, 105ms cache hits); ~$2–5/mo. The
  robot voice Phương heard was the browser fallback — the preview env never
  had the OpenAI key the old tts-1-hd path needed. (3) **Grading upgraded**:
  Azure Pronunciation Assessment for homework reading (free F0 tier,
  KV-metered to $0, full local fallback — activates when Phương runs
  `_ops/AZURE_SPEECH_SETUP.md`), plus Vietnamese-speech warm redirect
  instead of garbage scores. 835/835 tests. **Awaiting Phương:** ear-test
  the new voice on the preview; Azure 10-min setup; (carried) Phase 6
  red-team; canned phrases sign-off (now 13 with `frame_intro`); preview
  OpenAI key for Free-Talk reply quality (optional); founder-os GitHub
  backup decision.
- 2026-07-06: **V0 build is complete — all 8 phases live on the preview
  branch; nothing on the live site yet.** Today: standalone SpeakUp app page
  at `/speak-up` rebuilt to the 7a/7b designs (navy surface, centered,
  kid-scale type, red record button, robot Minny); the cap flash-back bug
  fixed (designed "Mai nói chuyện tiếp với Minny nhé!" wrap-up); **Free Talk
  opened to every student code** (Phase 8b done — Phương's explicit order,
  ahead of his Phase 6 red-team, risk flagged); **SpeakUp fully separated
  from Read2Lead** (shared student codes/XP/ranking only — retell/questions
  story modes removed, no pack/story reads, old `/read2lead/speaking` page
  deleted outright, no redirect, per Phương). **Phương spot-QA'd the preview
  2026-07-06: "ok for now."** Full all-phases QA together still required
  before merge. Tests 823/823, build clean, all Founder OS gates PASS,
  deploy-parity PASS (`b6ed0d8`).
- Item closed: the long-carried **live egress check** (OpenAI TTS + LLM from
  the deployed preview) is observed working — real Free Talking sessions ran
  on the deployed preview during 2026-07-06 testing (that is what spent
  ONG's 3/day cap), with spoken greetings and scored turns. No geo-block.
- Remaining before merge to main (the go-live list, refreshed 2026-07-07):
  1. **Phương's Phase 6 red-team** (~30 min on the preview: try to make
     Minny misbehave) + latency feel-check — reconciliation items 4–5,
     still SKIPPED. Top priority now that Free Talk is open to all codes.
     Checklist: `_ops/specs/SPEAKUP_PHASE6_REDTEAM_CHECKLIST.md`.
  2. **Minny voice ear test** (one listen on the preview; Aura-2 'luna',
     one-line switch if he dislikes it) — pending since 2026-07-06.
  3. **Canned Minny phrases sign-off** (13 phrases in `_minny-phrases.js`,
     incl. `frame_intro`) — carried since Phase 3, needs Phương's read as
     brand voice.
  4. **Real-class dry run on preview**: Phương assigns real homework via
     the admin board; a couple of kids' codes checked (both cards show;
     recording works on their real devices — this also covers the live
     Vietnamese-redirect mic test still open from the grading overhaul).
  5. **Azure key rotation** (~1 min: regenerate KEY 1, update both
     Cloudflare environments) — hygiene, does not block QA items 1–4 but
     should happen before merge.
  6. Then the whole branch merges to `main` together — Phương's call,
     `Founder approved` in PRODUCT.md is his alone.
- Also open (not blocking): back up the local `founder-os` repo to a
  private GitHub repo (offered 2026-07-06, no answer yet).

---

- 2026-07-05 snapshot (Phases 4/5 build day), kept as written:
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
