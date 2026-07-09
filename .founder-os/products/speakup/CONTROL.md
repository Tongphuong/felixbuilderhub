# Control — SpeakUp

- Product: SpeakUp
- Current goal: Build all 8 phases of `_ops/specs/SPEC_SPEAKUP_V0.md` on branch `claude/speakup-v0`, QA the full pilot on preview, THEN merge to main. No phase merges to main individually.
- Branch: `claude/speakup-v0` (off `main`)
- Preview URL: `claude-speakup-v0.felixbuilderhub.pages.dev` (Cloudflare Pages auto-deploy per push, per `claude/<topic>` convention in `BRANCH_CONVENTIONS.md`)
- Active workers: 0
- Last updated: 2026-07-08 (photo-to-homework LIVE: Minny reads the
  assignment photo and drafts the boxes for the teacher; photo-only
  homework = look-and-speak graded by Azure unscripted pronunciation; all
  live-verified on the deployed preview — see Daily update. Pending
  Phương: red-team, ear test, phrases sign-off, dry run, key+password
  rotation, then merge)

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

- Status: active
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
- Design self-verification: (pending live re-verify on preview — see criteria 5)
- Verified commit: (pending push + live)
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
