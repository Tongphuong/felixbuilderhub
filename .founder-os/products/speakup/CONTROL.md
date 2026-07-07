# Control — SpeakUp

- Product: SpeakUp
- Current goal: Build all 8 phases of `_ops/specs/SPEC_SPEAKUP_V0.md` on branch `claude/speakup-v0`, QA the full pilot on preview, THEN merge to main. No phase merges to main individually.
- Branch: `claude/speakup-v0` (off `main`)
- Preview URL: `claude-speakup-v0.felixbuilderhub.pages.dev` (Cloudflare Pages auto-deploy per push, per `claude/<topic>` convention in `BRANCH_CONVENTIONS.md`)
- Active workers: 0
- Last updated: 2026-07-06 late (V0 complete on preview + reuse-first overhaul: rule 21 gate live, Minny voice = Aura-2 on Workers AI (no keys, ear-test pending), Azure pronunciation grading ready pending Phương's 10-min setup — see Daily update)

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

## Current task

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
- Remaining before merge to main (the go-live list):
  1. **Phương's Phase 6 red-team** (~30 min on the preview: try to make
     Minny misbehave) + latency feel-check — reconciliation items 4–5,
     still SKIPPED. Top priority now that Free Talk is open to all codes.
  2. **Canned Minny phrases sign-off** (12 phrases in `_minny-phrases.js`)
     — carried since Phase 3, needs Phương's read as brand voice.
  3. **Real-class dry run on preview**: Phương assigns real homework via
     the admin board; a couple of kids' codes checked (both cards show;
     recording works on their real devices).
  4. Then the whole branch merges to `main` together — Phương's call,
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
